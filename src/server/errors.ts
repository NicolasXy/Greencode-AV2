// spiderman
/**
 * Erros especificos da camada HTTP/servico. Os erros de dominio ja
 * existentes (ErroValidacao, ErroPermissao, ErroSessao em src/types.ts)
 * continuam sendo usados pelas regras de negocio compartilhadas com o CLI;
 * estes complementam o conjunto com situacoes proprias de uma API.
 */

/** Recurso solicitado nao existe (mapeado para HTTP 404). */
export class ErroNaoEncontrado extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErroNaoEncontrado";
  }
}

/** Conflito de estado: duplicidade, regra de unicidade ou versao desatualizada (HTTP 409). */
export class ErroConflito extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErroConflito";
  }
}

/** Credenciais ausentes, invalidas ou token expirado (HTTP 401). */
export class ErroNaoAutenticado extends Error {
  constructor(message = "Autenticacao necessaria.") {
    super(message);
    this.name = "ErroNaoAutenticado";
  }
}
