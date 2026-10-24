# Arquitetura de Segurança — greencode

Este documento justifica as decisões de segurança adotadas na primeira etapa
do sistema `greencode` (CLI): o algoritmo de criptografia de dados, o esquema
de hashing de senhas e a política de expiração de sessão. Também documenta as
limitações conhecidas dessa etapa (persistência em arquivo de texto, sem
banco de dados relacional) e o caminho de evolução. **A segurança da API HTTP
da AV2 (JWT, bcrypt, RBAC, PostgreSQL) está na seção 8.**

## 1. Criptografia de dados em repouso — AES-256-GCM

Todos os arquivos de persistência sensíveis (`credenciais.dat`,
`organizacoes.dat`, `lotes.dat`, `equipamentos.dat`, `movimentacoes.dat`,
`parametros.dat`) são gravados cifrados com **AES-256 em modo GCM**
(Galois/Counter Mode), implementado através do módulo `crypto` nativo do
Node.js (`src/core/crypto.ts`).

Justificativa da escolha:

- **AES-256** é o padrão simétrico recomendado pelo NIST (FIPS 197) para
  dados sensíveis, com chave de 256 bits — resistente a ataques de força
  bruta com o poder computacional atualmente disponível, inclusive
  considerando margens de segurança para avanços de curto/médio prazo.
- **Modo GCM** foi escolhido em vez de modos não autenticados (como CBC)
  porque agrega **autenticação de integridade** (AEAD — Authenticated
  Encryption with Associated Data): qualquer adulteração do arquivo cifrado
  é detectada na decifragem, pois a *auth tag* deixa de validar. Isso
  protege contra ataques de bit-flipping e corrupção silenciosa de dados,
  requisito importante para um sistema de auditoria e rastreabilidade.
- Cada gravação usa um **IV (vetor de inicialização) aleatório de 96 bits**,
  gerado a cada chamada (`crypto.randomBytes(12)`), evitando reuso de
  IV — que comprometeria a confidencialidade em GCM.
- A **chave de dados (Data Encryption Key)** é um segredo aleatório de 256
  bits, gerado uma única vez durante o provisionamento inicial
  (`AuthService.provisionar`) e persistida no arquivo de configuração
  mestre (`master.config.json`).

### 1.1. Proteção da chave mestra (limitação conhecida e mitigação)

A especificação desta etapa exige que "o arquivo de configuração mestre
contenha a chave de criptografia mestra". Em um ambiente de produção ideal,
essa chave residiria em um cofre de segredos dedicado (HSM, AWS KMS, Azure
Key Vault, HashiCorp Vault etc.), nunca em disco em texto acessível pelo
processo sem intermediação de hardware/serviço dedicado.

Como esta etapa não inclui infraestrutura de KMS, a mitigação adotada foi:

- O arquivo `master.config.json` tem suas permissões restritas a
  **leitura/escrita apenas pelo dono do processo** (`chmod 600`) em sistemas
  POSIX (Linux/Ubuntu). No Windows, o `chmod` do Node tem efeito limitado;
  a recomendação operacional é restringir a ACL NTFS da pasta `data/` ao
  usuário de serviço que executa o `greencode`.
- O diretório `data/` deve ser expressamente excluído de backups não
  cifrados, sincronização em nuvem não controlada, ou repositórios de
  código (o `.gitignore` do projeto já ignora `data/`).
- **Evolução planejada**: nas próximas etapas (integração web e banco de
  dados relacional), a chave mestra deve migrar para um serviço de gestão
  de segredos, com rotação periódica e auditoria de acesso — o código já
  isola essa responsabilidade em `AuthService.carregarChaveMestra()` /
  `getChaveMestra()`, facilitando a substituição da fonte da chave sem
  alterar o restante do sistema (baixo acoplamento).

