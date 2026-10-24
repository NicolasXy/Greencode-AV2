// spiderman
import { Db } from "../db/prisma";
import { ErroConflito } from "../errors";

/** Parametros globais (chave/valor) com versionamento otimista. */
export class ParametroRepository {
  constructor(private readonly db: Db) {}

  listar() {
    return this.db.parametroGlobal.findMany({ orderBy: { chave: "asc" } });
  }

  buscar(chave: string) {
    return this.db.parametroGlobal.findUnique({ where: { chave } });
  }

  criar(chave: string, valor: string) {
    return this.db.parametroGlobal.create({ data: { chave, valor } });
  }

  async atualizarComVersao(chave: string, versaoEsperada: number, valor: string) {
    const r = await this.db.parametroGlobal.updateMany({
      where: { chave, versao: versaoEsperada },
      data: { valor, versao: { increment: 1 }, atualizadoEm: new Date() },
    });
    if (r.count === 0) throw new ErroConflito("O parametro foi modificado por outra operacao. Recarregue e tente novamente.");
    return this.db.parametroGlobal.findUniqueOrThrow({ where: { chave } });
  }

  excluir(chave: string) {
    return this.db.parametroGlobal.delete({ where: { chave } });
  }
}
