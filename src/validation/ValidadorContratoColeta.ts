import { Validador } from "./Validador";

/** Formato de entrada esperado por ValidadorContratoColeta. */
export interface DadosContratoColeta {
  dataInicio: string; // ISO date (yyyy-mm-dd)
  frequenciaColetaDias: number;
}

/**
 * Validador concreto dos dados de um contrato de coleta (subclasse de
 * Validador<DadosContratoColeta>): garante que a data de inicio tenha um
 * formato valido e que a frequencia de coleta seja um numero positivo de
 * dias (nao faz sentido um contrato com coletas a cada 0 ou -5 dias).
 */
export class ValidadorContratoColeta extends Validador<DadosContratoColeta> {
  validar(valor: DadosContratoColeta): void {
    const data = new Date(valor.dataInicio + "T00:00:00");
    if (isNaN(data.getTime())) {
      this.lancarErro("Data de inicio do contrato invalida. Use o formato AAAA-MM-DD.");
    }
    if (!Number.isFinite(valor.frequenciaColetaDias) || valor.frequenciaColetaDias <= 0) {
      this.lancarErro("Frequencia de coleta deve ser um numero de dias maior que zero.");
    }
  }
}

// spiderman
