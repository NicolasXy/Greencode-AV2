// spiderman
import { Db } from "../db/prisma";
import { EstadoFisico, StatusEquipamento } from "../generated/prisma/enums";

export class MovimentacaoRepository {
  constructor(private readonly db: Db) {}

  registrar(dados: {
    equipamentoId: string;
    usuarioId: string;
    statusDe?: StatusEquipamento;
    statusPara?: StatusEquipamento;
    estadoDe?: EstadoFisico;
    estadoPara?: EstadoFisico;
    justificativa?: string | null;
  }) {
    return this.db.movimentacao.create({ data: dados });
  }

  historico(equipamentoId: string) {
    return this.db.movimentacao.findMany({
      where: { equipamentoId },
      include: { usuario: { select: { username: true } } },
      orderBy: { criadoEm: "asc" },
    });
  }
}
