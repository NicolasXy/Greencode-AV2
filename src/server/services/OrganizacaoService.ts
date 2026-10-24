// spiderman
import { UnidadeDeTrabalho } from "../db/unidadeDeTrabalho";
import { OrganizacaoFactory } from "../../factories/OrganizacaoFactory";
import { ValidadorCNPJ } from "../../validation/ValidadorCNPJ";
import { ErroPermissao, ErroValidacao } from "../../types";
import { ErroConflito, ErroNaoEncontrado } from "../errors";
import { Ator, Paginacao, paraSkipTake, versaoEfetiva } from "./tipos";

const validadorCNPJ = new ValidadorCNPJ();

export class OrganizacaoService {
  constructor(private readonly uow: UnidadeDeTrabalho) {}

  /** A validacao do CNPJ (digitos verificadores) e reaproveitada do dominio do CLI via fabrica. */
  async criar(ator: Ator, cnpj: string, razaoSocial: string, contato?: string) {
    const dominio = OrganizacaoFactory.criar(cnpj, razaoSocial, contato);
    return this.uow.transacao(async (r) => {
      const existente = await r.organizacoes.buscarPorCnpj(dominio.cnpj);
      if (existente) {
        throw new ErroConflito(
          existente.ativo
            ? `Ja existe organizacao com o CNPJ ${dominio.cnpj}.`
            : `Ja existe organizacao inativa com o CNPJ ${dominio.cnpj}; reative-a em vez de cadastrar de novo.`
        );
      }
      const org = await r.organizacoes.criar({
        cnpj: dominio.cnpj,
        razaoSocial: dominio.razaoSocial,
        contato: dominio.contato ?? null,
      });
      await r.auditoria.registrar(ator.id, "ORG_CRIADA", { cnpj: org.cnpj });
      return org;
    });
  }

  async buscarPorCnpj(cnpjEntrada: string) {
    const cnpj = validadorCNPJ.normalizarEValidar(cnpjEntrada);
    const org = await this.uow.simples().organizacoes.buscarPorCnpj(cnpj);
    if (!org) throw new ErroNaoEncontrado(`Organizacao com CNPJ ${cnpj} nao encontrada.`);
    return org;
  }

  listar(p: Paginacao, incluirInativos = false) {
    const { skip, take } = paraSkipTake(p);
    return this.uow.simples().organizacoes.listar(skip, take, incluirInativos);
  }

  /**
   * Soft delete em cadeia: inativa a organizacao e todos os seus lotes (os
   * equipamentos somem junto com os lotes). O contrato permanece como esta
   * e NAO impede a inativacao (regra do cliente: sem restricao).
   */
  async inativar(ator: Ator, cnpjEntrada: string, versao?: number) {
    const cnpj = validadorCNPJ.normalizarEValidar(cnpjEntrada);
    return this.uow.transacao(async (r) => {
      const atual = await r.organizacoes.buscarPorCnpj(cnpj);
      if (!atual) throw new ErroNaoEncontrado(`Organizacao com CNPJ ${cnpj} nao encontrada.`);
      if (!atual.ativo) throw new ErroConflito("A organizacao ja esta inativa.");
      const lotesInativados = await r.organizacoes.inativar(atual.id, versaoEfetiva(versao, atual.versao), new Date());
      await r.auditoria.registrar(ator.id, "ORG_INATIVADA", { cnpj, lotesInativados });
      return { ...(await r.organizacoes.buscarPorId(atual.id)), lotesInativados };
    });
  }

  /** Reativa a organizacao e os lotes que foram inativados junto com ela. */
  async reativar(ator: Ator, cnpjEntrada: string, versao?: number) {
    const cnpj = validadorCNPJ.normalizarEValidar(cnpjEntrada);
    return this.uow.transacao(async (r) => {
      const atual = await r.organizacoes.buscarPorCnpj(cnpj);
      if (!atual) throw new ErroNaoEncontrado(`Organizacao com CNPJ ${cnpj} nao encontrada.`);
      if (atual.ativo) throw new ErroConflito("A organizacao ja esta ativa.");
      const lotesReativados = await r.organizacoes.reativar(atual.id, versaoEfetiva(versao, atual.versao), atual.inativadoEm);
      await r.auditoria.registrar(ator.id, "ORG_REATIVADA", { cnpj, lotesReativados });
      return { ...(await r.organizacoes.buscarPorId(atual.id)), lotesReativados };
    });
  }

  /** Delete definitivo em cadeia: organizacao, contrato, lotes, equipamentos e movimentacoes. */
  async excluir(ator: Ator, cnpjEntrada: string) {
    if (ator.papel !== "admin") throw new ErroPermissao("Somente o administrador pode executar o delete definitivo (permanente=true).");
    const cnpj = validadorCNPJ.normalizarEValidar(cnpjEntrada);
    await this.uow.transacao(async (r) => {
      const atual = await r.organizacoes.buscarPorCnpj(cnpj);
      if (!atual) throw new ErroNaoEncontrado(`Organizacao com CNPJ ${cnpj} nao encontrada.`);
      await r.organizacoes.excluir(atual.id);
      await r.auditoria.registrar(ator.id, "ORG_EXCLUIDA", { cnpj, razaoSocial: atual.razaoSocial });
    });
  }

  async atualizar(ator: Ator, cnpjEntrada: string, dados: { razaoSocial?: string; contato?: string | null; versao?: number }) {
    const cnpj = validadorCNPJ.normalizarEValidar(cnpjEntrada);
    if (dados.razaoSocial !== undefined && dados.razaoSocial.trim().length === 0) {
      throw new ErroValidacao("Razao social e obrigatoria.");
    }
    return this.uow.transacao(async (r) => {
      const atual = await r.organizacoes.buscarPorCnpj(cnpj);
      if (!atual) throw new ErroNaoEncontrado(`Organizacao com CNPJ ${cnpj} nao encontrada.`);
      if (!atual.ativo) throw new ErroConflito("A organizacao esta inativa; reative-a antes de altera-la.");
      const org = await r.organizacoes.atualizarComVersao(atual.id, versaoEfetiva(dados.versao, atual.versao), {
        razaoSocial: dados.razaoSocial?.trim(),
        contato: dados.contato,
      });
      await r.auditoria.registrar(ator.id, "ORG_ATUALIZADA", { cnpj });
      return org;
    });
  }
}
