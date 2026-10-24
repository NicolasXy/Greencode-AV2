// spiderman
import * as crypto from "crypto";
import { UnidadeDeTrabalho, Repositorios } from "../db/unidadeDeTrabalho";
import { EstadoFisico, StatusEquipamento } from "../generated/prisma/enums";
import { Equipamento } from "../../models/Equipamento";
import { EquipamentoFactory } from "../../factories/EquipamentoFactory";
import { validarEstadoFisico } from "../../core/validators";
import { ErroValidacao } from "../../types";
import { sincronizarStatusLote } from "./statusLote";
import { ErroConflito, ErroNaoEncontrado } from "../errors";
import { Ator, Paginacao, paraSkipTake, versaoEfetiva } from "./tipos";

type LinhaEquipamento = NonNullable<Awaited<ReturnType<Repositorios["equipamentos"]["buscarPorId"]>>>;

/**
 * Converte a linha do banco na entidade de dominio polimorfica (Terminal,
 * CPU, Monitor, Servidor ou EquipamentoGenerico). E o ponto em que as
 * regras de negocio do CLI (triagem antes de desmonte, justificativa na
 * queda de 2+ categorias, depreciacao por tipo) passam a valer na API,
 * sem duplicacao de codigo.
 */
function paraDominio(l: LinhaEquipamento): Equipamento {
  return EquipamentoFactory.reidratar({
    tipo: l.tipo,
    loteId: l.loteId,
    codigoBarras: l.codigoBarrasInterno,
    estadoFisico: l.estadoFisico,
    status: l.status,
    triagemCompleta: l.triagemCompleta,
    id: l.id,
    criadoEm: l.criadoEm.toISOString(),
    atualizadoEm: l.atualizadoEm.toISOString(),
  } as unknown as Equipamento);
}

export class EquipamentoService {
  constructor(private readonly uow: UnidadeDeTrabalho) {}

  /**
   * Cadastra um equipamento dentro de uma transacao ja aberta. E reutilizado
   * tanto pelo cadastro avulso quanto pela criacao de lote com varios
   * equipamentos (onde precisa participar da MESMA transacao).
   *
   * Regras do cliente aplicadas aqui:
   *  - o codigo de barras E o id do equipamento (gerado pelo servidor);
   *  - a posicao no lote e automatica (1, 2, 3...), calculada com o lote
   *    travado para que cadastros simultaneos nunca repitam posicao.
   */
  async cadastrarEmTransacao(r: Repositorios, ator: Ator, loteId: string, tipo: string) {
    if (!tipo || tipo.trim().length === 0) throw new ErroValidacao("O tipo do equipamento e obrigatorio.");
    const lote = await r.lotes.buscarPorId(loteId);
    if (!lote) throw new ErroNaoEncontrado(`Lote ${loteId} nao encontrado.`);
    if (!lote.ativo) throw new ErroConflito("O lote esta inativo.");
    if (lote.status === "encerrado") throw new ErroValidacao("Nao e possivel cadastrar equipamentos em lote encerrado.");
    await r.lotes.bloquear(loteId);
    const id = crypto.randomUUID();
    // A fabrica valida (IValidavel) e escolhe a subclasse correta do tipo informado.
    const dominio = EquipamentoFactory.criar(tipo, loteId, id);
    const posicao = await r.equipamentos.proximaPosicao(loteId);
    const criado = await r.equipamentos.criar({ id, loteId, tipo: dominio.tipo, posicao });
    await r.auditoria.registrar(ator.id, "EQUIPAMENTO_CADASTRADO", { equipamentoId: criado.id, loteId, tipo: dominio.tipo, posicao });
    return criado;
  }

  cadastrar(ator: Ator, loteId: string, tipo: string) {
    return this.uow.transacao((r) => this.cadastrarEmTransacao(r, ator, loteId, tipo));
  }

  /** Cadastro em lote: todos os equipamentos entram juntos ou nenhum entra. */
  cadastrarVarios(ator: Ator, loteId: string, itens: { tipo: string }[]) {
    return this.uow.transacao(async (r) => {
      const criados = [];
      for (const i of itens) criados.push(await this.cadastrarEmTransacao(r, ator, loteId, i.tipo));
      return criados;
    });
  }

  /** Corrige o tipo do equipamento (ex.: cadastrado como "CPU" mas e um "Servidor"). */
  atualizarTipo(ator: Ator, id: string, tipo: string, versao?: number) {
    if (!tipo || tipo.trim().length === 0) throw new ErroValidacao("O tipo do equipamento e obrigatorio.");
    return this.uow.transacao(async (r) => {
      const atual = await r.equipamentos.buscarPorId(id);
      if (!atual) throw new ErroNaoEncontrado(`Equipamento ${id} nao encontrado.`);
      // A fabrica valida o novo tipo e normaliza o nome (subclasse correta).
      const dominio = EquipamentoFactory.criar(tipo, atual.loteId, atual.id);
      const novo = await r.equipamentos.atualizarTipoComVersao(id, versaoEfetiva(versao, atual.versao), dominio.tipo);
      await r.auditoria.registrar(ator.id, "EQUIPAMENTO_TIPO_ALTERADO", { equipamentoId: id, de: atual.tipo, para: dominio.tipo });
      return novo;
    });
  }

