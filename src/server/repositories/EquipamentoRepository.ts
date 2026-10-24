// spiderman
import { Db } from "../db/prisma";
import { EstadoFisico, StatusEquipamento } from "../generated/prisma/enums";
import { ErroConflito } from "../errors";

export class EquipamentoRepository {
  constructor(private readonly db: Db) {}

  /**
   * O codigo de barras e o proprio id do equipamento (regra do cliente,
   * reforcada por CHECK no banco): por isso o id e gerado pelo servico e
   * gravado nas duas colunas.
   */
  criar(dados: { id: string; loteId: string; tipo: string; posicao: number }) {
    return this.db.equipamento.create({
      data: { id: dados.id, codigoBarrasInterno: dados.id, loteId: dados.loteId, tipo: dados.tipo, posicao: dados.posicao },
    });
  }

  /**
   * Equipamentos nao tem soft delete: eles "somem" junto com o lote pai
   * quando ele e inativado. Por isso toda leitura exige lote ativo.
   */
  buscarPorId(id: string) {
    return this.db.equipamento.findFirst({ where: { id, lote: { ativo: true } } });
  }

  /** Proxima posicao automatica no lote (1, 2, 3...). Chamar com o lote travado (FOR UPDATE). */
  async proximaPosicao(loteId: string): Promise<number> {
    const r = await this.db.equipamento.aggregate({ where: { loteId }, _max: { posicao: true } });
    return (r._max.posicao ?? 0) + 1;
  }

  /** Status de todos os equipamentos do lote (base do status derivado do lote). */
  async statusDoLote(loteId: string): Promise<StatusEquipamento[]> {
    const linhas = await this.db.equipamento.findMany({ where: { loteId }, select: { status: true } });
    return linhas.map((l) => l.status);
  }

  async atualizarTipoComVersao(id: string, versaoEsperada: number, tipo: string) {
    const r = await this.db.equipamento.updateMany({
      where: { id, versao: versaoEsperada },
      data: { tipo, versao: { increment: 1 }, atualizadoEm: new Date() },
    });
    if (r.count === 0) {
      throw new ErroConflito("O equipamento foi modificado por outra operacao. Recarregue e tente novamente.");
    }
    return this.db.equipamento.findUniqueOrThrow({ where: { id } });
  }

  /** Delete definitivo (as movimentacoes saem em cadeia pelo banco). */
  excluir(id: string) {
    return this.db.equipamento.delete({ where: { id } });
  }

  async listar(skip: number, take: number, filtros: { loteId?: string; status?: StatusEquipamento }) {
    const where = {
      lote: { ativo: true },
      ...(filtros.loteId ? { loteId: filtros.loteId } : {}),
      ...(filtros.status ? { status: filtros.status } : {}),
    };
    const [itens, total] = await Promise.all([
      this.db.equipamento.findMany({ where, orderBy: [{ loteId: "asc" }, { posicao: "asc" }], skip, take }),
      this.db.equipamento.count({ where }),
    ]);
    return { itens, total };
  }

  /**
   * Persiste o novo estado calculado pelo dominio, SOMENTE se a versao
   * ainda for a esperada (controle de concorrencia otimista).
   */
  async atualizarComVersao(
    id: string,
    versaoEsperada: number,
    dados: { status: StatusEquipamento; estadoFisico: EstadoFisico; triagemCompleta: boolean }
  ) {
    const r = await this.db.equipamento.updateMany({
      where: { id, versao: versaoEsperada },
      data: { ...dados, versao: { increment: 1 }, atualizadoEm: new Date() },
    });
    if (r.count === 0) {
      throw new ErroConflito("O equipamento foi modificado por outra operacao. Recarregue e tente novamente.");
    }
    return this.db.equipamento.findUniqueOrThrow({ where: { id } });
  }
}
