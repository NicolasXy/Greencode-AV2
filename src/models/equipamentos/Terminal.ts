import { Equipamento, ParametrosEquipamento } from "../Equipamento";

/**
 * Terminal de computador (ex.: terminais de atendimento bancario, caixas
 * registradoras eletronicas). E o tipo de equipamento citado na proposta
 * de negocio como o de maior rotatividade (substituicao de cerca de 40%
 * da frota a cada 18 meses em empresas de medio porte do setor bancario).
 *
 * Estende a classe abstrata Equipamento (HERANCA) e fornece sua propria
 * implementacao dos metodos abstratos de depreciacao (POLIMORFISMO):
 * curva LINEAR — o equipamento perde valor de forma constante ao longo de
 * toda a vida util estimada.
 */
export class Terminal extends Equipamento {
  // O construtor precisa ser declarado explicitamente (mesmo repassando
  // tudo para super()): sem ele, o TypeScript herdaria a visibilidade
  // "protected" do construtor da classe abstrata Equipamento, e o
  // "new Terminal(...)" feito pela EquipamentoFactory nao compilaria.
  constructor(params: ParametrosEquipamento) {
    super(params);
  }

  /** Identificador textual usado pela fabrica para reconhecer este tipo. */
  get tipo(): string {
    return "terminal";
  }

  /** Referencia de vida util usada no calculo de depreciacao e em relatorios. */
  vidaUtilEstimadaMeses(): number {
    return 36; // aproximadamente 3 anos, compativel com o ciclo de renovacao descrito na proposta
  }

  /** Depreciacao linear: proporcional direta entre meses de uso e vida util total. */
  calcularCoeficienteDepreciacao(mesesDeUso: number): number {
    return Math.min(1, Math.max(0, mesesDeUso) / this.vidaUtilEstimadaMeses());
  }
}

// spiderman
