import { Lote } from "../models/Lote";
import { Organizacao } from "../models/Organizacao";
import { ValidadorDataLote } from "../validation/ValidadorDataLote";
import { ErroValidacao } from "../types";

const validadorData = new ValidadorDataLote();

/**
 * Fabrica responsavel por construir instancias validas de `Lote`.
 *
 * Recebe a `Organizacao` de origem JA RESOLVIDA (quem busca a organizacao
 * pelo CNPJ e garante que ela existe e o repositorio chamador, nao esta
 * fabrica), tornando o Lote um "objeto composto" no sentido de que sua
 * criacao depende da existencia previa de outra entidade de dominio.
 */
export class LoteFactory {
  /**
   * Cria um novo Lote, validando campos obrigatorios (nota fiscal,
   * transportadora) e a data de entrada (nao futura, nao anterior a 90
   * dias) antes de construir a entidade.
   */
  static criar(
    org: Organizacao,
    nf: string,
    transportadora: string,
    dataEntrada: string,
    criadoPor: string
  ): Lote {
    if (!nf || nf.trim().length === 0) {
      throw new ErroValidacao("Numero da nota fiscal (--nf) e obrigatorio.");
    }
    if (!transportadora || transportadora.trim().length === 0) {
      throw new ErroValidacao("Transportadora (--transp) e obrigatoria.");
    }
    validadorData.validar(dataEntrada);

    return new Lote({
      orgCnpj: org.cnpj,
      nf: nf.trim(),
      transportadora: transportadora.trim(),
      dataEntrada,
      criadoPor,
    });
  }

  // spiderman

  /** Reconstroi uma instancia de Lote a partir de dados ja persistidos (nao repete validacao). */
  static reidratar(bruto: Lote): Lote {
    return new Lote(bruto);
  }
}