Como reforço documentado (não implementado nesta etapa, mas preparado no
código): o módulo `crypto.ts` já expõe `derivarChaveDeSenha` e
`envelopeChave`/`abrirEnvelopeChave`, que permitem evoluir para um esquema
de "chave envelopada" (a chave de dados cifrada por uma chave derivada da
senha do administrador via `scrypt`), eliminando a necessidade de armazenar
a chave mestra em claro no arquivo de configuração. Essa evolução foi
propositalmente desacoplada nesta entrega para não introduzir uma segunda
senha obrigatória em toda inicialização do sistema (trade-off de usabilidade
operacional vs. segurança, a ser revisitado com o cliente/proposta de
produto nas próximas etapas).

## 2. Hashing de senhas — SHA-256 iterado com salt

As senhas dos usuários **nunca são armazenadas em texto plano nem
reversível**. O esquema implementado (`src/core/crypto.ts`,
`gerarHashSenha` / `verificarSenha`) é:

1. Um **salt aleatório de 128 bits** é gerado por usuário
   (`crypto.randomBytes(16)`).
2. O hash é calculado como **SHA-256 aplicado iterativamente 100.000 vezes**
   sobre `salt:senha`, cada rodada realimentando o hash da rodada anterior
   (função `hashIterado`).
3. A verificação usa **comparação em tempo constante**
   (`crypto.timingSafeEqual`), evitando ataques de *timing* que tentam
   inferir o hash correto pela diferença de tempo de resposta.

Justificativa e trade-offs:

- A especificação do projeto exige explicitamente o uso de **SHA-256** para
  o hash de senhas. O SHA-256 puro, em uma única rodada, é uma função de
  hash **rápida** — característica desejável para checksums (como usamos no
  journal), mas **indesejável** para senhas, pois permite que um atacante
  com acesso ao arquivo de credenciais teste bilhões de senhas por segundo
  em hardware especializado (GPU/ASIC).
- Para mitigar essa fragilidade dentro da restrição de usar SHA-256, o
  sistema aplica a técnica de **iteração** (semelhante ao princípio do
  PBKDF2-HMAC-SHA256, mas simplificada): 100.000 rodadas elevam
  significativamente o custo computacional de um ataque de força bruta ou
  dicionário, sem exigir uma biblioteca de KDF externa.
- **Nota de evolução**: para as próximas etapas, recomenda-se migrar para
  uma função de derivação de chave dedicada e resistente a hardware
  (`scrypt`, já disponível nativamente no Node e usado neste projeto para
  `derivarChaveDeSenha`, ou `argon2id`), que oferece custo de memória
  configurável — mais robusta contra ataques com GPU/ASIC do que iterações
  puras de SHA-256. Essa função já está implementada e testada no módulo de
  criptografia (usada para a KEK), facilitando a migração do hashing de
  senha no futuro sem redesenhar a camada de persistência.
- **Política de força de senha**: senhas devem ter no mínimo 8 caracteres,
  ao menos 1 letra maiúscula e 1 dígito (`validarForcaSenha`), validada no
  provisionamento e na criação de novos usuários pelo administrador.

## 3. Expiração de sessão por inatividade (30 minutos)

Cada sessão (`SessaoAtiva`) guarda o instante do login e da última
atividade. Antes de executar **qualquer** comando protegido, o sistema
chama `AuthService.exigirSessaoValida()`, que:

- Calcula o tempo decorrido desde `ultimaAtividade`;
- Se ultrapassar **30 minutos (1.800.000 ms)**, invalida a sessão, registra
  o evento `SESSAO_EXPIRADA` no journal (para fins de auditoria) e força
  novo login;
- Caso contrário, atualiza `ultimaAtividade` para o instante corrente
  (sliding expiration — a sessão se renova a cada uso, não apenas no login).

Justificativa: o valor de 30 minutos é um equilíbrio comum entre segurança
(reduzir a janela de exposição caso um terminal seja deixado logado e sem
supervisão — situação plausível em um ambiente de almoxarifado/operação) e
usabilidade (evitar relogins excessivos durante o uso contínuo do sistema).
O mecanismo de *sliding expiration* evita que um operador ativo seja
desconectado no meio de uma tarefa longa.

