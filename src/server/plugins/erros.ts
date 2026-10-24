// spiderman
import { FastifyInstance } from "fastify";
import { ErroPermissao, ErroSessao, ErroValidacao } from "../../types";
import { ErroConflito, ErroNaoAutenticado, ErroNaoEncontrado } from "../errors";

/**
 * Tratamento centralizado de erros: converte as excecoes de dominio e do
 * Prisma em respostas HTTP padronizadas { erro, mensagem }. Os controllers
 * e services apenas lancam excecoes; nenhum deles monta resposta de erro.
 */
export function registrarTratamentoDeErros(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ erro: "RotaNaoEncontrada", mensagem: `Rota ${req.method} ${req.url} nao existe.` });
  });

  app.setErrorHandler((err, req, reply) => {
    const e = err as Error & { statusCode?: number; validation?: unknown; code?: string; meta?: { target?: unknown } };

    // Validacao por JSON Schema (corpo, query, parametros).
    if (e.validation) {
      return reply.status(400).send({ erro: "ErroValidacao", mensagem: e.message });
    }
    if (e instanceof ErroValidacao) return reply.status(400).send({ erro: "ErroValidacao", mensagem: e.message });
    if (e instanceof ErroNaoAutenticado || e instanceof ErroSessao) {
      return reply.status(401).send({ erro: "NaoAutenticado", mensagem: e.message });
    }
    if (e instanceof ErroPermissao) return reply.status(403).send({ erro: "ErroPermissao", mensagem: e.message });
    if (e instanceof ErroNaoEncontrado) return reply.status(404).send({ erro: "NaoEncontrado", mensagem: e.message });
    if (e instanceof ErroConflito) return reply.status(409).send({ erro: "Conflito", mensagem: e.message });

    // Violacoes de restricao do banco (a ultima barreira de integridade).
    if (e.code === "P2002") {
      return reply.status(409).send({ erro: "Conflito", mensagem: "Registro duplicado (restricao de unicidade do banco)." });
    }
    if (e.code === "P2025") return reply.status(404).send({ erro: "NaoEncontrado", mensagem: "Registro nao encontrado." });
    if (e.code === "P2003") {
      return reply.status(409).send({ erro: "Conflito", mensagem: "Operacao viola uma relacao entre registros." });
    }
    if (/violates check constraint|e imutavel/.test(e.message ?? "")) {
      return reply.status(409).send({ erro: "Conflito", mensagem: "Operacao rejeitada por uma restricao de integridade do banco." });
    }

    // Erros com statusCode proprio do Fastify (JSON invalido, payload grande etc.).
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ erro: "RequisicaoInvalida", mensagem: e.message });
    }

    req.log.error(err);
    return reply.status(500).send({ erro: "ErroInterno", mensagem: "Erro interno do servidor." });
  });
}
