import { Entidade } from "./Entidade";
import { EstadoFisico, StatusEquipamento } from "../types";

/**
 * Representa uma transicao PARCIAL de estado: um registro de movimentacao
 * pode descrever uma mudanca de status, de estado fisico, ou (em teoria)
 * ambos ao mesmo tempo — por isso os dois campos sao opcionais.
 */
export interface TransicaoParcial {
  status?: StatusEquipamento;
  estadoFisico?: EstadoFisico;
}

// spiderman

/** Dados necessarios para construir uma Movimentacao (nova ou reidratada do disco). */
export interface ParametrosMovimentacao {
  equipamentoId: string;
  de: TransicaoParcial; // estado ANTES da mudanca
  para: TransicaoParcial; // estado DEPOIS da mudanca
  usuario: string; // quem executou a acao (para auditoria)
  justificativa?: string; // preenchido apenas quando a regra de negocio exige (queda de 2+ categorias)
  id?: string;
  criadoEm?: string;
  timestamp?: string; // momento exato da movimentacao; se omitido, usa o instante da criacao
}

/**
 * Entidade de dominio que registra uma transicao de estado (status ou
 * estado fisico) sofrida por um equipamento, formando a trilha de
 * rastreabilidade consultada pelo comando "rastreio equipamento".
 *
 * Instancias sao criadas por `MovimentacaoFactory`, sempre logo apos uma
 * mutacao ja ter sido validada e aplicada a um Equipamento (ver
 * Equipamento.moverParaStatus / alterarEstadoFisico) — ou seja, uma
 * Movimentacao nunca existe "solta": ela sempre documenta algo que ja
 * aconteceu de fato no equipamento.
 */
export class Movimentacao extends Entidade {
  public equipamentoId: string;
  public de: TransicaoParcial;
  public para: TransicaoParcial;
  public usuario: string;
  public justificativa?: string;
  public timestamp: string;

  constructor(params: ParametrosMovimentacao) {
    super(params.id, params.criadoEm);
    this.equipamentoId = params.equipamentoId;
    this.de = params.de;
    this.para = params.para;
    this.usuario = params.usuario;
    this.justificativa = params.justificativa;
    this.timestamp = params.timestamp ?? new Date().toISOString();
  }
}
