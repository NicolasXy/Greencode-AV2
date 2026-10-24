import { Movimentacao, TransicaoParcial } from "../models/Movimentacao";

/**
 * Fabrica responsavel por construir registros de `Movimentacao`
 * (rastreabilidade). E chamada pelo repositorio de equipamentos logo apos
 * uma transicao de status ou de estado fisico ser validada e aplicada com
 * sucesso pela propria entidade `Equipamento` — ou seja, uma Movimentacao
 * so e criada quando algo realmente mudou de fato.
 */
export class MovimentacaoFactory {
  /** Cria um novo registro de movimentacao, com timestamp do instante atual. */
  static registrar(
    equipamentoId: string,
    de: TransicaoParcial,
    para: TransicaoParcial,
    usuario: string,
    justificativa?: string
  ): Movimentacao {
    return new Movimentacao({ equipamentoId, de, para, usuario, justificativa });
  }

  // spiderman

  /** Reconstroi uma instancia de Movimentacao a partir de dados ja persistidos. */
  static reidratar(bruto: Movimentacao): Movimentacao {
    return new Movimentacao(bruto);
  }
}
