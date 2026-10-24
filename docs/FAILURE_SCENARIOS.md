# Cenários de Falha Testados — greencode

Este documento descreve os cenários de falha e de uso indevido cobertos
pelos scripts automatizados (`tests/run-journey.js` e
`tests/run-security.js`) e pela própria arquitetura do sistema, explicando
o que foi testado, como foi provocado e qual a resposta observada do
`greencode` em cada caso.

## 1. Falhas de validação de dados

| Cenário | Como foi provocado | Resposta do sistema |
|---|---|---|
| CNPJ com sequência repetida (ex.: `11111111111111`) | `org criar --cnpj 11111111111111 ...` | Rejeitado antes de qualquer gravação, com mensagem `[ERRO] CNPJ invalido (sequencia repetida).` Nenhum registro é criado. |
| CNPJ com dígitos verificadores incorretos | `org criar --cnpj 11222333000199 ...` (últimos 2 dígitos alterados) | Rejeitado com `[ERRO] CNPJ invalido: digitos verificadores nao conferem.` |
| Lote com data de entrada futura | `lote criar ... --data 2099-01-01` | Rejeitado com `[ERRO] Data de entrada nao pode ser futura.` |
| Contrato de coleta associado a organização inexistente | `contrato criar --org 00000000000000 --inicio 2026-01-10` | Rejeitado com `[ERRO] Organizacao com CNPJ ... nao encontrada. Cadastre-a antes.` Nenhum contrato é criado. |
| Contrato de coleta com frequência inválida (zero ou negativa) | `contrato criar --org <cnpj> --inicio 2026-01-10 --frequencia -5` | Rejeitado com `[ERRO] Frequencia de coleta deve ser um numero de dias maior que zero.` |
| Lote com data de entrada anterior a 90 dias | `lote criar ... --data <hoje-100 dias>` | Rejeitado com `[ERRO] Data de entrada nao pode ser anterior a 90 dias.` |
| Equipamento movido para "desmonte" sem triagem completa | `equipamento mover <id> --status desmonte` antes de `equipamento triagem <id>` | Rejeitado com `[ERRO] Equipamento so pode ser movimentado para 'desmonte' apos passar por triagem completa.` O status do equipamento permanece inalterado. |
| Queda de 2+ categorias no estado físico sem justificativa | `equipamento estado <id> --novo sucata` partindo de um estado 2+ categorias acima, sem `--justificativa` | Rejeitado com `[ERRO] ... exige justificativa textual (--justificativa "...")`. Nenhuma movimentação é registrada. |
| Queda de apenas 1 categoria | `equipamento estado <id> --novo seminovo` a partir de "novo" | Aceito sem exigir justificativa (regra é específica para quedas de 2 ou mais categorias). |

**Comportamento geral:** todas as validações de negócio ocorrem **antes**
de qualquer escrita em disco (validação em memória, na camada de
repositório/validators). Uma operação rejeitada não deixa rastro parcial
no estado persistido — apenas tentativas de LOGIN e comandos inválidos são
registradas no journal para fins de auditoria (ver seção 4).

## 2. Falhas de autenticação e autorização

| Cenário | Como foi provocado | Resposta do sistema |
|---|---|---|
| Senha fraca no provisionamento | Informar `123` como senha do administrador | Rejeitada com `[ERRO] A senha deve ter no minimo 8 caracteres. Tente novamente.` — o sistema **volta a pedir** usuário/senha em loop, sem derrubar o processo. |
| Senhas de confirmação divergentes no provisionamento | Digitar senhas diferentes na definição e na confirmação | `[ERRO] As senhas nao conferem. Tente novamente.` — novo par de senha/confirmação é solicitado. |
| Login com senha incorreta | `login` com usuário válido e senha errada | `[ERRO] Usuario ou senha invalidos.` (mensagem genérica, não revela se o problema foi o usuário ou a senha — mitiga enumeração de contas). Evento `LOGIN_FALHOU` gravado no journal. |
| Login com usuário inexistente | `login` com usuário que não existe | Mesma mensagem genérica `Usuario ou senha invalidos.` — o sistema não informa se a conta existe. |
| Usuário desativado pelo administrador | `usuario desativar <username>` seguido de tentativa de login com esse usuário | Login bloqueado com a mesma mensagem genérica de credenciais inválidas (o usuário desativado não recebe tratamento diferenciado, para não revelar que a conta existe mas está desativada). |
| Renomeação de usuário para um nome já existente, inexistente ou inválido | `usuario renomear <atual> <novo>` | Operação rejeitada com mensagem de validação; nenhum dado é alterado. A renomeação válida é registrada no journal (`USUARIO_RENOMEADO`) antes da gravação; registros históricos mantêm o nome antigo, preservando a trilha de auditoria. |
| Sessão expirada por inatividade (30 min) | Nenhum comando executado por mais de 30 minutos | Ao tentar o próximo comando, o sistema detecta a expiração via `exigirSessaoValida()`, invalida a sessão, grava `SESSAO_EXPIRADA` no journal, exibe aviso e solicita novo login automaticamente — o comando original não é executado. |
| Operador de cadastro tentando cadastrar equipamento | Usuário com papel `cadastro` executando `equipamento cadastrar ...` | Bloqueado com `[PERMISSAO NEGADA] Acao nao permitida para o papel 'cadastro'. Papeis permitidos: admin, almoxarifado.` |
| Operador de cadastro tentando criar usuários | Usuário com papel `cadastro` executando `usuario criar ...` | Bloqueado com `[PERMISSAO NEGADA] ... Papeis permitidos: admin.` |
| Gestor de almoxarifado tentando cadastrar organização | Usuário com papel `almoxarifado` executando `org criar ...` | Bloqueado com `[PERMISSAO NEGADA] ... Papeis permitidos: admin, cadastro.` |
| Auditor tentando executar operação de escrita | Usuário com papel `auditor` executando `org criar ...` | Bloqueado com `[ERRO] O papel 'auditor' possui acesso somente de consulta. Acao 'criar' nao permitida.` mesmo o recurso `org` sendo, em tese, restrito a `admin`/`cadastro` (o auditor nem chega a essa checagem, pois a segunda camada de restrição de leitura já bloqueia antes). |