## 4. Segregação de responsabilidades (RBAC)

O sistema define quatro papéis (`admin`, `cadastro`, `almoxarifado`,
`auditor`), aplicados em duas camadas independentes
(`src/commands/router.ts`):

1. **Matriz de permissão por recurso**: cada recurso (`usuario`, `org`,
   `contrato`, `lote`, `equipamento`, `config`, `rastreio`) declara os
   papéis autorizados a acessá-lo. O `auditor` está incluído em `org`,
   `contrato`, `lote`, `equipamento` e `rastreio` — ou seja, em todo
   recurso que representa dado de negócio consultável — mas **não** em
   `usuario` nem em `config`, que tratam de administração do próprio
   sistema (contas de acesso e parâmetros globais) e não de "histórico ou
   relatório" no sentido de negócio.
2. **Restrição adicional para o papel `auditor`**: mesmo dentro de um
   recurso liberado (como `org` ou `rastreio`), o auditor só pode executar
   ações de leitura (`ver`, `listar`, `get`, `journal`, `depreciacao`, e
   `equipamento` no contexto específico de `rastreio equipamento`, que é
   uma consulta). Qualquer ação de escrita (`criar`, `status`,
   `cadastrar`, `mover`, `estado`, `encerrar`, `set` etc.) é bloqueada
   mesmo que o recurso esteja na lista de papéis permitidos.

O resultado prático dessas duas camadas combinadas é que o auditor pode
consultar livremente organizações, contratos, lotes e equipamentos (além
de rastreabilidade e journal), mas não consegue criar, alterar ou remover
nada em nenhum recurso — em linha com a definição da especificação de que
esse papel serve para "consultar históricos e gerar relatórios, sem
qualquer capacidade de alteração". Essa dupla verificação também evita que
uma futura adição de comando "de escrita" a um recurso já liberado para o
auditor vaze permissão por esquecimento — o padrão de checagem é explícito
por ação, não apenas por recurso.

## 5. Integridade e imutabilidade do journal

O mecanismo de *journaling* (`src/core/journal.ts`) grava cada operação
relevante **antes** de aplicá-la ao estado corrente (write-ahead logging),
com:

- Um **checksum SHA-256** por entrada, calculado sobre o conteúdo da
  entrada (sem o próprio checksum), permitindo detectar adulteração
  posterior de uma linha do journal (`Journal.verificarIntegridade`);
- **fsync** explícito após cada `append`, reduzindo a janela de perda de
  dados em caso de queda abrupta de energia ou kill do processo;
- **Rotação automática** ao atingir 10 MB, e **retenção mínima de 180
  dias** para arquivos já rotacionados — arquivos mais novos que 180 dias
  nunca são removidos pela rotina de limpeza (`aplicarPoliticaRetencao`).

Essa ordem de escrita — journal primeiro, estado depois — é responsabilidade
de quem chama `Journal.registrar()`, não do módulo do journal em si (que
apenas grava a entrada quando solicitado). Por isso, cada comando que
altera dados (`src/commands/*.ts`) e os métodos de gestão de contas
(`AuthService.criarUsuario`, `desativarUsuario`, `provisionar`) chamam
`ctx.journal.registrar(...)` **antes** de invocar o repositório ou a
gravação em disco correspondente, usando os dados de entrada já
disponíveis (já que o identificador gerado pela entidade, quando aplicável,
ainda não existe nesse ponto). Essa ordem é verificada automaticamente por
`tests/run-write-ahead.js`, que lê o journal diretamente do disco após uma
sequência de operações e confirma que toda transação relevante (criação de
usuário, organização, contrato, lote, e cada transição de status/estado
físico de um equipamento) gerou uma entrada correspondente, com números de
sequência contínuos e checksums íntegros.

## 6. Escrita atômica de arquivos

