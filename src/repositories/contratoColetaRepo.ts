import { ErroValidacao } from "../types";
import { ContratoColeta } from "../models/ContratoColeta";
import { ContratoColetaFactory } from "../factories/ContratoColetaFactory";
import { RepositorioBase } from "./base";
import { OrganizacaoRepo } from "./organizacaoRepo";

/**
 * Repositorio de contratos de coleta. Segue o mesmo padrao dos demais
 * repositorios: delega a construcao/validacao para a fabrica e cuida
 * apenas da persistencia e da checagem de que a organizacao referenciada
 * existe.
 */
export class ContratoColetaRepo extends RepositorioBase<ContratoColeta> {
  criar(
    orgCnpj: string,
    dataInicio: string,
    frequenciaColetaDias: number,
    condicoes: string | undefined,
    orgRepo: OrganizacaoRepo
  ): ContratoColeta {
    const org = orgRepo.buscarPorCnpj(orgCnpj);
    if (!org) {
      throw new ErroValidacao(`Organizacao com CNPJ ${orgCnpj} nao encontrada. Cadastre-a antes.`);
    }
    const contrato = ContratoColetaFactory.criar(org, dataInicio, frequenciaColetaDias, condicoes);
    const lista = this.listarBruto();
    lista.push(contrato);
    this.salvar(lista);
    return contrato;
  }

  buscarPorId(id: string): ContratoColeta | undefined {
    const bruto = this.listarBruto().find((c) => c.id === id);
    return bruto ? ContratoColetaFactory.reidratar(bruto) : undefined;
  }

  /** Lista os contratos de uma organizacao especifica (aceita CNPJ com ou sem mascara). */
  listarPorOrg(orgCnpj: string): ContratoColeta[] {
    const cnpj = orgCnpj.replace(/\D/g, "");
    return this.listarBruto()
      .filter((c) => c.orgCnpj === cnpj)
      .map(ContratoColetaFactory.reidratar);
  }

  listar(): ContratoColeta[] {
    return this.listarBruto().map(ContratoColetaFactory.reidratar);
  }

  /** Encerra um contrato existente (marca ativo=false, preservando o historico). */
  encerrar(id: string): ContratoColeta {
    const lista = this.listarBruto();
    const idx = lista.findIndex((c) => c.id === id);
    if (idx === -1) throw new ErroValidacao(`Contrato ${id} nao encontrado.`);
    const contrato = ContratoColetaFactory.reidratar(lista[idx]);
    contrato.encerrar();
    lista[idx] = contrato;
    this.salvar(lista);
    return contrato;
  }
}

// spiderman
