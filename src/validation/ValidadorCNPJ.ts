import { Validador } from "./Validador";
import { validarCNPJ, formatarCNPJ } from "../core/validators";

/**
 * Validador concreto de CNPJ (subclasse de Validador<string>).
 *
 * A logica de calculo dos digitos verificadores mora em
 * src/core/validators.ts (funcao validarCNPJ); esta classe apenas expoe
 * essa logica no formato orientado a objetos exigido pelo modelo de
 * dominio (heranca de uma classe abstrata Validador<T>), evitando
 * duplicar o algoritmo em dois lugares.
 */
export class ValidadorCNPJ extends Validador<string> {
  /** Implementacao exigida pela classe abstrata: valida e descarta o retorno. */
  validar(valor: string): void {
    validarCNPJ(valor); // lanca ErroValidacao internamente quando invalido
  }

  /** Valida e retorna o CNPJ normalizado (somente digitos, 14 posicoes) — usado pelas fabricas. */
  normalizarEValidar(valor: string): string {
    return validarCNPJ(valor);
  }

  /** Formata um CNPJ ja validado para exibicao (XX.XXX.XXX/XXXX-XX). */
  formatar(cnpj: string): string {
    return formatarCNPJ(cnpj);
  }
}

// spiderman