Todas as gravações de estado (`src/core/storage.ts`) seguem o padrão
"escrever em arquivo temporário → fsync → `rename()`":

- O `rename()` em um mesmo sistema de arquivos é uma operação atômica no
  nível do SO (POSIX e NTFS): o arquivo de destino nunca fica em um estado
  parcialmente escrito visível a outros processos.
- Isso protege contra corrupção de dados em caso de interrupção abrupta
  (queda de energia, `kill -9`, travamento do sistema) durante uma
  gravação — o pior cenário possível é a perda da última transação (que já
  está registrada no journal antes de ser aplicada), nunca um arquivo de
  estado corrompido/ilegível.

## 7. Resumo das escolhas e limitações desta etapa

| Aspecto | Escolha nesta etapa | Motivo | Evolução prevista |
|---|---|---|---|
| Dados em repouso | AES-256-GCM | Padrão NIST, autenticado | Migrar chave para KMS/HSM |
| Chave mestra | Arquivo local, permissões restritas | Exigência da especificação desta etapa | Cofre de segredos dedicado |
| Hash de senha | SHA-256 iterado (100k rounds) + salt | Exigência explícita de SHA-256 | Migrar para `scrypt`/`argon2id` |
| Sessão | Expira em 30 min de inatividade (sliding) | Equilíbrio segurança/usabilidade | Configurável por política, MFA |
| Persistência | Arquivos de texto cifrados, escrita atômica | Escopo desta etapa (sem RDBMS) | Banco de dados relacional |
| Auditoria | Journal write-ahead, checksum, retenção 180d | Rastreabilidade e recuperação | Envio a SIEM/observabilidade externa |

## 8. Segurança da API HTTP (AV2)

| Aspecto | Implementação | Onde |
|---|---|---|
| Autenticação | JWT HS256 (`@fastify/jwt`), expiração de 30 min, segredo mínimo de 32 caracteres exigido na inicialização | `plugins/autenticacao.ts`, `config.ts` |
| Revogação imediata | A cada requisição o usuário é relido do banco: conta desativada, removida ou com papel alterado vale na hora, sem esperar o token expirar | `AuthService.obterAtor` |
| Senhas | `bcrypt` (custo 12 por padrão, salt embutido), política de força (8+ caracteres, maiúscula e número), comparação com hash "isca" para tempo constante e mensagem genérica (evita enumeração de contas) | `AuthService` |
| Autorização | Matriz de papéis por rota (`admin`, `cadastro`, `almoxarifado`, `auditor`) em hook `onRequest`, **antes** da validação do corpo (quem não tem permissão sempre recebe 403); auditor bloqueado em qualquer método de escrita; delete definitivo só para admin | `permitir()`, `routes/rotas.ts` |
| Verificação automática | Varredura de todas as rotas × todos os papéis (43 rotas) e teste de 401 sem token | `tests/run-api.js`, seção 11-C |
| Validação de entrada | JSON Schema em todas as rotas (campos extras removidos, enums, tamanhos), regras de domínio nos services | `routes/rotas.ts`, `services/` |
| Integridade no banco | `UNIQUE`, `CHECK`, FKs e triggers de imutabilidade (movimentações e auditoria) | `prisma/migrations/` |
| Concorrência | Transações + versionamento otimista + trava de lote (`FOR UPDATE`) | `db/unidadeDeTrabalho.ts`, repositórios |
| Auditoria | Tabela `Auditoria` gravada na mesma transação da operação; imutável | `AuditoriaRepository` |
| Erros | Respostas padronizadas sem detalhes internos (500 genérico, stack só no log) | `plugins/erros.ts` |
| Dependências | `npm audit` sem vulnerabilidades conhecidas na data desta entrega | — |

Limitações: sem limitação de taxa (rate limiting) nem bloqueio por tentativas
de login; sem refresh token; segredo JWT simétrico. Em produção: HTTPS em
proxy reverso, segredo forte por ambiente e `CORS_ORIGIN` restrito ao front-end.
