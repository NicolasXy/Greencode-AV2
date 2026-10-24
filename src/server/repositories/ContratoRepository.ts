// spiderman
import { Db, Prisma } from "../db/prisma";
import { ErroConflito } from "../errors";

export class ContratoRepository {
  constructor(private readonly db: Db) {}

  criar(dados: {
    organizacaoId: string;
    dataInicio: Date;
    frequenciaColetaDias: number;
    condicoes?: string | null;
    clausulas?: Prisma.InputJsonValue;
  }) {
    return this.db.contrato.create({ data: dados, include: { organizacao: true } });
  }

  /** Delete definitivo (contrato nao tem soft delete; "encerrar" e a forma de torna-lo inativo). */
  excluir(id: string) {
    return this.db.contrato.delete({ where: { id } });
  }

  buscarPorId(id: string) {
    return this.db.contrato.findUnique({ where: { id }, include: { organizacao: true } });
  }

  buscarPorOrganizacao(organizacaoId: string) {
    return this.db.contrato.findUnique({ where: { organizacaoId }, include: { organizacao: true } });
  }

  async listar(skip: number, take: number, incluirInativos = false) {
    const where = incluirInativos ? {} : { organizacao: { ativo: true } };
    const [itens, total] = await Promise.all([
      this.db.contrato.findMany({ where, include: { organizacao: true }, orderBy: { criadoEm: "desc" }, skip, take }),
      this.db.contrato.count({ where }),
    ]);
    return { itens, total };
  }

  async atualizarComVersao(
    id: string,
    versaoEsperada: number,
    dados: {
      frequenciaColetaDias?: number;
      condicoes?: string | null;
      clausulas?: Prisma.InputJsonValue;
      ativo?: boolean;
    }
  ) {
    const r = await this.db.contrato.updateMany({
      where: { id, versao: versaoEsperada },
      data: { ...dados, versao: { increment: 1 }, atualizadoEm: new Date() },
    });
    if (r.count === 0) {
      throw new ErroConflito("O contrato foi modificado por outra operacao. Recarregue e tente novamente.");
    }
    return this.db.contrato.findUniqueOrThrow({ where: { id }, include: { organizacao: true } });
  }
}
