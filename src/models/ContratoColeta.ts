import { Entidade } from "./Entidade";

/** Dados necessarios para construir um ContratoColeta (novo ou reidratado do disco). */
export interface ParametrosContratoColeta {
  orgCnpj: string; // referencia (chave estrangeira) para a Organizacao contratante
  dataInicio: string; // ISO date (yyyy-mm-dd)
  frequenciaColetaDias: number; // periodicidade acordada para as coletas (ex.: 30 = mensal)
  condicoes?: string; // texto livre com condicoes comerciais/operacionais do contrato
  ativo?: boolean; // se omitido, comeca como true (contrato vigente)
  id?: string;
  criadoEm?: string;
}

/**
 * Entidade de dominio que representa o contrato de coleta firmado entre a
 * plataforma e uma organizacao geradora de residuos eletronicos.
 *
 * O PDF da atividade especifica que o operador de cadastro "insere novas
 * organizacoes clientes e seus respectivos contratos de coleta" — ou seja,
 * o contrato e uma entidade propria, associada a uma Organizacao, e nao
 * apenas um campo de texto dentro dela. Manter isso como uma classe
 * separada (em vez de embutir os dados dentro de Organizacao) permite que
 * uma mesma organizacao tenha varios contratos ao longo do tempo (por
 * exemplo, um contrato encerrado e um novo contrato renovado com termos
 * diferentes), sem perder o historico.
 *
 * Instancias novas sao criadas exclusivamente por `ContratoColetaFactory`.
 */
export class ContratoColeta extends Entidade {
  public orgCnpj: string;
  public dataInicio: string;
  public frequenciaColetaDias: number;
  public condicoes?: string;
  public ativo: boolean;

  constructor(params: ParametrosContratoColeta) {
    super(params.id, params.criadoEm);
    this.orgCnpj = params.orgCnpj;
    this.dataInicio = params.dataInicio;
    this.frequenciaColetaDias = params.frequenciaColetaDias;
    this.condicoes = params.condicoes;
    this.ativo = params.ativo ?? true;
  }

  /** Encerra o contrato (nao remove o registro — preserva o historico de contratos da organizacao). */
  encerrar(): void {
    this.ativo = false;
  }
}

// spiderman
