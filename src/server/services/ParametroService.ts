// spiderman
import { UnidadeDeTrabalho } from "../db/unidadeDeTrabalho";
import { ErroValidacao } from "../../types";
import { ErroConflito, ErroNaoEncontrado } from "../errors";
import { Ator } from "./tipos";

const CHAVE_VALIDA = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Parametros globais do sistema (ex.: aliquota_icms), geridos pelo admin.
 * Equivale ao "config set/get" do CLI; agora persistido no banco, versionado
 * e auditado na mesma transacao da alteracao.
 */
export class ParametroService {
  constructor(private readonly uow: UnidadeDeTrabalho) {}

  listar() {
    return this.uow.simples().parametros.listar();
  }

  async obter(chave: string) {
    const p = await this.uow.simples().parametros.buscar(chave);
    if (!p) throw new ErroNaoEncontrado(`Parametro '${chave}' nao definido.`);
    return p;
  }

  /** Cria ou atualiza (upsert versionado). Se `versao` for informada e divergir, retorna 409. */
  definir(ator: Ator, chave: string, valor: string, versao?: number) {
    if (!CHAVE_VALIDA.test(chave)) {
      throw new ErroValidacao("A chave deve ter de 1 a 64 caracteres: letras, numeros, '_', '.' ou '-'.");
    }
    if (typeof valor !== "string") throw new ErroValidacao("O valor do parametro deve ser texto.");
    return this.uow.transacao(async (r) => {
      const atual = await r.parametros.buscar(chave);
      let resultado;
      if (!atual) {
        if (versao !== undefined) throw new ErroConflito("O parametro nao existe; omita a versao para cria-lo.");
        resultado = await r.parametros.criar(chave, valor);
      } else {
        resultado = await r.parametros.atualizarComVersao(chave, versao ?? atual.versao, valor);
      }
      await r.auditoria.registrar(ator.id, "PARAMETRO_ALTERADO", { chave, valor });
      return resultado;
    });
  }

  excluir(ator: Ator, chave: string) {
    return this.uow.transacao(async (r) => {
      if (!(await r.parametros.buscar(chave))) throw new ErroNaoEncontrado(`Parametro '${chave}' nao definido.`);
      await r.parametros.excluir(chave);
      await r.auditoria.registrar(ator.id, "PARAMETRO_EXCLUIDO", { chave });
    });
  }
}

/** Leitura da trilha de auditoria (camada de servico para o controller nao tocar em repositorio). */
export class AuditoriaService {
  constructor(private readonly uow: UnidadeDeTrabalho) {}

  async listar(skip: number, take: number, acao?: string) {
    const r = await this.uow.simples().auditoria.listar(skip, take, acao);
    // BigInt nao e serializavel em JSON: o id vai como string.
    return { itens: r.itens.map((a) => ({ ...a, id: a.id.toString() })), total: r.total };
  }
}
