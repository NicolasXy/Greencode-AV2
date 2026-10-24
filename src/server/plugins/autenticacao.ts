// spiderman
import { FastifyInstance, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { Papel } from "../generated/prisma/enums";
import { ErroNaoAutenticado } from "../errors";
import { ErroPermissao } from "../../types";
import { Ator } from "../services/tipos";

/** Conteudo assinado dentro do JWT: apenas o identificador, o nome e o papel. */
export interface PayloadJwt {
  sub: string;
  username: string;
  papel: Papel;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: PayloadJwt;
    user: PayloadJwt;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    /** Usuario autenticado desta requisicao (preenchido pelo hook de autenticacao). */
    ator: Ator;
  }
  interface FastifyContextConfig {
    /** Rota publica: dispensa o token (login e provisionamento). */
    publica?: boolean;
    /** Permite que o auditor use um metodo que nao e de leitura (ex.: trocar a propria senha). */
    auditorPodeEscrever?: boolean;
  }
}

const METODOS_LEITURA = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Registra o plugin @fastify/jwt e o hook global de autenticacao.
 *
 * Fluxo (stateless): o token e validado a cada requisicao (assinatura e
 * expiracao). Em seguida o usuario e relido do banco para confirmar que a
 * conta continua ativa e para usar o papel ATUAL (assim, desativar uma
 * conta ou mudar um papel vale imediatamente, sem esperar o token expirar).
 * Esta consulta substitui a "sessao em memoria" do CLI.
 */
export async function registrarAutenticacao(
  app: FastifyInstance,
  opcoes: { jwtSecret: string; jwtExpiraEm: string; carregarAtor: (id: string) => Promise<Ator> }
): Promise<void> {
  await app.register(fastifyJwt, {
    secret: opcoes.jwtSecret,
    sign: { expiresIn: opcoes.jwtExpiraEm },
  });

  app.decorateRequest("ator", undefined as unknown as Ator);

  app.addHook("onRequest", async (req: FastifyRequest) => {
    // Rotas publicas e a documentacao interativa (/docs) dispensam o token.
    if (req.routeOptions.config?.publica || req.url.startsWith("/docs")) return;

    let payload: PayloadJwt;
    try {
      await req.jwtVerify();
      payload = req.user;
    } catch {
      throw new ErroNaoAutenticado("Token ausente, invalido ou expirado.");
    }

    // O servico relê o usuario no banco: conta inativa ou removida => 401 imediato.
    req.ator = await opcoes.carregarAtor(payload.sub);

    // Camada de seguranca do auditor (somente leitura), igual a do CLI.
    if (req.ator.papel === "auditor" && !METODOS_LEITURA.has(req.method) && !req.routeOptions.config?.auditorPodeEscrever) {
      throw new ErroPermissao("O papel 'auditor' tem acesso somente leitura.");
    }
  });
}

/**
 * Fabrica de hook `onRequest` de rota: libera a rota apenas para os papeis
 * informados. Roda logo apos a autenticacao e ANTES da validacao do corpo,
 * para que quem nao tem permissao sempre receba 403 (e nunca 400/404).
 */
export function permitir(...papeis: Papel[]) {
  return async (req: FastifyRequest): Promise<void> => {
    if (!papeis.includes(req.ator.papel)) {
      throw new ErroPermissao(`O papel '${req.ator.papel}' nao tem permissao para esta operacao.`);
    }
  };
}
