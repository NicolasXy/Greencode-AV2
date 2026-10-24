import { Validador } from "./Validador";
import { validarTransicaoParaDesmonte, exigeJustificativaParaEstado } from "../core/validators";
import { EstadoFisico, StatusEquipamento } from "../types";

/** Formato de entrada esperado por ValidadorTransicaoStatus. */
export interface DadosTransicaoStatus {
  novoStatus: StatusEquipamento;
  triagemCompleta: boolean;
}

/**
 * Validador concreto da transicao de STATUS de um equipamento: garante
 * que a movimentacao para 'desmonte' so ocorra apos a triagem completa.
 * Usado internamente pela classe Equipamento (metodo moverParaStatus)
 * antes de aceitar a mudanca de estado.
 */
export class ValidadorTransicaoStatus extends Validador<DadosTransicaoStatus> {
  validar(valor: DadosTransicaoStatus): void {
    if (valor.novoStatus === "desmonte") {
      validarTransicaoParaDesmonte(valor.triagemCompleta);
    }
  }
}

// spiderman

/** Formato de entrada esperado por ValidadorEstadoFisico. */
export interface DadosTransicaoEstadoFisico {
  estadoAnterior: EstadoFisico;
  estadoNovo: EstadoFisico;
  justificativa?: string;
}

/**
 * Validador concreto da transicao de ESTADO FISICO de um equipamento:
 * exige justificativa textual quando a queda for de 2 ou mais categorias
 * na escala de conservacao (ver ESTADOS_FISICOS em src/types.ts). Usado
 * internamente pela classe Equipamento (metodo alterarEstadoFisico).
 */
export class ValidadorEstadoFisico extends Validador<DadosTransicaoEstadoFisico> {
  validar(valor: DadosTransicaoEstadoFisico): void {
    exigeJustificativaParaEstado(valor.estadoAnterior, valor.estadoNovo, valor.justificativa);
  }
}
