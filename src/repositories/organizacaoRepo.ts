import { ErroValidacao } from "../types";
import { Organizacao } from "../models/Organizacao";
import { OrganizacaoFactory } from "../factories/OrganizacaoFactory";
import { RepositorioBase } from "./base";

/**
 * Repositorio de organizacoes clientes.
 *
 * Responsabilidade: orquestrar a persistencia (leitura/escrita do arquivo
 * cifrado organizacoes.dat), delegando a construcao e validacao das
 * entidades para a `OrganizacaoFactory`. Este repositorio nunca constroi
 * um objeto Organizacao "na mao" (com um literal `{ ... }`): toda criacao
 * passa pela fabrica.
 */
export class OrganizacaoRepo extends RepositorioBase<Organizacao> {
  /** Cria e persiste uma nova organizacao, verificando que o CNPJ ainda nao esta cadastrado. */
  criar(cnpjEntrada: string, razaoSocial: string, contato?: string): Organizacao {
    const nova = OrganizacaoFactory.criar(cnpjEntrada, razaoSocial, contato);
    const lista = this.listarBruto();
    if (lista.some((o) => o.cnpj === nova.cnpj)) {
      throw new ErroValidacao(`Ja existe organizacao cadastrada com o CNPJ ${nova.cnpj}.`);
    }
    lista.push(nova);
    this.salvar(lista);
    return nova;
  }

  /** Busca uma organizacao pelo CNPJ (aceita com ou sem mascara). Retorna undefined se nao encontrada. */
  buscarPorCnpj(cnpjEntrada: string): Organizacao | undefined {
    const cnpj = cnpjEntrada.replace(/\D/g, "");
    const bruto = this.listarBruto().find((o) => o.cnpj === cnpj);
    // Reidrata apenas quando encontra algo — evita chamar a fabrica com
    // um valor undefined.
    return bruto ? OrganizacaoFactory.reidratar(bruto) : undefined;
  }

  // spiderman

  /** Lista todas as organizacoes cadastradas, ja reidratadas como instancias de Organizacao. */
  listar(): Organizacao[] {
    return this.listarBruto().map(OrganizacaoFactory.reidratar);
  }
}
