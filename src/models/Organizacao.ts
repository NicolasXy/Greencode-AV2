import { Entidade } from "./Entidade";

/** Dados necessarios para construir uma Organizacao (nova ou reidratada do disco). */
export interface ParametrosOrganizacao {
  cnpj: string; // ja normalizado (14 digitos) — responsabilidade da OrganizacaoFactory, nao desta classe
  razaoSocial: string;
  contato?: string;
  id?: string; // presente apenas na reidratacao (entidade ja existente)
  criadoEm?: string; // idem
}

/**
 * Entidade de dominio que representa uma organizacao geradora de residuos
 * eletronicos (rede de lojas, hospital, universidade etc.), cliente da
 * plataforma de logistica reversa.
 *
 * Esta classe e deliberadamente "burra": ela nao valida CNPJ nem verifica
 * duplicidade — essas responsabilidades pertencem a `OrganizacaoFactory`,
 * que e o UNICO ponto do sistema autorizado a criar instancias novas de
 * Organizacao. Isso mantem a classe simples e centraliza as regras de
 * criacao em um lugar so (padrao Factory).
 */
export class Organizacao extends Entidade {
  public cnpj: string;
  public razaoSocial: string;
  public contato?: string;

  constructor(params: ParametrosOrganizacao) {
    super(params.id, params.criadoEm);
    this.cnpj = params.cnpj;
    this.razaoSocial = params.razaoSocial;
    this.contato = params.contato;
  }
}

// spiderman
