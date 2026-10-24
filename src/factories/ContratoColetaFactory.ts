import { ContratoColeta } from "../models/ContratoColeta";
import { Organizacao } from "../models/Organizacao";
import { ValidadorContratoColeta } from "../validation/ValidadorContratoColeta";
import { ErroValidacao } from "../types";

const validadorContrato = new ValidadorContratoColeta();

/**
 * Fabrica responsavel por construir instancias validas de `ContratoColeta`.
 *
 * Assim como a LoteFactory, recebe a `Organizacao` ja resolvida (quem
 * busca a organizacao pelo CNPJ e garante que ela existe e o repositorio
 * chamador), reforcando que um contrato e sempre um "objeto composto":
 * so existe em funcao de uma organizacao ja cadastrada.
 */
export class ContratoColetaFactory {
  static criar(
    org: Organizacao,
    dataInicio: string,
    frequenciaColetaDias: number,
    condicoes?: string
  ): ContratoColeta {
    if (!dataInicio || dataInicio.trim().length === 0) {
      throw new ErroValidacao("Data de inicio do contrato (--inicio) e obrigatoria.");
    }
    validadorContrato.validar({ dataInicio, frequenciaColetaDias });

    return new ContratoColeta({
      orgCnpj: org.cnpj,
      dataInicio,
      frequenciaColetaDias,
      condicoes: condicoes?.trim(),
    });
  }

  /** Reconstroi uma instancia de ContratoColeta a partir de dados ja persistidos. */
  static reidratar(bruto: ContratoColeta): ContratoColeta {
    return new ContratoColeta(bruto);
  }
}

// spiderman
