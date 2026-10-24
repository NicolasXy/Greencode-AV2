# greencode API (AV2)

Servidor HTTP monolítico do greencode: Node.js + TypeScript, **Fastify**,
**Prisma ORM** e **PostgreSQL**. O CLI da etapa anterior continua
funcionando (`npm start`) e as regras de negócio dele (validadores,
fábricas, entidades polimórficas) são **reaproveitadas** pela API.

## 1. Como executar

Requisitos: Node.js 20.19+ (ou 22.12+/24+) e PostgreSQL 14+.

```bash
npm install
cp .env.example .env        # Windows (PowerShell): Copy-Item .env.example .env
# edite .env: DATABASE_URL e JWT_SECRET (minimo 32 caracteres)

npm run db:migrate          # aplica prisma/migrations (tabelas + constraints + triggers)
npm run build
npm run db:seed             # massa de dados inicial (idempotente); equivale a: npx prisma db seed
npm run serve               # sobe em PORT (padrao 3000)
```

Atalho: `npm run db:setup` (migra, compila e popula).

- Documentação interativa (OpenAPI/Swagger): `http://localhost:3000/docs`; contrato exportado em `docs/openapi.json` (`npm run docs:openapi`)
- Saúde: `GET /api/v1/health`
- Usuários do seed (senha `SEED_SENHA`, padrão `Greencode#2026`):
  `admin`, `cadastro1`, `almox1`, `auditor1`.
- Sem seed: `POST /api/v1/auth/provisionar` cria o primeiro administrador
  (só funciona com o banco sem usuários — equivalente ao modo de
  provisionamento do CLI).

PostgreSQL local rápido:

| Plataforma | Comando |
|---|---|
| Ubuntu 24.04+ | `sudo apt install postgresql` e `sudo -u postgres psql -c "CREATE USER greencode WITH PASSWORD 'greencode' CREATEDB;" -c "CREATE DATABASE greencode OWNER greencode;"` |
| Windows 10+ | instalador oficial do PostgreSQL (EDB) ou `winget install PostgreSQL.PostgreSQL`; depois crie o usuário/banco com `psql` ou pgAdmin |
| Qualquer (Docker) | `docker compose up -d` (usa o `docker-compose.yml` do projeto) ou `docker run -d -p 5432:5432 -e POSTGRES_USER=greencode -e POSTGRES_PASSWORD=greencode -e POSTGRES_DB=greencode postgres:16` |

Nenhuma compilação é necessária: o Prisma 7 usa o driver `pg` (adapter
`@prisma/adapter-pg`) e o `bcrypt` já vem com binários pré-compilados para
Windows e Linux (x64 e arm64), o que mantém a instalação idêntica em
Windows 10+ e Ubuntu 24.04+ (e derivadas). O cliente
Prisma já vem gerado em `src/server/generated`; se alterar o
`schema.prisma`, rode `npm run prisma:generate`.

Variáveis de ambiente: ver `.env.example` (`PORT`, `HOST`, `DATABASE_URL`,
`JWT_SECRET`, `JWT_EXPIRES_IN`, `BCRYPT_ROUNDS`, `CORS_ORIGIN`, `LOG_LEVEL`,
`SHUTDOWN_TIMEOUT_MS`).

## 2. Arquitetura em camadas

```
HTTP ─► routes/rotas.ts        JSON Schema + papeis permitidos por rota
        └► controllers/*       traduz HTTP -> chamada de servico (sem regra de negocio)
           └► services/*       regras de negocio, validacoes, transacoes, versionamento
              └► repositories/*   unica camada que usa o Prisma Client (consultas/gravacoes)
                 └► PostgreSQL    constraints, indices, triggers
```

- `src/server/app.ts`: composition root (monta UnidadeDeTrabalho, services,
  controllers e rotas; não abre porta, o que permite testar com `app.inject`).
- `src/server/server.ts`: lê `PORT`, sobe o servidor e faz **graceful
  shutdown** (SIGINT/SIGTERM: para de aceitar conexões, espera as
  requisições em andamento, fecha o pool do banco; temporizador de
  segurança configurável).
- `src/server/db/unidadeDeTrabalho.ts`: entrega repositórios ligados à
  conexão normal (`simples()`) ou a uma transação (`transacao(fn)`).
