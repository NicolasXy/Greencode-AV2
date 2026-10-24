// spiderman
import { Db } from "../db/prisma";
import { StatusLote } from "../generated/prisma/enums";
import { ErroConflito } from "../errors";

export class LoteRepository {
  constructor(private readonly db: Db) {}

  criar(dados: {
    organizacaoId: string;
    nf: string;
    transportadora: string;
    dataEntrada: Date;
    criadoPorId: string;
  }) {
    return this.db.lote.create({ data: dados, include: { organizacao: true } });
  }

  buscarPorId(id: string) {
    return this.db.lote.findUnique({ where: { id }, include: { organizacao: true } });
  }

  /**
   * Trava a linha do lote ate o fim da transacao (SELECT ... FOR UPDATE).
   * Serializa as operacoes que mexem nos equipamentos do mesmo lote:
   * alocacao da posicao e recalculo do status derivado do lote.
   */
  async bloquear(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM "Lote" WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /** Edicao de dados cadastrais com controle de versao. */
  async atualizarDados(id: string, versaoEsperada: number, dados: { nf?: string; transportadora?: string; dataEntrada?: Date }) {
    const r = await this.db.lote.updateMany({
      where: { id, versao: versaoEsperada },
      data: { ...dados, versao: { increment: 1 }, atualizadoEm: new Date() },
    });
    if (r.count === 0) {
      throw new ErroConflito("O lote foi modificado por outra operacao. Recarregue e tente novamente.");
    }
    return this.db.lote.findUniqueOrThrow({ where: { id }, include: { organizacao: true } });
  }

  /** Soft delete do proprio lote. */
  async inativar(id: string, versaoEsperada: number, agora: Date) {
    return this.atualizarAtivo(id, versaoEsperada, { ativo: false, inativadoEm: agora });
  }

  async reativar(id: string, versaoEsperada: number) {
    return this.atualizarAtivo(id, versaoEsperada, { ativo: true, inativadoEm: null });
  }

  private async atualizarAtivo(id: string, versaoEsperada: number, dados: { ativo: boolean; inativadoEm: Date | null }) {
    const r = await this.db.lote.updateMany({
      where: { id, versao: versaoEsperada },
      data: { ...dados, versao: { increment: 1 }, atualizadoEm: new Date() },
    });
    if (r.count === 0) {
      throw new ErroConflito("O lote foi modificado por outra operacao. Recarregue e tente novamente.");
    }
    return this.db.lote.findUniqueOrThrow({ where: { id }, include: { organizacao: true } });
  }

  /** Delete definitivo (equipamentos e movimentacoes saem em cadeia pelo banco). */
  excluir(id: string) {
    return this.db.lote.delete({ where: { id } });
  }

  /** Carregamento antecipado (eager loading): lote + organizacao + equipamentos em uma consulta. */
  buscarDetalhado(id: string) {
    return this.db.lote.findUnique({
      where: { id },
      include: { organizacao: true, equipamentos: { orderBy: { criadoEm: "asc" } } },
    });
  }

  async listar(skip: number, take: number, filtros: { status?: StatusLote; cnpj?: string; incluirInativos?: boolean }) {
    const where = {
      ...(filtros.incluirInativos ? {} : { ativo: true }),
      ...(filtros.status ? { status: filtros.status } : {}),
      ...(filtros.cnpj ? { organizacao: { cnpj: filtros.cnpj } } : {}),
    };
    const [itens, total] = await Promise.all([
      this.db.lote.findMany({
        where,
        include: { organizacao: true, _count: { select: { equipamentos: true } } },
        orderBy: { criadoEm: "desc" },
        skip,
        take,
      }),
      this.db.lote.count({ where }),
    ]);
    return { itens, total };
  }

  async atualizarStatusComVersao(id: string, versaoEsperada: number, status: StatusLote) {
    const r = await this.db.lote.updateMany({
      where: { id, versao: versaoEsperada },
      data: { status, versao: { increment: 1 }, atualizadoEm: new Date() },
    });
    if (r.count === 0) {
      throw new ErroConflito("O lote foi modificado por outra operacao. Recarregue e tente novamente.");
    }
    return this.db.lote.findUniqueOrThrow({ where: { id }, include: { organizacao: true } });
  }
}
