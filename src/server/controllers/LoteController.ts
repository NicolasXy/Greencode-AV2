// spiderman
import { FastifyReply, FastifyRequest } from "fastify";
import { LoteService } from "../services/LoteService";
import { EquipamentoService } from "../services/EquipamentoService";
import { StatusEquipamento, StatusLote } from "../generated/prisma/enums";
import { AuditoriaService, ParametroService } from "../services/ParametroService";
import { lerPaginacao, paginado } from "./util";

type Pag = { pagina?: number; tamanhoPagina?: number };

export class LoteController {
  constructor(private readonly service: LoteService) {}

  criar = async (
    req: FastifyRequest<{
      Body: {
        orgCnpj: string;
        nf: string;
        transportadora: string;
        dataEntrada?: string;
        equipamentos?: { tipo: string }[];
      };
    }>,
    reply: FastifyReply
  ) => {
    return reply.status(201).send(await this.service.criar(req.ator, req.body));
  };

  listar = async (req: FastifyRequest<{ Querystring: Pag & { status?: StatusLote; cnpj?: string; incluirInativos?: boolean } }>) => {
    const p = lerPaginacao(req.query);
    return paginado(
      await this.service.listar(p, { status: req.query.status, cnpj: req.query.cnpj, incluirInativos: req.query.incluirInativos }),
      p
    );
  };

  obter = async (req: FastifyRequest<{ Params: { id: string } }>) => this.service.obter(req.params.id);

  atualizar = async (
    req: FastifyRequest<{ Params: { id: string }; Body: { nf?: string; transportadora?: string; dataEntrada?: string; versao?: number } }>
  ) => this.service.atualizar(req.ator, req.params.id, req.body);

  /** DELETE: soft delete (padrao) ou definitivo em cadeia (`?permanente=true`, admin). */
  remover = async (
    req: FastifyRequest<{ Params: { id: string }; Querystring: { permanente?: boolean; versao?: number } }>,
    reply: FastifyReply
  ) => {
    if (req.query.permanente) {
      await this.service.excluir(req.ator, req.params.id);
      return reply.status(204).send();
    }
    return this.service.inativar(req.ator, req.params.id, req.query.versao);
  };

  reativar = async (req: FastifyRequest<{ Params: { id: string }; Body: { versao?: number } | undefined }>) =>
    this.service.reativar(req.ator, req.params.id, req.body?.versao);
}

export class EquipamentoController {
  constructor(private readonly service: EquipamentoService) {}

  cadastrar = async (
    req: FastifyRequest<{ Body: { loteId: string; tipo: string } }>,
    reply: FastifyReply
  ) => reply.status(201).send(await this.service.cadastrar(req.ator, req.body.loteId, req.body.tipo));

  atualizarTipo = async (req: FastifyRequest<{ Params: { id: string }; Body: { tipo: string; versao?: number } }>) =>
    this.service.atualizarTipo(req.ator, req.params.id, req.body.tipo, req.body.versao);

  /** Equipamento so tem delete definitivo (sem soft delete). */
  remover = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await this.service.excluir(req.ator, req.params.id);
    return reply.status(204).send();
  };

  listar = async (req: FastifyRequest<{ Querystring: Pag & { loteId?: string; status?: StatusEquipamento } }>) => {
    const p = lerPaginacao(req.query);
    return paginado(await this.service.listar(p, { loteId: req.query.loteId, status: req.query.status }), p);
  };

  obter = async (req: FastifyRequest<{ Params: { id: string } }>) => this.service.obter(req.params.id);

  concluirTriagem = async (req: FastifyRequest<{ Params: { id: string }; Body: { versao?: number } | undefined }>) =>
    this.service.concluirTriagem(req.ator, req.params.id, req.body?.versao);

  mover = async (req: FastifyRequest<{ Params: { id: string }; Body: { status: StatusEquipamento; versao?: number } }>) =>
    this.service.mover(req.ator, req.params.id, req.body.status, req.body.versao);

  alterarEstado = async (
    req: FastifyRequest<{ Params: { id: string }; Body: { estadoFisico: string; justificativa?: string; versao?: number } }>
  ) => this.service.alterarEstado(req.ator, req.params.id, req.body.estadoFisico, req.body.justificativa, req.body.versao);

  depreciacao = async (req: FastifyRequest<{ Params: { id: string }; Querystring: { meses: number } }>) =>
    this.service.depreciacao(req.params.id, req.query.meses);

  rastreio = async (req: FastifyRequest<{ Params: { id: string } }>) => this.service.rastreio(req.params.id);
}

export class AuditoriaController {
  constructor(private readonly service: AuditoriaService) {}

  listar = async (req: FastifyRequest<{ Querystring: Pag & { acao?: string } }>) => {
    const p = lerPaginacao(req.query);
    return paginado(await this.service.listar((p.pagina - 1) * p.tamanhoPagina, p.tamanhoPagina, req.query.acao), p);
  };
}

/** Parametros globais (admin). */
export class ParametroController {
  constructor(private readonly service: ParametroService) {}

  listar = async () => this.service.listar();

  obter = async (req: FastifyRequest<{ Params: { chave: string } }>) => this.service.obter(req.params.chave);

  definir = async (req: FastifyRequest<{ Params: { chave: string }; Body: { valor: string; versao?: number } }>) =>
    this.service.definir(req.ator, req.params.chave, req.body.valor, req.body.versao);

  remover = async (req: FastifyRequest<{ Params: { chave: string } }>, reply: FastifyReply) => {
    await this.service.excluir(req.ator, req.params.chave);
    return reply.status(204).send();
  };
}
