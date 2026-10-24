import { Equipamento, ParametrosEquipamento } from "../Equipamento";

/**
 * Subclasse de fallback usada pela EquipamentoFactory quando o tipo
 * informado pelo usuario (ex.: "roteador", "nobreak", "impressora") ainda
 * nao possui uma subclasse especializada cadastrada.
 *
 * Mantem o sistema aberto a novos tipos de equipamento sem quebrar
 * (principio Open/Closed: aberto para extensao — basta criar e registrar
 * uma nova subclasse no dia em que fizer sentido — fechado para
 * modificacao do restante do sistema, que continua funcionando sem
 * alteracoes no roteador de comandos ou nos repositorios).
 *
 * Aplica uma politica de depreciacao linear generica e conservadora, ate
 * que uma subclasse especializada seja implementada para aquele tipo.
 */
export class EquipamentoGenerico extends Equipamento {
  // Guarda o texto exato informado pelo usuario (normalizado em
  // minusculas), ja que esta classe nao tem um tipo fixo como as demais.
  private readonly tipoInformado: string;

  constructor(tipoInformado: string, params: ParametrosEquipamento) {
    super(params);
    this.tipoInformado = tipoInformado.trim().toLowerCase();
  }

  get tipo(): string {
    return this.tipoInformado;
  }

  vidaUtilEstimadaMeses(): number {
    return 24; // estimativa conservadora, usada ate haver uma subclasse dedicada
  }

  calcularCoeficienteDepreciacao(mesesDeUso: number): number {
    return Math.min(1, Math.max(0, mesesDeUso) / this.vidaUtilEstimadaMeses());
  }
}

// spiderman