  /**
   * Delete definitivo (equipamento nao tem soft delete: seu ciclo de vida
   * e o proprio status). As movimentacoes saem em cadeia e o status do
   * lote e recalculado na mesma transacao.
   */
  excluir(ator: Ator, id: string) {
    return this.uow.transacao(async (r) => {
      const linha = await r.equipamentos.buscarPorId(id);
      if (!linha) throw new ErroNaoEncontrado(`Equipamento ${id} nao encontrado.`);
      await r.lotes.bloquear(linha.loteId);
      await r.equipamentos.excluir(id);
      await r.auditoria.registrar(ator.id, "EQUIPAMENTO_EXCLUIDO", { equipamentoId: id, loteId: linha.loteId, tipo: linha.tipo });
      await sincronizarStatusLote(r, ator, linha.loteId);
    });
  }

  async obter(id: string) {
    const e = await this.uow.simples().equipamentos.buscarPorId(id);
    if (!e) throw new ErroNaoEncontrado(`Equipamento ${id} nao encontrado.`);
    return e;
  }

  listar(p: Paginacao, filtros: { loteId?: string; status?: StatusEquipamento }) {
    const { skip, take } = paraSkipTake(p);
    return this.uow.simples().equipamentos.listar(skip, take, filtros);
  }

  /**
   * Nucleo das tres operacoes de mudanca de estado (triagem, mover, estado).
   * Em UMA transacao: le o equipamento, aplica a regra de dominio, grava
   * com checagem de versao e registra a movimentacao + auditoria. Se
   * qualquer passo falhar (inclusive conflito de versao), nada e persistido.
   */
  private transicionar(
    ator: Ator,
    id: string,
    versao: number | undefined,
    acao: string,
    aplicar: (d: Equipamento) => { justificativa?: string }
  ) {
    return this.uow.transacao(async (r) => {
      const previa = await r.equipamentos.buscarPorId(id);
      if (!previa) throw new ErroNaoEncontrado(`Equipamento ${id} nao encontrado.`);
      // Trava o lote e RELE o equipamento: serializa transicoes do mesmo lote
      // e garante que o status derivado do lote use dados confirmados.
      await r.lotes.bloquear(previa.loteId);
      const linha = await r.equipamentos.buscarPorId(id);
      if (!linha) throw new ErroNaoEncontrado(`Equipamento ${id} nao encontrado.`);
      const dominio = paraDominio(linha);
      const { justificativa } = aplicar(dominio); // lanca ErroValidacao se a regra de negocio for violada
      const atualizado = await r.equipamentos.atualizarComVersao(id, versaoEfetiva(versao, linha.versao), {
        status: dominio.status as StatusEquipamento,
        estadoFisico: dominio.estadoFisico as EstadoFisico,
        triagemCompleta: dominio.triagemCompleta,
      });
      const mudouStatus = linha.status !== atualizado.status;
      const mudouEstado = linha.estadoFisico !== atualizado.estadoFisico;
      if (mudouStatus || mudouEstado) {
        await r.movimentacoes.registrar({
          equipamentoId: id,
          usuarioId: ator.id,
          statusDe: mudouStatus ? linha.status : undefined,
          statusPara: mudouStatus ? atualizado.status : undefined,
          estadoDe: mudouEstado ? linha.estadoFisico : undefined,
          estadoPara: mudouEstado ? atualizado.estadoFisico : undefined,
          justificativa: justificativa ?? null,
        });
      }
      await r.auditoria.registrar(ator.id, acao, { equipamentoId: id, status: atualizado.status, estadoFisico: atualizado.estadoFisico });
      // Regra do cliente: o status do lote acompanha os equipamentos (so muda quando todos coincidem).
      await sincronizarStatusLote(r, ator, linha.loteId);
      return atualizado;
    });
  }

  concluirTriagem(ator: Ator, id: string, versao?: number) {
    return this.transicionar(ator, id, versao, "EQUIPAMENTO_TRIAGEM_COMPLETA", (d) => {
      d.concluirTriagem();
      return {};
    });
  }

  mover(ator: Ator, id: string, novoStatus: StatusEquipamento, versao?: number) {
    return this.transicionar(ator, id, versao, "EQUIPAMENTO_STATUS_ALTERADO", (d) => {
      d.moverParaStatus(novoStatus);
      return {};
    });
  }

  alterarEstado(ator: Ator, id: string, novoEstado: string, justificativa?: string, versao?: number) {
    const estado = validarEstadoFisico(novoEstado);
    return this.transicionar(ator, id, versao, "EQUIPAMENTO_ESTADO_ALTERADO", (d) => {
      d.alterarEstadoFisico(estado, justificativa);
      return { justificativa: justificativa?.trim() || undefined };
    });
  }

  async depreciacao(id: string, meses: number) {
    if (!Number.isFinite(meses) || meses < 0) throw new ErroValidacao("O numero de meses deve ser maior ou igual a zero.");
    const dominio = paraDominio(await this.obter(id));
    return {
      equipamentoId: id,
      tipo: dominio.tipo,
      mesesDeUso: meses,
      coeficiente: dominio.calcularCoeficienteDepreciacao(meses),
      vidaUtilEstimadaMeses: dominio.vidaUtilEstimadaMeses(),
    };
  }

  async rastreio(id: string) {
    const r = this.uow.simples();
    const equip = await r.equipamentos.buscarPorId(id);
    if (!equip) throw new ErroNaoEncontrado(`Equipamento ${id} nao encontrado.`);
    return { equipamento: equip, movimentacoes: await r.movimentacoes.historico(id) };
  }
}
