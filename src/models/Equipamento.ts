import { Entidade } from "./Entidade";
import { IValidavel } from "../validation/IValidavel";
import { ValidadorTransicaoStatus, ValidadorEstadoFisico } from "../validation/ValidadorTransicaoEquipamento";
import { EstadoFisico, ErroValidacao, StatusEquipamento } from "../types";

/** Dados necessarios para construir um Equipamento (novo ou reidratado do disco). Compartilhado por todas as subclasses. */
export interface ParametrosEquipamento {
  loteId: string;
  codigoBarras: string;
  estadoFisico?: EstadoFisico; // se omitido, comeca como "novo"
  status?: StatusEquipamento; // se omitido, comeca como "aguardando_triagem"
  triagemCompleta?: boolean; // se omitido, comeca como false
  id?: string;
  criadoEm?: string;
  atualizadoEm?: string;
}

// Instancias unicas dos validadores de transicao, reaproveitadas por
// todas as chamadas de moverParaStatus/alterarEstadoFisico (nao ha
// necessidade de criar um validador novo a cada chamada, ja que eles nao
// guardam estado proprio entre usos).
const validadorTransicaoStatus = new ValidadorTransicaoStatus();
const validadorEstadoFisico = new ValidadorEstadoFisico();

/**
 * Classe abstrata que representa um equipamento eletronico dentro de um
 * lote. Concentra o estado e o comportamento COMUNS a qualquer tipo de
 * equipamento (codigo de barras, estado fisico, status de triagem e
 * destinacao, regras de transicao), e implementa a interface
 * `IValidavel` para que cada instancia saiba validar seu proprio estado
 * minimo obrigatorio.
 *
 * O que VARIA por tipo de equipamento — a estimativa de vida util e a
 * formula de calculo do coeficiente de depreciacao acumulada, usados nos
 * relatorios de consultoria e na precificacao de materias-primas
 * secundarias mencionados na proposta de negocio — fica declarado aqui
 * como membros `abstract`, e cada subclasse concreta (Terminal, CPU,
 * Monitor, Servidor, EquipamentoGenerico) fornece sua propria
 * implementacao. Este e o ponto de POLIMORFISMO central do modelo de
 * dominio: o roteador de comandos e os repositorios manipulam sempre a
 * referencia abstrata `Equipamento`, sem saber qual subclasse concreta
 * esta por tras — o comportamento correto e escolhido automaticamente em
 * tempo de execucao quando, por exemplo, o comando
 * "equipamento depreciacao" chama `equip.calcularCoeficienteDepreciacao(meses)`.
 */
export abstract class Equipamento extends Entidade implements IValidavel {
  public loteId: string;
  public codigoBarras: string;
  public estadoFisico: EstadoFisico;
  public status: StatusEquipamento;
  public triagemCompleta: boolean;
  public atualizadoEm: string;

  protected constructor(params: ParametrosEquipamento) {
    super(params.id, params.criadoEm);
    this.loteId = params.loteId;
    this.codigoBarras = params.codigoBarras;
    this.estadoFisico = params.estadoFisico ?? "novo";
    this.status = params.status ?? "aguardando_triagem";
    this.triagemCompleta = params.triagemCompleta ?? false;
    this.atualizadoEm = params.atualizadoEm ?? this.criadoEm;
  }

  /**
   * Identificador textual do tipo concreto (ex.: "terminal", "cpu").
   * Implementado como um GETTER (nao um campo comum) para que cada
   * subclasse retorne seu proprio valor automaticamente, sem precisar
   * receber esse dado por parametro. Usado pela EquipamentoFactory para
   * reidratar a subclasse correta ao reler do disco.
   */
  abstract get tipo(): string;

  /**
   * Calcula o coeficiente de depreciacao acumulado (0 a 1) apos o numero
   * de meses de uso informado. Cada subclasse implementa sua propria
   * curva de depreciacao, refletindo o comportamento real do tipo de
   * equipamento (ex.: CPUs sofrem obsolescencia tecnologica mais
   * acentuada nos primeiros meses; monitores depreciam de forma mais
   * linear; servidores tem um teto maximo de depreciacao).
   */
  abstract calcularCoeficienteDepreciacao(mesesDeUso: number): number;

  /** Vida util estimada, em meses, usada como referencia pelo calculo de depreciacao e por relatorios gerenciais. */
  abstract vidaUtilEstimadaMeses(): number;

  /**
   * Auto-validacao do estado minimo obrigatorio de qualquer equipamento
   * (implementacao da interface IValidavel). Chamada pela
   * EquipamentoFactory logo apos a construcao de uma instancia nova.
   */
  validar(): void {
    if (!this.codigoBarras || this.codigoBarras.trim().length === 0) {
      throw new ErroValidacao("Codigo de barras e obrigatorio para o equipamento.");
    }
    if (!this.loteId || this.loteId.trim().length === 0) {
      throw new ErroValidacao("Equipamento deve estar associado a um lote.");
    }
  }

  /** Marca a triagem do equipamento como concluida, avancando seu status para "triado". */
  concluirTriagem(): void {
    this.triagemCompleta = true;
    this.status = "triado";
    this.tocar();
  }

  /**
   * Move o equipamento para um novo status, aplicando as regras de
   * transicao (ex.: exige triagem completa antes de ir para "desmonte").
   * A validacao em si mora no ValidadorTransicaoStatus — este metodo
   * apenas orquestra: valida, aplica a mudanca e atualiza o carimbo de
   * modificacao.
   */
  moverParaStatus(novoStatus: StatusEquipamento): void {
    validadorTransicaoStatus.validar({ novoStatus, triagemCompleta: this.triagemCompleta });
    this.status = novoStatus;
    this.tocar();
  }

  /**
   * Altera o estado fisico do equipamento, exigindo justificativa textual
   * quando a queda for de 2 ou mais categorias na escala de conservacao
   * (regra aplicada pelo ValidadorEstadoFisico).
   */
  alterarEstadoFisico(novoEstado: EstadoFisico, justificativa?: string): void {
    validadorEstadoFisico.validar({ estadoAnterior: this.estadoFisico, estadoNovo: novoEstado, justificativa });
    this.estadoFisico = novoEstado;
    this.tocar();
  }

  /** Atualiza o carimbo de ultima modificacao. Chamado internamente por todo metodo que muda o estado do equipamento. */
  protected tocar(): void {
    this.atualizadoEm = new Date().toISOString();
  }

  // spiderman

  /**
   * Serializacao explicita para persistencia (JSON.stringify chama este
   * metodo quando presente em um objeto). E NECESSARIA porque `tipo` e um
   * getter (fica no prototype da classe, para permitir polimorfismo em
   * tempo de execucao), e getters NAO sao incluidos automaticamente na
   * serializacao padrao do JSON.stringify (que so percorre propriedades
   * proprias enumeraveis da instancia, nao as do prototype). Sem este
   * metodo, o campo `tipo` seria perdido ao gravar em disco, impedindo a
   * EquipamentoFactory de reidratar a subclasse correta na proxima
   * leitura — foi exatamente esse bug que motivou a existencia deste
   * metodo durante o desenvolvimento do sistema.
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      criadoEm: this.criadoEm,
      loteId: this.loteId,
      codigoBarras: this.codigoBarras,
      estadoFisico: this.estadoFisico,
      status: this.status,
      triagemCompleta: this.triagemCompleta,
      atualizadoEm: this.atualizadoEm,
      tipo: this.tipo, // despacho polimorfico: cada subclasse retorna seu proprio valor aqui
    };
  }
}
