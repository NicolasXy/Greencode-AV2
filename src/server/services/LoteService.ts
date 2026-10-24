// spiderman
import { UnidadeDeTrabalho } from "../db/unidadeDeTrabalho";
import { StatusLote } from "../generated/prisma/enums";
import { LoteFactory } from "../../factories/LoteFactory";
import { Organizacao } from "../../models/Organizacao";
import { ValidadorCNPJ } from "../../validation/ValidadorCNPJ";
import { ErroPermissao, ErroValidacao } from "../../types";
import { validarDataEntradaLote } from "../../core/validators";
import { ErroConflito, ErroNaoEncontrado } from "../errors";
import { EquipamentoService } from "./EquipamentoService";
import { Ator, Paginacao, paraSkipTake, versaoEfetiva } from "./tipos";

const validadorCNPJ = new ValidadorCNPJ();

export class LoteService {
  constructor(private readonly uow: UnidadeDeTrabalho, private readonly equipamentos: EquipamentoService) {}

  /**
   * Cria um lote e, opcionalmente, todos os seus equipamentos na MESMA
   * transacao: ou o lote nasce completo, ou nada e gravado. As regras de
   * data (sem futuro, maximo 90 dias) e de campos obrigatorios vem da
   * LoteFactory/ValidadorDataLote, as mesmas usadas pelo CLI.
   *
   * Regra do cliente: lote so pode ser cadastrado em organizacao ATIVA que
   * possua CONTRATO ATIVO (a simples ausencia de contrato nao inativa a
   * organizacao; apenas impede novos lotes).
   */
  async criar(
    ator: Ator,
    dados: {
      orgCnpj: string;
      nf: string;
      transportadora: string;
      dataEntrada?: string;
      equipamentos?: { tipo: string }[];
    }
  ) {
    // Cadastrar equipamentos e do recurso "equipamento" (admin e almoxarifado, como no CLI):
    // o operador de cadastro pode criar o lote, mas nao inserir equipamentos junto.
    if ((dados.equipamentos?.length ?? 0) > 0 && !["admin", "almoxarifado"].includes(ator.papel)) {
      throw new ErroPermissao(`O papel '${ator.papel}' nao pode cadastrar equipamentos.`);
    }
    const cnpj = validadorCNPJ.normalizarEValidar(dados.orgCnpj);
    const data = dados.dataEntrada ?? new Date().toISOString().substring(0, 10);
    // A fabrica valida nf, transportadora e data; o objeto Organizacao so carrega o CNPJ.
    const dominio = LoteFactory.criar(new Organizacao({ cnpj, razaoSocial: "-" }), dados.nf, dados.transportadora, data, ator.username);

    return this.uow.transacao(async (r) => {
      const org = await r.organizacoes.buscarPorCnpj(cnpj);
      if (!org) throw new ErroNaoEncontrado(`Organizacao com CNPJ ${cnpj} nao encontrada. Cadastre-a antes.`);
      if (!org.ativo) throw new ErroConflito("A organizacao esta inativa; reative-a antes de cadastrar lotes.");
      if (!org.contrato || !org.contrato.ativo) {
        throw new ErroConflito("A organizacao nao possui contrato ativo; lotes so podem ser cadastrados com contrato ativo.");
      }
      const lote = await r.lotes
        .criar({
          organizacaoId: org.id,
          nf: dominio.nf,
          transportadora: dominio.transportadora,
          dataEntrada: new Date(`${data}T00:00:00.000Z`),
          criadoPorId: ator.id,
        })
        .catch((e: unknown) => {
          throw traduzirDuplicidadeNf(e, dominio.nf);
        });
      const equipamentos = [];
      for (const item of dados.equipamentos ?? []) {
        equipamentos.push(await this.equipamentos.cadastrarEmTransacao(r, ator, lote.id, item.tipo));
      }
      await r.auditoria.registrar(ator.id, "LOTE_CRIADO", { loteId: lote.id, cnpj, nf: lote.nf, equipamentos: equipamentos.length });
      return { lote, equipamentos };
    });
  }

  /** Detalhe do lote (inclusive inativo, com o campo `ativo`), com organizacao e equipamentos em ordem de posicao. */
  async obter(id: string) {
    const l = await this.uow.simples().lotes.buscarDetalhado(id);
    if (!l) throw new ErroNaoEncontrado(`Lote ${id} nao encontrado.`);
    return l;
  }