**Observação de design:** em nenhum dos cenários acima o processo é
encerrado ou trava — o loop de comandos captura os erros tipados
(`ErroValidacao`, `ErroPermissao`, `ErroSessao`) e retoma a leitura do
próximo comando normalmente. Isso foi verificado explicitamente pelo teste
"Comando desconhecido é tratado sem encerrar o processo", que executa um
comando inválido e, na sequência, confirma que o sistema continua
respondendo a comandos válidos.

## 3. Falhas de integridade e persistência

| Cenário | Mecanismo de proteção | Como seria observado |
|---|---|---|
| Interrupção do processo durante uma escrita de estado (queda de energia, `kill -9`) | Escrita atômica via arquivo temporário + `fsync` + `rename()` (`src/core/storage.ts`) | O arquivo de destino nunca é sobrescrito parcialmente: ou contém a versão anterior completa, ou a nova versão completa. Um arquivo `.tmp` órfão pode ficar no diretório, mas nunca é lido pelo sistema (apenas o arquivo final, sem sufixo `.tmp`, é considerado). |
| Interrupção durante a gravação de uma linha do journal | `fsync` após cada `appendFileSync` (`Journal.registrar` → `apendarLinha`) | Reduz a janela de perda de dados a praticamente zero para a última transação. Ao ler o histórico (`lerHistorico`), linhas JSON incompletas (parcialmente gravadas) são detectadas por falha de `JSON.parse` e **ignoradas silenciosamente na leitura**, mas permanecem no arquivo bruto para investigação forense posterior — a leitura nunca falha por causa de uma linha corrompida. |
| Adulteração de uma entrada do journal após gravada | Checksum SHA-256 por entrada (`Journal.verificarIntegridade`) | Uma entrada adulterada apresenta checksum divergente do recalculado, permitindo detecção em uma rotina de auditoria/verificação de integridade. |
| Arquivo de dados cifrado corrompido ou com chave incorreta | AES-256-**GCM** (modo autenticado) | A decifragem falha explicitamente (exceção lançada por `decipher.final()`) quando a *auth tag* não confere — o sistema não retorna dados corrompidos/adulterados silenciosamente. |
| Journal atingindo o limite de 10 MB | Rotação automática antes de cada nova gravação (`rotacionarSeNecessario`) | O arquivo ativo é renomeado para `journal-<timestamp>.log` e um novo `journal.log` vazio passa a receber as próximas entradas, sem perda de continuidade de sequência (`seq`). |
| Colisão na alocação automática de código de barras interno | `EquipamentoRepo.alocarCodigoBarrasInterno` gera o código combinando timestamp (base 36) e bytes aleatórios, e verifica contra a lista atual em laço | Se, teoricamente, o código gerado já existir, um novo código é gerado e testado novamente até obter um valor único — o cadastro nunca falha por colisão de código interno, verificado em `tests/run-compliance.js` com dois cadastros sucessivos sem `--codigo`. |
| Execução da política de retenção (`config retencao`) | Remove apenas arquivos **já rotacionados** com mais de 180 dias | Arquivos de journal com menos de 180 dias, incluindo o `journal.log` ativo, nunca são removidos, mesmo que o comando seja executado repetidamente. |

Verificado automaticamente em `tests/run-journey.js` (etapa 7): após uma
jornada completa de uso, o teste lê diretamente os arquivos em disco e
confirma que (a) o journal foi gravado e contém as entradas esperadas em
texto legível (por ser um log de auditoria, não é cifrado, mas fica no
mesmo diretório protegido dos demais dados) e (b) os arquivos de dados de
negócio (organizações, credenciais) **não** contêm as strings originais em
texto plano — comprovando que a cifragem está de fato sendo aplicada e não
apenas simulada.

