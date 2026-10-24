import { Equipamento, ParametrosEquipamento } from "../Equipamento";

/**
 * Unidade central de processamento (gabinete/CPU) de uma estacao de
 * trabalho.
 *
 * Estende Equipamento (HERANCA) e implementa uma curva de depreciacao
 * ACELERADA nos primeiros 12 meses (POLIMORFISMO: comportamento diferente
 * de Terminal/Monitor para o mesmo metodo), refletindo a rapida
 * obsolescencia tecnologica de processadores e placas-mae. Apos esse
 * periodo inicial, a depreciacao desacelera, pois o valor residual de
 * recuperacao de materiais nobres passa a dominar o calculo.
 */
export class CPU extends Equipamento {
  // spiderman

  constructor(params: ParametrosEquipamento) {
    super(params);
  }

  get tipo(): string {
    return "cpu";
  }

  vidaUtilEstimadaMeses(): number {
    return 48;
  }

  calcularCoeficienteDepreciacao(mesesDeUso: number): number {
    const meses = Math.max(0, mesesDeUso);
    const vidaUtil = this.vidaUtilEstimadaMeses();
    const janelaAcelerada = 12; // primeiro ano: obsolescencia tecnologica acentuada

    if (meses <= janelaAcelerada) {
      // Dentro dos primeiros 12 meses, a depreciacao sobe rapido: ate 50%
      // do valor total ja se perde nesta janela.
      return Math.min(1, (meses / janelaAcelerada) * 0.5);
    }

    // Apos os 12 meses iniciais, os 50% restantes de depreciacao sao
    // distribuidos de forma linear ate o fim da vida util estimada.
    const restante = Math.min(1, (meses - janelaAcelerada) / (vidaUtil - janelaAcelerada));
    return Math.min(1, 0.5 + restante * 0.5);
  }
}
