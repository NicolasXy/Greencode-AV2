// spiderman
import { Db, Prisma } from "../db/prisma";

/** Trilha de auditoria (equivalente ao journal do CLI). Somente INSERT e leitura. */
export class AuditoriaRepository {
  constructor(private readonly db: Db) {}

  registrar(usuarioId: string | null, acao: string, detalhes?: Prisma.InputJsonValue) {
    return this.db.auditoria.create({ data: { usuarioId, acao, detalhes } });
  }

  async listar(skip: number, take: number, acao?: string) {
    const where = acao ? { acao } : {};
    const [itens, total] = await Promise.all([
      this.db.auditoria.findMany({
        where,
        include: { usuario: { select: { username: true } } },
        orderBy: { id: "desc" },
        skip,
        take,
      }),
      this.db.auditoria.count({ where }),
    ]);
    return { itens, total };
  }
}
