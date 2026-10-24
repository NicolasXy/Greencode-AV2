// spiderman
import { FastifyReply, FastifyRequest } from "fastify";
import { OrganizacaoService } from "../services/OrganizacaoService";
import { ContratoService } from "../services/ContratoService";
import { Prisma } from "../db/prisma";
import { lerPaginacao, paginado } from "./util";

type Pag = { pagina?: number; tamanhoPagina?: number };

export class OrganizacaoController {
  constructor(private readonly service: OrganizacaoService) {}

  criar = async (req: FastifyRequest<{ Body: { cnpj: string; razaoSocial: string; contato?: string } }>, reply: FastifyReply) => {
    const org = await this.service.criar(req.ator, req.body.cnpj, req.body.razaoSocial, req.body.contato);
    return reply.status(201).send(org);
  };

  listar = async (req: FastifyRequest<{ Querystring: Pag & { incluirInativos?: boolean } }>) => {
    const p = lerPaginacao(req.query);
    return paginado(await this.service.listar(p, req.query.incluirInativos), p);
  };

  obter = async (req: FastifyRequest<{ Params: { cnpj: string } }>) => this.service.buscarPorCnpj(req.params.cnpj);

  /** DELETE: soft delete em cadeia (padrao) ou definitivo (`?permanente=true`, admin). */
  remover = async (
    req: FastifyRequest<{ Params: { cnpj: string }; Querystring: { permanente?: boolean; versao?: number } }>,
    reply: FastifyReply
  ) => {
    if (req.query.permanente) {
      await this.service.excluir(req.ator, req.params.cnpj);
      return reply.status(204).send();
    }
    return this.service.inativar(req.ator, req.params.cnpj, req.query.versao);
  };

  reativar = async (req: FastifyRequest<{ Params: { cnpj: string }; Body: { versao?: number } | undefined }>) =>
    this.service.reativar(req.ator, req.params.cnpj, req.body?.versao);

  atualizar = async (
    req: FastifyRequest<{ Params: { cnpj: string }; Body: { razaoSocial?: string; contato?: string | null; versao?: number } }>
  ) => this.service.atualizar(req.ator, req.params.cnpj, req.body);
}

export class ContratoController {
  constructor(private readonly service: ContratoService) {}

  criar = async (
    req: FastifyRequest<{
      Body: { orgCnpj: string; dataInicio: string; frequenciaColetaDias: number; condicoes?: string; clausulas?: Prisma.InputJsonValue };
    }>,
    reply: FastifyReply
  ) => reply.status(201).send(await this.service.criar(req.ator, req.body));

  listar = async (req: FastifyRequest<{ Querystring: Pag & { incluirInativos?: boolean } }>) => {
    const p = lerPaginacao(req.query);
    return paginado(await this.service.listar(p, req.query.incluirInativos), p);
  };

  obter = async (req: FastifyRequest<{ Params: { id: string } }>) => this.service.obter(req.params.id);

  atualizar = async (
    req: FastifyRequest<{
      Params: { id: string };
      Body: { frequenciaColetaDias?: number; condicoes?: string | null; clausulas?: Prisma.InputJsonValue; versao?: number };
    }>
  ) => this.service.atualizar(req.ator, req.params.id, req.body);

  /** Contrato so tem delete definitivo (sem soft delete). */
  remover = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await this.service.excluir(req.ator, req.params.id);
    return reply.status(204).send();
  };

  reativar = async (req: FastifyRequest<{ Params: { id: string }; Body: { versao?: number } | undefined }>) =>
    this.service.reativar(req.ator, req.params.id, req.body?.versao);

  encerrar = async (req: FastifyRequest<{ Params: { id: string }; Body: { versao?: number } | undefined }>) =>
    this.service.encerrar(req.ator, req.params.id, req.body?.versao);
}