  listar(p: Paginacao, filtros: { status?: StatusLote; cnpj?: string; incluirInativos?: boolean }) {
    const { skip, take } = paraSkipTake(p);
    return this.uow.simples().lotes.listar(skip, take, filtros);
  }

  /** Edita dados cadastrais do lote (NF, transportadora, data de entrada) com as mesmas validacoes da criacao. */
  async atualizar(ator: Ator, id: string, dados: { nf?: string; transportadora?: string; dataEntrada?: string; versao?: number }) {
    const nf = dados.nf?.trim();
    const transportadora = dados.transportadora?.trim();
    if (dados.nf !== undefined && !nf) throw new ErroValidacao("A nota fiscal e obrigatoria.");
    if (dados.transportadora !== undefined && !transportadora) throw new ErroValidacao("A transportadora e obrigatoria.");
    if (dados.dataEntrada !== undefined) validarDataEntradaLote(dados.dataEntrada);
    return this.uow.transacao(async (r) => {
      const atual = await r.lotes.buscarPorId(id);
      if (!atual) throw new ErroNaoEncontrado(`Lote ${id} nao encontrado.`);
      if (!atual.ativo) throw new ErroConflito("O lote esta inativo; reative-o antes de altera-lo.");
      const lote = await r.lotes
        .atualizarDados(id, versaoEfetiva(dados.versao, atual.versao), {
          nf,
          transportadora,
          dataEntrada: dados.dataEntrada ? new Date(`${dados.dataEntrada}T00:00:00.000Z`) : undefined,
        })
        .catch((e: unknown) => {
          throw traduzirDuplicidadeNf(e, nf ?? atual.nf);
        });
      await r.auditoria.registrar(ator.id, "LOTE_ATUALIZADO", { loteId: id });
      return lote;
    });
  }

  /** Soft delete do lote (os equipamentos deixam de aparecer junto com ele). */
  async inativar(ator: Ator, id: string, versao?: number) {
    return this.uow.transacao(async (r) => {
      const atual = await r.lotes.buscarPorId(id);
      if (!atual) throw new ErroNaoEncontrado(`Lote ${id} nao encontrado.`);
      if (!atual.ativo) throw new ErroConflito("O lote ja esta inativo.");
      const lote = await r.lotes.inativar(id, versaoEfetiva(versao, atual.versao), new Date());
      await r.auditoria.registrar(ator.id, "LOTE_INATIVADO", { loteId: id, nf: atual.nf });
      return lote;
    });
  }

  async reativar(ator: Ator, id: string, versao?: number) {
    return this.uow.transacao(async (r) => {
      const atual = await r.lotes.buscarPorId(id);
      if (!atual) throw new ErroNaoEncontrado(`Lote ${id} nao encontrado.`);
      if (atual.ativo) throw new ErroConflito("O lote ja esta ativo.");
      if (!atual.organizacao.ativo) throw new ErroConflito("A organizacao do lote esta inativa; reative-a primeiro.");
      const lote = await r.lotes.reativar(id, versaoEfetiva(versao, atual.versao));
      await r.auditoria.registrar(ator.id, "LOTE_REATIVADO", { loteId: id, nf: atual.nf });
      return lote;
    });
  }

  /** Delete definitivo em cadeia: o lote, seus equipamentos e as movimentacoes deles. */
  async excluir(ator: Ator, id: string) {
    if (ator.papel !== "admin") throw new ErroPermissao("Somente o administrador pode executar o delete definitivo (permanente=true).");
    await this.uow.transacao(async (r) => {
      const atual = await r.lotes.buscarPorId(id);
      if (!atual) throw new ErroNaoEncontrado(`Lote ${id} nao encontrado.`);
      await r.lotes.excluir(id);
      await r.auditoria.registrar(ator.id, "LOTE_EXCLUIDO", { loteId: id, nf: atual.nf, cnpj: atual.organizacao.cnpj });
    });
  }
}

function traduzirDuplicidadeNf(e: unknown, nf: string): unknown {
  const codigo = (e as { code?: string })?.code;
  return codigo === "P2002" ? new ErroConflito(`Ja existe um lote com a NF ${nf} para esta organizacao.`) : e;
}
