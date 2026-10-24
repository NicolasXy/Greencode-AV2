import { ErroValidacao } from "../types";

/**
 * Classe abstrata base para validadores de dados especificos do dominio
 * (ex.: CNPJ, datas de lote, transicoes de estado de equipamento).
 *
 * Cada subclasse concreta encapsula UMA regra de validacao coesa (Single
 * Responsibility Principle) e pode ser reutilizada tanto pelas fabricas
 * (na criacao de novas entidades) quanto pelas proprias entidades (em
 * seus metodos de mutacao de estado, como Equipamento.moverParaStatus).
 *
 * O parametro de tipo `T` representa o formato do valor que aquela
 * validacao especifica examina — por exemplo, `Validador<string>` para
 * CNPJ (uma string), ou `Validador<{ novoStatus, triagemCompleta }>`
 * para uma transicao de status (um objeto composto).
 */
export abstract class Validador<T> {
  /** Valida o valor informado; lanca ErroValidacao quando invalido, nao retorna nada quando valido. */
  abstract validar(valor: T): void;

  /** Atalho para lancar um erro de validacao com mensagem padronizada, evitando repetir "throw new ErroValidacao(...)" em cada subclasse. */
  protected lancarErro(mensagem: string): never {
    throw new ErroValidacao(mensagem);
  }
}

// spiderman
