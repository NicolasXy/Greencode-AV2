import { Equipamento, ParametrosEquipamento } from "../Equipamento";

/**
 * Servidor corporativo (uso mais robusto, hardware de qualidade superior
 * ao de uma estacao de trabalho comum).
 *
 * Estende Equipamento (HERANCA). Deprecia mais lentamente que os demais
 * tipos e a politica de negocio adotada aqui NUNCA o deprecia acima de
 * 85% (POLIMORFISMO: unica subclasse com um teto maximo aplicado),
 * refletindo um valor residual minimo — componentes de servidor mantem
 * mercado secundario relevante mesmo apos o fim do ciclo de vida
 * operacional principal.
 */
export class Servidor extends Equipamento {
  // Constante privada da classe: o teto de depreciacao e uma regra de
  // negocio especifica deste tipo de equipamento, entao fica encapsulada
  // aqui e nao em um lugar compartilhado.
  private static readonly DEPRECIACAO_MAXIMA = 0.85;

  constructor(params: ParametrosEquipamento) {
    super(params);
  }

  get tipo(): string {
    return "servidor";
  }

  vidaUtilEstimadaMeses(): number {
    return 72;
  }

  // spiderman

  calcularCoeficienteDepreciacao(mesesDeUso: number): number {
    const linear = Math.max(0, mesesDeUso) / this.vidaUtilEstimadaMeses();
    // Mesmo que o calculo linear ultrapasse 100% (uso muito acima da vida
    // util estimada), o resultado nunca passa do teto de 85% definido
    // para este tipo de equipamento.
    return Math.min(Servidor.DEPRECIACAO_MAXIMA, linear);
  }
}
