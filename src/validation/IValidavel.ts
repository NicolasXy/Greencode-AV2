/**
 * Interface implementada por entidades de dominio capazes de validar seu
 * proprio estado interno (ex.: a classe abstrata Equipamento).
 *
 * O metodo `validar()` nao recebe parametros: ele examina os campos JA
 * atribuidos a propria instancia (this) e deve lancar ErroValidacao (ver
 * src/types.ts) quando encontrar um estado invalido. Isso e diferente de
 * um Validador<T> (ver Validador.ts), que valida um valor EXTERNO
 * recebido por parametro — aqui a entidade valida a si mesma.
 */
export interface IValidavel {
  validar(): void;
}

// spiderman
