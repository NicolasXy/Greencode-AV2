// spiderman
import { UnidadeDeTrabalho } from "../db/unidadeDeTrabalho";
import { Prisma } from "../db/prisma";
import { ValidadorContratoColeta } from "../../validation/ValidadorContratoColeta";
import { ValidadorCNPJ } from "../../validation/ValidadorCNPJ";
import { ErroValidacao } from "../../types";
import { ErroConflito, ErroNaoEncontrado } from "../errors";
import { Ator, Paginacao, paraSkipTake, versaoEfetiva } from "./tipos";

const validadorContrato = new ValidadorContratoColeta();
const validadorCNPJ = new ValidadorCNPJ();

const paraData = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export class ContratoService {
  constructor(private readonly uow: UnidadeDeTrabalho) {}

  async criar(
    ator: Ator,
    dados: {
      orgCnpj: string;
      dataInicio: string;
      frequenciaColetaDias: number;
      condicoes?: string;
      clausulas?: Prisma.InputJsonValue;
    }
  ) {
    const cnpj = validadorCNPJ.normalizarEValidar(dados.orgCnpj);
    validadorContrato.validar({ dataInicio: dados.dataInicio, frequenciaColetaDias: dados.frequenciaColetaDias });
    return this.uow.transacao(async (r) => {
      const org = await r.organizacoes.buscarPorCnpj(cnpj);
      if (!org) throw new ErroNaoEncontrado(`Organizacao com CNPJ ${cnpj} nao encontrada. Cadastre-a antes.`);
      if (!org.ativo) throw new ErroConflito("A organizacao esta inativa; reative-a antes de criar contrato.");
      if (await r.contratos.buscarPorOrganizacao(org.id)) {
        throw new ErroConflito("A organizacao ja possui um contrato de coleta.");
      }
      const contrato = await r.contratos.criar({
        organizacaoId: org.id,
        dataInicio: paraData(dados.dataInicio),
        frequenciaColetaDias: dados.frequenciaColetaDias,
        condicoes: dados.condicoes?.trim() || null,
        clausulas: dados.clausulas,
      });
      await r.auditoria.registrar(ator.id, "CONTRATO_CRIADO", { cnpj, contratoId: contrato.id });
      return contrato;
    });
  }

  async obter(id: string) {
    const c = await this.uow.simples().contratos.buscarPorId(id);
    if (!c) throw new ErroNaoEncontrado(`Contrato ${id} nao encontrado.`);
    return c;
  }

  /** Contratos de organizacoes inativas ficam ocultos, salvo `incluirInativos`. */
  listar(p: Paginacao, incluirInativos = false) {
    const { skip, take } = paraSkipTake(p);
    return this.uow.simples().contratos.listar(skip, take, incluirInativos);
  }

  async atualizar(
    ator: Ator,
    id: string,
    dados: { frequenciaColetaDias?: number; condicoes?: string | null; clausulas?: Prisma.InputJsonValue; versao?: number }
  ) {
    return this.uow.transacao(async (r) => {
      const atual = await r.contratos.buscarPorId(id);
      if (!atual) throw new ErroNaoEncontrado(`Contrato ${id} nao encontrado.`);
      if (!atual.organizacao.ativo) throw new ErroConflito("A organizacao esta inativa; reative-a antes de alterar o contrato.");
      if (!atual.ativo) throw new ErroValidacao("Contrato encerrado nao pode ser alterado.");
      if (dados.frequenciaColetaDias !== undefined) {
        validadorContrato.validar({
          dataInicio: atual.dataInicio.toISOString().substring(0, 10),
          frequenciaColetaDias: dados.frequenciaColetaDias,
        });
      }
      const c = await r.contratos.atualizarComVersao(id, versaoEfetiva(dados.versao, atual.versao), {
        frequenciaColetaDias: dados.frequenciaColetaDias,
        condicoes: dados.condicoes,
        clausulas: dados.clausulas,
      });
      await r.auditoria.registrar(ator.id, "CONTRATO_ATUALIZADO", { contratoId: id });
      return c;
    });
  }

  async encerrar(ator: Ator, id: string, versao?: number) {
    return this.uow.transacao(async (r) => {
      const atual = await r.contratos.buscarPorId(id);
      if (!atual) throw new ErroNaoEncontrado(`Contrato ${id} nao encontrado.`);
      if (!atual.organizacao.ativo) throw new ErroConflito("A organizacao esta inativa; reative-a antes de encerrar o contrato.");
      if (!atual.ativo) throw new ErroConflito("O contrato ja esta encerrado.");
      const c = await r.contratos.atualizarComVersao(id, versaoEfetiva(versao, atual.versao), { ativo: false });
      await r.auditoria.registrar(ator.id, "CONTRATO_ENCERRADO", { contratoId: id });
      return c;
    });
  }

  /**
   * Reabre um contrato encerrado. Sem isto, uma organizacao cujo contrato foi
   * encerrado nunca mais poderia receber lotes (so existe um contrato por organizacao).
   */
  async reativar(ator: Ator, id: string, versao?: number) {
    return this.uow.transacao(async (r) => {
      const atual = await r.contratos.buscarPorId(id);
      if (!atual) throw new ErroNaoEncontrado(`Contrato ${id} nao encontrado.`);
      if (!atual.organizacao.ativo) throw new ErroConflito("A organizacao esta inativa; reative-a antes de reabrir o contrato.");
      if (atual.ativo) throw new ErroConflito("O contrato ja esta ativo.");
      const c = await r.contratos.atualizarComVersao(id, versaoEfetiva(versao, atual.versao), { ativo: true });
      await r.auditoria.registrar(ator.id, "CONTRATO_REATIVADO", { contratoId: id });
      return c;
    });
  }

  /**
   * Delete definitivo (regra do cliente: contrato nao tem soft delete; para
   * apenas torna-lo inativo existe "encerrar"). Apagar o contrato nao
   * inativa a organizacao, mas ela deixa de aceitar novos lotes.
   */
  async excluir(ator: Ator, id: string) {
    await this.uow.transacao(async (r) => {
      const atual = await r.contratos.buscarPorId(id);
      if (!atual) throw new ErroNaoEncontrado(`Contrato ${id} nao encontrado.`);
      await r.contratos.excluir(id);
      await r.auditoria.registrar(ator.id, "CONTRATO_EXCLUIDO", { contratoId: id, cnpj: atual.organizacao.cnpj });
    });
  }
}
