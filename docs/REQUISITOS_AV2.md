# Rastreabilidade: requisitos da AV2 e dúvidas respondidas

Cada linha aponta onde o requisito é atendido e qual teste (`npm run test:api`,
`tests/run-api.js`) o comprova. "CLI" = suítes do CLI da AV1 (continuam passando).

## A. Requisitos do PDF da AV2

| # | Requisito | Onde | Comprovação |
|---|---|---|---|
| 1 | Node.js + TypeScript | `tsconfig.json` (strict), `src/server/**` | build sem erros |
| 2 | Fastify (JSON Schema, hooks, plugins) | `src/server/app.ts`, `routes/rotas.ts` (schema em todas as rotas), `plugins/` | seção 4 (JSON Schema → 400) |
| 3 | Prisma ORM + PostgreSQL | `prisma/schema.prisma`, `src/server/db`, `repositories/` | seções 1 e 10 |
| 4 | Controller → Service → Repository, divisão estrita | `controllers/`, `services/`, `repositories/` | seção 11-B (análise estática: controllers/plugins não importam repositórios; services não importam Fastify; repositories não importam services) |
| 5 | Controllers só tratam HTTP | `controllers/*` | idem |
| 6 | Services: validações, transições de status, cálculos | `services/*`, reuso de `src/validation`, `src/factories`, `src/models` | seção 5 (desmonte exige triagem, justificativa, depreciação) |
| 7 | Repositories com Prisma Client | `repositories/*` | seção 11-B |
| 8 | Porta por variável de ambiente | `config.ts` (`PORT`), `server.ts` | seção 14 |
| 9 | Graceful shutdown | `server.ts` (SIGINT/SIGTERM, timeout) | seção 14 (SIGTERM → código 0) |
| 10 | `schema.prisma` com Organizacao, Contrato, Lote, Equipamento, Movimentacao e relações (Org 1–0..1 Contrato, Org 1–N Lote, Lote 1–N Equipamento, Equipamento 1–N Movimentacao) | `prisma/schema.prisma` | seções 4–6 |
| 11 | Eager loading / seleção de campos | `LoteRepository.buscarDetalhado`, `select` em consultas | seção 5 (lote detalhado) |
| 12 | Migrações versionadas | `prisma/migrations/*` (4 migrações) + `prisma migrate deploy` | seção 1 |
| 13 | PostgreSQL com JSON e UUID | `Contrato.clausulas` (JSONB), ids UUID | seção 4 |
| 14 | JWT com `@fastify/jwt` | `plugins/autenticacao.ts` | seção 2 (válido, inválido, adulterado, expirado) |
| 15 | Hash de senha com **bcrypt** | `services/AuthService.ts` (pacote `bcrypt`) | seção 2 (hash `$2b$`) |
| 16 | Login devolve JWT com id e papel; `Authorization: Bearer` | `AuthController.login` | seção 2 |
| 17 | Hook global valida o token e injeta o usuário na requisição | `onRequest` → `req.ator` | seção 2 |
| 18 | Serviços usam o papel para autorizar | `permitir(...)` (hook `onRequest`, antes da validação) + checagens nos services | seções 3 e 11-C (43 rotas × 4 papéis) |
| 19 | Transações (`$transaction`) em operações compostas | `db/unidadeDeTrabalho.ts` | seção 6 (rollback total) |
| 20 | Versionamento otimista (campo `versao`, verificado antes de cada update) | `atualizarComVersao` em todos os repositórios; `versao` em Usuario, Organizacao, Contrato, Lote, Equipamento, ParametroGlobal (Movimentacao e Auditoria são imutáveis: nunca sofrem update) | seção 7 (concorrência real: 200 + 409) |
| 21 | Seed com massa representativa | `src/server/seed.ts`; `npm run db:seed` e `npx prisma db seed` | seção 13 |
| 22 | Unicidade de CNPJ e `codigoBarrasInterno`; constraints/triggers contra estados inconsistentes | migrações `..._constraints` e `..._soft_delete_cascata_posicao` | seção 10 |
| 23 | API documentada | Swagger UI em `/docs`, `docs/openapi.json` (`npm run docs:openapi`), `docs/API.md` | seção 12 |
| 24 | Justificar decisões, trade-offs, alternativas | `docs/API.md` §7 | — |
| 25 | Windows 10+ e Ubuntu 24.04.03+ (e derivadas) | sem compilação nativa (`bcrypt` traz binários pré-compilados win32/linux x64 e arm64; Prisma 7 via driver `pg`); instruções para ambos | instalação limpa a partir do zip |
| 26 | Evolução do CLI (RBAC, validações de CNPJ, datas, triagem, justificativa, parâmetros globais, provisionamento, sessão de 30 min, auditoria) | `/auth/provisionar`, matriz de papéis, `/config`, JWT 30 min, `/auditoria` | seções 2, 3, 5, 11-B |

## B. Dúvidas respondidas pelo cliente

| Resposta do cliente | Implementação | Teste |
|---|---|---|
| Scripts de teste não são obrigatórios, mas ajudam | `tests/run-api.js` (caminho feliz e erros) | — |
| Soft delete (inativar) **e** delete padrão | `DELETE` inativa; `?permanente=true` apaga (admin) — organizações, lotes, usuários | seção 11 |
| Em cadeia: org → lotes → equipamentos | inativação com carimbo comum, reativação seletiva, `ON DELETE CASCADE` | seção 11 |
| Equipamentos e contratos: só delete | `DELETE /equipamentos/:id`, `DELETE /contratos/:id` | seção 11 |
| Sem contrato a org continua ativa, mas não recebe lotes | `LoteService.criar` exige org ativa e contrato ativo; contrato encerrado pode ser reaberto (`POST /contratos/:id/reativar`) para a org voltar a receber lotes | seções 11 e 11-B |
| Inativar org com contrato ativo: sem restrição | permitido | seção 11 |
| Status do lote derivado, só muda quando **todos** os equipamentos coincidem | `services/statusLote.ts` | seção 11 |
| Código de barras = id do equipamento | `id` gerado no servidor + `CHECK` | seções 5 e 10 |
| Posição no lote automática | `posicao` sequencial com lote travado | seção 7 |
| Admin acessa todas as rotas / edita, cria e apaga qualquer entidade | admin em todas as rotas; CRUD completo: usuários (criar, renomear, papel, senha, ativar, excluir), organizações, contratos, lotes (editar), equipamentos (editar tipo), parâmetros | seções 3, 11, 11-B |
| Listagens bloqueadas para quem não é responsável | matriz de papéis (`docs/API.md` §4) | seção 3 |
| Operador não vê a lista de usuários | `/usuarios` só admin | seção 3 |
| (Pergunta) listagens de filhos de org inativa | contratos e lotes ocultos por padrão; `incluirInativos=true` | seções 11 e 11-B |

## C. Decisões nossas (não vieram do cliente; vale confirmar)

1. Delete definitivo (`permanente=true`) restrito ao admin, por ser irreversível.
2. Lote vira `encerrado` quando todos os equipamentos estão em destino final
   (`reciclagem`, `descarte_seguro` ou `revenda`), podendo ser destinos diferentes.
3. Usuário com histórico não pode ser excluído definitivamente (409); use inativar.
4. As regras das dúvidas valem para a API; o CLI da AV1 não foi alterado.
