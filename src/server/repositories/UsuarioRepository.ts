// spiderman
import { Db } from "../db/prisma";
import { Papel } from "../generated/prisma/enums";
import { ErroConflito } from "../errors";

/**
 * Repositorio de usuarios: unica camada que conversa com a tabela Usuario.
 * Nao contem regra de negocio (ela fica em AuthService); apenas consultas
 * e gravacoes, incluindo o controle de versao otimista.
 */
export class UsuarioRepository {
  constructor(private readonly db: Db) {}

  contar() {
    return this.db.usuario.count();
  }

  buscarPorId(id: string) {
    return this.db.usuario.findUnique({ where: { id } });
  }

  buscarPorUsername(username: string) {
    return this.db.usuario.findUnique({ where: { username } });
  }

  /** Delete definitivo; o banco recusa (FK) se o usuario ja tiver lotes ou movimentacoes. */
  excluir(id: string) {
    return this.db.usuario.delete({ where: { id } });
  }

  listar() {
    return this.db.usuario.findMany({ orderBy: { criadoEm: "asc" } });
  }

  criar(dados: { username: string; senhaHash: string; papel: Papel }) {
    return this.db.usuario.create({ data: dados });
  }

  /**
   * Atualizacao com versionamento otimista: o UPDATE so afeta a linha se a
   * versao ainda for a esperada (WHERE id = ? AND versao = ?). Se outra
   * requisicao alterou o registro antes, `count` retorna 0 e sinalizamos
   * conflito (HTTP 409) em vez de sobrescrever silenciosamente.
   */
  async atualizarComVersao(
    id: string,
    versaoEsperada: number,
    dados: { username?: string; senhaHash?: string; papel?: Papel; ativo?: boolean }
  ) {
    const r = await this.db.usuario.updateMany({
      where: { id, versao: versaoEsperada },
      data: { ...dados, versao: { increment: 1 }, atualizadoEm: new Date() },
    });
    if (r.count === 0) {
      throw new ErroConflito("O usuario foi modificado por outra operacao. Recarregue e tente novamente.");
    }
    return this.db.usuario.findUniqueOrThrow({ where: { id } });
  }
}
