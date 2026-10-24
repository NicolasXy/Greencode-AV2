// spiderman
import { FastifyReply, FastifyRequest } from "fastify";
import { AuthService } from "../services/AuthService";
import { Papel } from "../generated/prisma/enums";
import { PayloadJwt } from "../plugins/autenticacao";

type Assinador = (payload: PayloadJwt) => string;

/**
 * Controller de autenticacao e usuarios. Camada HTTP apenas: le a
 * requisicao, delega ao AuthService e devolve a resposta. A emissao do JWT
 * fica aqui porque depende do Fastify; a verificacao de credenciais (regra
 * de negocio) fica no service.
 */
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly assinar: Assinador,
    private readonly jwtExpiraEm: string
  ) {}

  private emitirToken(u: { id: string; username: string; papel: Papel }) {
    return {
      token: this.assinar({ sub: u.id, username: u.username, papel: u.papel }),
      tipo: "Bearer",
      expiraEm: this.jwtExpiraEm,
    };
  }

  provisionar = async (req: FastifyRequest<{ Body: { username: string; senha: string } }>, reply: FastifyReply) => {
    const u = await this.service.primeiroAdmin(req.body.username, req.body.senha);
    return reply.status(201).send({ usuario: u });
  };

  login = async (req: FastifyRequest<{ Body: { username: string; senha: string } }>) => {
    const u = await this.service.login(req.body.username, req.body.senha);
    return { ...this.emitirToken(u), usuario: u };
  };

  me = async (req: FastifyRequest) => this.service.obter(req.ator.id);

  alterarSenha = async (req: FastifyRequest<{ Body: { senhaAtual: string; novaSenha: string } }>, reply: FastifyReply) => {
    await this.service.alterarPropriaSenha(req.ator, req.body.senhaAtual, req.body.novaSenha);
    return reply.status(204).send();
  };

  criarUsuario = async (
    req: FastifyRequest<{ Body: { username: string; senha: string; papel: Papel } }>,
    reply: FastifyReply
  ) => {
    const u = await this.service.criarUsuario(req.ator, req.body.username, req.body.senha, req.body.papel);
    return reply.status(201).send(u);
  };

  listarUsuarios = async () => this.service.listar();

  renomearUsuario = async (req: FastifyRequest<{ Params: { id: string }; Body: { username: string; versao?: number } }>) =>
    this.service.renomear(req.ator, req.params.id, req.body.username, req.body.versao);

  /** DELETE: soft delete = inativar (padrao); `?permanente=true` exclui de vez (so sem historico). */
  removerUsuario = async (
    req: FastifyRequest<{ Params: { id: string }; Querystring: { permanente?: boolean; versao?: number } }>,
    reply: FastifyReply
  ) => {
    if (req.query.permanente) {
      await this.service.excluir(req.ator, req.params.id);
      return reply.status(204).send();
    }
    return this.service.alterarAtivo(req.ator, req.params.id, false, req.query.versao);
  };

  alterarPapel = async (req: FastifyRequest<{ Params: { id: string }; Body: { papel: Papel; versao?: number } }>) =>
    this.service.alterarPapel(req.ator, req.params.id, req.body.papel, req.body.versao);

  redefinirSenha = async (req: FastifyRequest<{ Params: { id: string }; Body: { novaSenha: string; versao?: number } }>, reply: FastifyReply) => {
    await this.service.redefinirSenha(req.ator, req.params.id, req.body.novaSenha, req.body.versao);
    return reply.status(204).send();
  };

  alterarAtivo = async (req: FastifyRequest<{ Params: { id: string }; Body: { ativo: boolean; versao?: number } }>) =>
    this.service.alterarAtivo(req.ator, req.params.id, req.body.ativo, req.body.versao);
}
