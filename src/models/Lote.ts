import { Entidade } from "./Entidade";
import { StatusLote } from "../types";

/** Dados necessarios para construir um Lote (novo ou reidratado do disco). */
export interface ParametrosLote {
  orgCnpj: string; // referencia (chave estrangeira) para a Organizacao dona do lote
  nf: string;
  transportadora: string;
  dataEntrada: string; // ISO date (yyyy-mm-dd)
  criadoPor: string; // username de quem criou o lote (para auditoria)
  status?: StatusLote; // opcional: se omitido, comeca como "recebido"
  id?: string;
  criadoEm?: string;
}

/**
 * Entidade de dominio que representa um lote de equipamentos recebido de
 * uma organizacao geradora.
 *
 * E um "objeto composto" no sentido conceitual de que sua criacao depende
 * da existencia previa de outra entidade (a Organizacao referenciada por
 * `orgCnpj`), e ao longo do seu ciclo de vida agrega os equipamentos
 * triados a partir dele. Os equipamentos, porem, NAO ficam embutidos
 * diretamente dentro do objeto Lote em memoria: eles sao mantidos em um
 * repositorio proprio, relacionados pelo campo `loteId`, ja que um lote
 * pode conter um numero grande de equipamentos e no seria eficiente
 * reescrever a lista inteira de um lote so para adicionar um item.
 *
 * Instancias novas sao criadas exclusivamente por `LoteFactory`, que
 * valida a existencia da organizacao e a data de entrada antes da
 * construcao.
 */
export class Lote extends Entidade {
  public orgCnpj: string;
  public nf: string;
  public transportadora: string;
  public dataEntrada: string;
  public status: StatusLote;
  public criadoPor: string;

  constructor(params: ParametrosLote) {
    super(params.id, params.criadoEm);
    this.orgCnpj = params.orgCnpj;
    this.nf = params.nf;
    this.transportadora = params.transportadora;
    this.dataEntrada = params.dataEntrada;
    this.criadoPor = params.criadoPor;
    this.status = params.status ?? "recebido"; // todo lote novo comeca no inicio do ciclo de vida
  }

  /**
   * Avanca o lote para um novo status do seu ciclo de vida. E um
   * comportamento da propria entidade (nao apenas uma atribuicao externa
   * de campo), o que deixa espaco para, no futuro, adicionar aqui regras
   * de transicao especificas (ex.: impedir pular etapas) sem precisar
   * alterar o repositorio que a chama.
   */
  avancarPara(novoStatus: StatusLote): void {
    this.status = novoStatus;
  }
}

// spiderman
