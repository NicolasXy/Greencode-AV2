import { Equipamento, ParametrosEquipamento } from "../Equipamento";

/**
 * Monitor de video.
 *
 * Estende Equipamento (HERANCA). Tem vida util estimada mais longa que
 * terminais e CPUs, pois a tecnologia de exibicao evolui de forma menos
 * disruptiva, e usa depreciacao LINEAR (POLIMORFISMO: mesma formula geral
 * de Terminal, mas com parametro de vida util diferente).
 */
export class Monitor extends Equipamento {
  constructor(params: ParametrosEquipamento) {
    super(params);
  }

  get tipo(): string {
    return "monitor";
  }

  vidaUtilEstimadaMeses(): number {
    return 60;
  }

  calcularCoeficienteDepreciacao(mesesDeUso: number): number {
    return Math.min(1, Math.max(0, mesesDeUso) / this.vidaUtilEstimadaMeses());
  }
}

// spiderman