- Reuso do domínio do CLI: `OrganizacaoFactory`, `LoteFactory`,
  `EquipamentoFactory` (subclasses Terminal/CPU/Monitor/Servidor/Genérico),
  `ValidadorCNPJ`, `ValidadorContratoColeta`, `ValidadorDataLote` e as
  regras de transição de equipamento são chamados pelos services.

## 3. Modelo de dados (`prisma/schema.prisma`)

`Organizacao 1—0..1 Contrato`, `Organizacao 1—N Lote`, `Lote 1—N
Equipamento`, `Equipamento 1—N Movimentacao`, além de `Usuario` e
`Auditoria` (equivalente ao journal). Todos os modelos mutáveis têm o campo
`versao`. `Contrato.clausulas` é `JSONB`; ids são `UUID`.

**Restrições no banco** (migração `..._constraints`), a última barreira
contra estados inconsistentes mesmo para quem contorna a API:

| Regra | Mecanismo |
|---|---|
| CNPJ único e com 14 dígitos | `UNIQUE` + `CHECK` |
| Código de barras = id do equipamento, único | `UNIQUE` + `CHECK (codigoBarrasInterno = id::text)` |
| Posição automática única dentro do lote | `UNIQUE (loteId, posicao)` + `CHECK (posicao >= 1)` |
| Um contrato por organização | `UNIQUE (organizacaoId)` |
| NF única por organização | `UNIQUE (organizacaoId, nf)` |
| Frequência de coleta > 0; `versao >= 1` | `CHECK` |
| Equipamento em `desmonte` exige triagem concluída | `CHECK` |
| Movimentação com pares de/para coerentes | `CHECK` |
| Movimentação e Auditoria imutáveis | `TRIGGER` bloqueando UPDATE/DELETE diretos (ações de FK, como a cascata, são permitidas) |
| Delete definitivo em cadeia | FKs `ON DELETE CASCADE`: organização → contrato/lotes → equipamentos → movimentações |
| Usuário com histórico não pode ser apagado | FKs `ON DELETE RESTRICT` (retorna 409; use inativar) |

## 4. Autenticação stateless (JWT)

1. `POST /api/v1/auth/login` verifica a senha com **bcrypt** (pacote nativo `bcrypt`, com binários pré-compilados para Windows e Linux; custo
   configurável, hash isca para tempo de resposta constante e mensagem
   genérica, evitando enumeração de contas) e devolve um JWT assinado
   (`@fastify/jwt`, HS256) com `sub` (id), `username` e `papel`.
2. O cliente envia `Authorization: Bearer <token>` em todas as requisições.
3. Um hook global `onRequest` valida assinatura e expiração (padrão 30 min,
   como no CLI) e **relê o usuário no banco** para garantir que a conta
   continua ativa e usar o papel atual: desativar uma conta ou trocar o
   papel vale imediatamente, sem esperar o token expirar.
4. Autorização por papel (mesma matriz do CLI) no `preHandler` de cada
   rota; o **auditor** é bloqueado em qualquer método que não seja de
   leitura (exceto trocar a própria senha).

| Recurso | admin | cadastro | almoxarifado | auditor |
|---|---|---|---|---|
| `/usuarios` | sim | — | — | — |
| `/organizacoes`, `/contratos` | sim | sim | — | leitura |
| `/lotes` | sim | sim | sim | leitura |
| `/equipamentos` | sim | — | sim | leitura |
| `/rastreio/:id` | todos | todos | todos | todos |
| `/auditoria` | leitura | — | — | leitura |

## 5. Transações e concorrência

- **Transações atômicas** (`prisma.$transaction`, via `UnidadeDeTrabalho`):
  criação de lote com vários equipamentos (tudo ou nada); mudança de
  status/estado de equipamento + movimentação + auditoria; cadastros e
  alterações com registro de auditoria na mesma transação.
- **Versionamento otimista**: cada atualização executa
  `UPDATE ... WHERE id = ? AND versao = ?` e incrementa `versao`. Se
  nenhuma linha for afetada, a API responde **409 Conflito**. O cliente
  pode enviar `versao` (a que ele leu) no corpo; se omitida, usa-se a
  versão lida dentro da própria transação. Testado com requisições
  realmente simultâneas: uma vence, a outra recebe 409, sem atualização
  perdida.

## 6. Endpoints (prefixo `/api/v1`)

