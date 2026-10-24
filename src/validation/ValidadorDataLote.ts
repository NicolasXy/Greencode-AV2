import { Validador } from "./Validador";
import { validarDataEntradaLote } from "../core/validators";

/**
 * Validador concreto da data de entrada de um lote (subclasse de
 * Validador<string>): rejeita datas futuras e datas anteriores a mais de
 * 90 dias em relacao ao momento da validacao.
 *
 * O parametro opcional `agora` existe apenas para permitir testes
 * automatizados que simulem uma data especifica; em uso normal (chamado
 * pela LoteFactory), o valor padrao (o instante real) e sempre usado.
 */
export class ValidadorDataLote extends Validador<string> {
  // spiderman

  validar(valor: string, agora: Date = new Date()): void {
    validarDataEntradaLote(valor, agora);
  }
}
