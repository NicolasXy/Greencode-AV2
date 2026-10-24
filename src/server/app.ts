// spiderman
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Configuracao } from "./config";
import { PrismaClient } from "./db/prisma";
import { UnidadeDeTrabalho } from "./db/unidadeDeTrabalho";
import { registrarAutenticacao } from "./plugins/autenticacao";
import { registrarTratamentoDeErros } from "./plugins/erros";
import { registrarRotas } from "./routes/rotas";
import { AuthService } from "./services/AuthService";
import { OrganizacaoService } from "./services/OrganizacaoService";
import { ContratoService } from "./services/ContratoService";
import { EquipamentoService } from "./services/EquipamentoService";
import { LoteService } from "./services/LoteService";
import { AuditoriaService, ParametroService } from "./services/ParametroService";
import { AuthController } from "./controllers/AuthController";
import { ContratoController, OrganizacaoController } from "./controllers/OrganizacaoController";
import { AuditoriaController, EquipamentoController, LoteController, ParametroController } from "./controllers/LoteController";

/**
 * Monta a aplicacao Fastify (composition root): cria a unidade de trabalho,
 * os services, os controllers e registra plugins e rotas. Nao abre porta
 * nem le variaveis de ambiente: isso permite instanciar o app nos testes
 * (via app.inject) e no servidor real (server.ts) com a mesma configuracao.
 */
export async function criarApp(config: Configuracao, prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.logLevel === "silent" ? false : { level: config.logLevel },
    // Limite de corpo: evita payloads gigantes (500 equipamentos cabem com folga).
    bodyLimit: 1024 * 1024,
  });

  const uow = new UnidadeDeTrabalho(prisma);

  // Camada de servicos (regras de negocio).
  const auth = new AuthService(uow, config.bcryptRounds);
  const equipamentos = new EquipamentoService(uow);
  const lotes = new LoteService(uow, equipamentos);
  const organizacoes = new OrganizacaoService(uow);
  const contratos = new ContratoService(uow);
  const parametros = new ParametroService(uow);
  const auditoria = new AuditoriaService(uow);

  registrarTratamentoDeErros(app);
  await app.register(cors, { origin: config.corsOrigin });
  await app.register(swagger, {
    openapi: {
      info: { title: "greencode API", description: "Logistica reversa de residuos eletronicos", version: "2.0.0" },
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
      security: [{ bearerAuth: [] }],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  await registrarAutenticacao(app, { jwtSecret: config.jwtSecret, jwtExpiraEm: config.jwtExpiraEm, carregarAtor: (id) => auth.obterAtor(id) });

  // Todas as rotas de negocio ficam sob /api/v1.
  await app.register(
    async (v1) => {
      await registrarRotas(v1, {
        auth: new AuthController(auth, (p) => app.jwt.sign(p), config.jwtExpiraEm),
        organizacoes: new OrganizacaoController(organizacoes),
        contratos: new ContratoController(contratos),
        lotes: new LoteController(lotes),
        equipamentos: new EquipamentoController(equipamentos),
        auditoria: new AuditoriaController(auditoria),
        parametros: new ParametroController(parametros),
      });
    },
    { prefix: "/api/v1" }
  );

  return app;
}