| Método e rota | Descrição |
|---|---|
| `POST /auth/provisionar` | cria o 1º admin (banco sem usuários) |
| `POST /auth/login` | autentica, devolve JWT |
| `GET /auth/me` · `POST /auth/senha` | usuário atual · troca da própria senha |
| `POST/GET /usuarios` · `PATCH /usuarios/:id/username` · `PATCH /usuarios/:id/ativo` · `DELETE /usuarios/:id[?permanente=true]` | criar, listar, renomear, ativar/desativar, soft/hard delete |
| `POST/GET /organizacoes` · `GET/PATCH /organizacoes/:cnpj` · `DELETE /organizacoes/:cnpj[?permanente=true]` · `POST /organizacoes/:cnpj/reativar` | organizações (soft delete em cadeia, reativação, hard delete) |
| `POST/GET /contratos` · `GET/PATCH /contratos/:id` · `POST /contratos/:id/encerrar` · `POST /contratos/:id/reativar` · `DELETE /contratos/:id` | contratos de coleta (só delete definitivo) |
| `POST/GET /lotes` · `GET /lotes/:id` · `DELETE /lotes/:id[?permanente=true]` · `POST /lotes/:id/reativar` | lotes (criação aceita `equipamentos[]`; o status é derivado, não editável) |
| `POST/GET /equipamentos` · `GET/DELETE /equipamentos/:id` | equipamentos (código de barras = id; posição automática; só delete definitivo) |
| `POST /equipamentos/:id/triagem` · `PATCH .../status` · `PATCH .../estado` | transições de negócio |
| `GET /equipamentos/:id/depreciacao?meses=N` | depreciação (polimorfismo) |
| `GET /rastreio/:id` | histórico de movimentações |
| `GET /auditoria?acao=` | trilha de auditoria |
| `GET/PUT/DELETE /config[/:chave]` | parâmetros globais (admin), como `config set/get` do CLI |
| `PATCH /lotes/:id` · `PATCH /equipamentos/:id` · `PATCH /usuarios/:id/papel` · `PATCH /usuarios/:id/senha` | edição de lote (NF, transportadora, data), tipo do equipamento, papel e senha de usuário |

Listagens de organizações e lotes aceitam `incluirInativos=true`. Todas as listagens aceitam `pagina` e `tamanhoPagina` (máx. 100) e respondem
`{ itens, total, pagina, tamanhoPagina, totalPaginas }`. Erros seguem
`{ erro, mensagem }`: 400 validação, 401 não autenticado, 403 sem
permissão, 404 não encontrado, 409 conflito (duplicidade, versão), 500.

## 7. Decisões arquiteturais, trade-offs e alternativas rejeitadas

| Decisão | Por quê | Alternativa rejeitada / custo |
|---|---|---|
| Monólito em camadas | Implantação e depuração simples nesta fase; coesão do domínio; a camada de serviço fica independente de HTTP (o CLI continua usando o mesmo domínio) | Microsserviços: complexidade operacional sem ganho agora. Custo: escalar tudo junto |
| Fastify | JSON Schema nativo (validação antes do controller), hooks, plugins, boa performance | Express: mais minimalista, mas exige bibliotecas extras para validação |
| Prisma 7 + adapter `pg` | Tipos TS gerados, migrações versionadas, `$transaction`; sem binário nativo (portável entre Windows e Linux) | SQL manual/knex: mais controle, mais código e menos segurança de tipos. Custo: constraints avançadas ficam em SQL de migração |
| PostgreSQL | ACID, `JSONB`, `UUID`, `CHECK` e triggers | MySQL: menos recursos de constraint/JSON nativo |
| JWT stateless + releitura do usuário | Escala sem sessão em memória e ainda revoga na hora | JWT puro: não revoga até expirar. Custo: 1 consulta extra por requisição |
| bcrypt (pacote nativo `bcrypt`) | Exigido pelo requisito; salt embutido, custo ajustável; traz binários pré-compilados (win32/linux x64 e arm64), sem compilar nada | `bcryptjs` (JS puro, mais lento) e SHA-256 iterado do CLI: aceitável, mas bcrypt é o padrão |
| Versionamento otimista | Evita atualização perdida sem bloquear linhas; conflitos são raros | Lock pessimista (`SELECT FOR UPDATE`): serializa e pode travar. Custo: cliente trata 409 |
| Auditoria no banco, na mesma transação | Equivalente ao write-ahead do CLI com atomicidade real | Arquivo de journal: não participa da transação do banco |
| Constraints/triggers além da validação em código | Proteção contra bugs e acessos diretos ao banco | Só validar em código. Custo: regras duplicadas (por isso a camada de serviço dá a mensagem amigável e o banco é a barreira final) |
| Papel por rota + hook global para o auditor | Mesma matriz do CLI, em duas camadas | Papéis só no serviço: espalha checagens |