## 4. Rastreabilidade sob falha

Mesmo em cenários de erro, o sistema mantém rastro auditável:

- Tentativas de login malsucedidas são registradas (`LOGIN_FALHOU`), com
  o nome de usuário informado (mas nunca a senha), permitindo detectar
  tentativas de força bruta em uma auditoria posterior.
- Expirações de sessão são registradas (`SESSAO_EXPIRADA`), com o tempo de
  inatividade observado.
- Alterações de estado físico com justificativa registram o texto da
  justificativa na movimentação (`Movimentacao.justificativa`), preservando
  o motivo declarado mesmo em auditorias futuras.

## 5. Limitações conhecidas desta etapa (não são "falhas", mas escopo)

- **Concorrência multi-processo**: a persistência em arquivo único por
  entidade assume um único processo `greencode` operando sobre um mesmo
  diretório de dados por vez. Múltiplos processos concorrentes escrevendo
  simultaneamente no mesmo arquivo podem gerar condição de corrida na
  ordem de leitura-modificação-escrita (não há bloqueio de arquivo/lock
  distribuído nesta etapa). Isso é uma limitação aceita para a etapa de
  arquivos de texto, a ser resolvida pela migração ao banco de dados
  relacional (com transações ACID) nas próximas etapas do projeto.
- **Sem MFA**: a autenticação é de fator único (usuário/senha). Migração
  futura pode adicionar segundo fator.
- **Chave mestra em arquivo local**: ver `docs/SECURITY.md`, seção 1.1,
  para a limitação e o plano de evolução para um cofre de segredos
  dedicado.

## API HTTP (AV2)

| Cenário | Entrada | Resposta observada |
|---|---|---|
| Requisição sem token, token inválido, adulterado ou expirado | qualquer rota protegida | 401 `NaoAutenticado` |
| Usuário desativado com token ainda válido | qualquer rota protegida | 401 imediato (o usuário é relido do banco) |
| Credenciais erradas ou usuário inexistente | `POST /auth/login` | 401 com a mesma mensagem genérica |
| Papel sem permissão / auditor tentando escrever | rota restrita / POST, PATCH | 403 `ErroPermissao` |
| Corpo fora do JSON Schema (campo ausente, enum inválido, página > 100) | qualquer rota | 400 `ErroValidacao` |
| CNPJ inválido, data de lote futura ou > 90 dias, desmonte sem triagem, queda de 2+ estados sem justificativa | regras de negócio | 400 |
| CNPJ, código de barras, NF por organização ou contrato duplicados | criação | 409 `Conflito` (também barrado por UNIQUE no banco) |
| Versão desatualizada / duas escritas simultâneas | PATCH/POST com `versao` | 409; só uma escrita vence |
| Falha no meio de uma operação composta (2º equipamento do lote duplicado) | `POST /lotes` | 409 e rollback total (lote, equipamentos e auditoria não são gravados) |
| Alteração direta no banco violando regra (CNPJ malformado, desmonte sem triagem, UPDATE em Movimentacao) | SQL manual | rejeitada por CHECK/trigger |
| `JWT_SECRET` ausente/fraco ou `DATABASE_URL` ausente | inicialização | servidor recusa iniciar com mensagem clara |
| SIGINT/SIGTERM com requisições em andamento | encerramento | conclui as requisições, fecha o pool e sai com código 0 (limite configurável) |
| Lote em organização sem contrato, com contrato encerrado ou inativa | `POST /lotes` | 409 (a organização sem contrato continua ativa) |
| Operar/consultar equipamento de lote inativado | qualquer rota de equipamento | 404 (reaparece ao reativar a organização ou o lote) |
| Delete definitivo por quem não é admin | `DELETE ...?permanente=true` | 403 |
| Excluir definitivamente usuário que já tem lotes/movimentações | `DELETE /usuarios/:id?permanente=true` | 409; orienta a inativar |
| Recadastrar CNPJ de organização inativa | `POST /organizacoes` | 409 orientando a reativar |
| Alterar o status do lote manualmente | `PATCH /lotes/:id/status` | 404 (o status é derivado dos equipamentos) |
| Equipamento com tipo vazio | `POST /equipamentos` | 400 |
| Reabrir contrato já ativo, excluído ou de organização inativa | `POST /contratos/:id/reativar` | 409 / 404 |
| Contrato de organização inativa: alterar ou encerrar | `PATCH`/`POST encerrar` | 409 (reative a organização) |
| Admin altera o próprio papel / exclui a própria conta | `PATCH /usuarios/:id/papel`, `DELETE ...?permanente=true` | 400 |
| Parâmetro global com chave inválida, ou versão desatualizada | `PUT /config/:chave` | 400 / 409 |
