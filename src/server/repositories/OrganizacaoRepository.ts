// spiderman
import { Db } from "../db/prisma";
import { ErroConflito } from "../errors";

export class OrganizacaoRepository {
  constructor(private readonly db: Db) {}

  criar(dados: { cnpj: string; razaoSocial: string; contato?: string | null }) {
    return this.db.organizacao.create({ data: dados });
  }

  buscarPorId(id: string) {
    return this.db.organizacao.findUnique({ where: { id } });
  }

  buscarPorCnpj(cnpj: string) {
    return this.db.organizacao.findUnique({ where: { cnpj }, include: { contrato: true } });
  }

  async listar(skip: number, take: number, incluirInativos = false) {
    const where = incluirInativos ? {} : { ativo: true };
    const [itens, total] = await Promise.all([
      this.db.organizacao.findMany({ where, orderBy: { razaoSocial: "asc" }, skip, take }),
      this.db.organizacao.count({ where }),
    ]);
    return { itens, total };
  }

  /**
   * Soft delete EM CADEIA: inativa a organizacao e todos os seus lotes com o
   * MESMO carimbo de tempo. Os equipamentos nao tem estado proprio de
   * inativacao: deixam de aparecer porque o lote pai esta inativo.
   * Retorna quantos lotes foram inativados.
   */
  async inativar(id: string, versaoEsperada: number, agora: Date): Promise<number> {
    await this.atualizarAtivo(id, versaoEsperada, { ativo: false, inativadoEm: agora });
    const r = await this.db.lote.updateMany({
      where: { organizacaoId: id, ativo: true },
      data: { ativo: false, inativadoEm: agora, versao: { increment: 1 }, atualizadoEm: agora },
    });
    return r.count;
  }

  /** Reativa a organizacao e SOMENTE os lotes inativados junto com ela (mesmo carimbo de tempo). */
  async reativar(id: string, versaoEsperada: number, inativadaEm: Date | null): Promise<number> {
    await this.atualizarAtivo(id, versaoEsperada, { ativo: true, inativadoEm: null });
    if (!inativadaEm) return 0;
    const r = await this.db.lote.updateMany({
      where: { organizacaoId: id, ativo: false, inativadoEm: inativadaEm },
      data: { ativo: true, inativadoEm: null, versao: { increment: 1 }, atualizadoEm: new Date() },
    });
    return r.count;
  }

  private async atualizarAtivo(id: string, versaoEsperada: number, dados: { ativo: boolean; inativadoEm: Date | null }) {
    const r = await this.db.organizacao.updateMany({
      where: { id, versao: versaoEsperada },
      data: { ...dados, versao: { increment: 1 }, atualizadoEm: new Date() },
    });
    if (r.count === 0) {
      throw new ErroConflito("A organizacao foi modificada por outra operacao. Recarregue e tente novamente.");
    }
  }

  /** Delete definitivo: contrato, lotes, equipamentos e movimentacoes saem em cadeia pelo banco. */
  excluir(id: string) {
    return this.db.organizacao.delete({ where: { id } });
  }

  async atualizarComVersao(id: string, versaoEsperada: number, dados: { razaoSocial?: string; contato?: string | null }) {
    const r = await this.db.organizacao.updateMany({
      where: { id, versao: versaoEsperada },
      data: { ...dados, versao: { increment: 1 }, atualizadoEm: new Date() },
    });
    if (r.count === 0) {
      throw new ErroConflito("A organizacao foi modificada por outra operacao. Recarregue e tente novamente.");
    }
    return this.db.organizacao.findUniqueOrThrow({ where: { id } });
  }
}