Datas de lote (`dataEntrada`) são validadas contra a data UTC do servidor
(sem futuro e no máximo 90 dias atrás); clientes em fusos muito à frente do
UTC podem ver uma data "de hoje" rejeitada nas primeiras horas do dia.

Limitações conhecidas: sem rate limiting/bloqueio por tentativas de login;
JWT sem refresh token (a expiração de 30 min exige novo login); segredo
JWT simétrico (HS256) — em produção, usar segredo forte por ambiente e
HTTPS terminado em proxy reverso.

## 8. Regras confirmadas pelo cliente (dúvidas da AV2)

| Resposta do cliente | Como está implementado |
|---|---|
| Soft delete (inativar) **e** delete padrão (definitivo) | `DELETE /recurso/:id` inativa; `?permanente=true` apaga de vez. Organizações, lotes e usuários têm os dois; **o delete definitivo é restrito ao admin** (decisão nossa: é irreversível) |
| Comportamento em cadeia | Inativar organização inativa **todos os seus lotes** (mesmo carimbo de tempo) e, como os equipamentos dependem do lote, eles deixam de aparecer/operar. Reativar a organização reativa **só** os lotes inativados junto com ela. Delete definitivo apaga contrato, lotes, equipamentos e movimentações em cadeia (FK `CASCADE`) |
| Equipamentos e contratos: só delete | `DELETE /equipamentos/:id` e `DELETE /contratos/:id` são definitivos; não existe soft delete para eles (o contrato ainda pode ser *encerrado*, o que o torna inativo) |
| Sem contrato a organização **não** vira inativa, mas não recebe lotes | Criar lote exige organização ativa **e** contrato ativo (409 caso contrário) |
| Inativar organização com contrato ativo: sem restrição | Permitido; o contrato não impede a inativação |
| Status do lote é controlado pelos equipamentos; só muda quando **todos** têm o mesmo status | `services/statusLote.ts`: todos `aguardando_triagem` → `recebido`; todos `em_triagem` → `em_triagem`; todos `triado` → `triagem_completa`; todos em `reciclagem`/`descarte_seguro`/`revenda` → `encerrado` (mistura de destinos finais conta, pois um lote real tem destinos diferentes — **interpretação nossa**). Qualquer outra combinação mantém o status. O status do lote não é editável pela API. O recálculo roda na mesma transação, com o lote travado (`FOR UPDATE`) para evitar corrida |
| Código de barras é o id do equipamento | O id (UUID) é gerado pelo servidor e gravado também em `codigoBarrasInterno` (CHECK no banco garante a igualdade); o cliente não informa código |
| Posição no lote automática (índice de array) | 1, 2, 3... por lote, calculada com o lote travado; únicas mesmo com cadastros simultâneos. Não é renumerada após exclusões (mantém a referência estável) |
| Admin acessa **todas** as rotas | Todas as rotas incluem o papel `admin` |
| Listagens bloqueadas para quem não é responsável (operador não vê usuários) | Matriz da seção 4: `/usuarios` só admin, etc. |
| Scripts de teste não são obrigatórios, mas ajudam | `npm run test:api` (caminho feliz e erros) |

Nota: o CLI da AV1 não foi alterado por estas respostas (elas se aplicam à API).

## 9. Testes

`npm run test:api` (requer PostgreSQL; cria e remove um banco temporário
próprio, com `TEST_DATABASE_ADMIN_URL` opcional) executa 195 verificações:
migrações, JWT (inclusive expirado e adulterado), RBAC, JSON Schema, regras
de negócio, regras confirmadas pelo cliente (seção 8), transações com
rollback, concorrência real, constraints e triggers no banco, seed,
servidor real em porta por variável de ambiente e graceful shutdown. `npm test` executa também as suítes do CLI.
