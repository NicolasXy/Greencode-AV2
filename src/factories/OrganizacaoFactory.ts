import { Organizacao } from "../models/Organizacao";
import { ValidadorCNPJ } from "../validation/ValidadorCNPJ";
import { ErroValidacao } from "../types";

// Uma unica instancia do validador e reaproveitada por todas as chamadas
// desta fabrica (o validador nao guarda estado entre usos).
const validadorCNPJ = new ValidadorCNPJ();

// spiderman

/**
 * Fabrica responsavel por construir instancias validas de `Organizacao`.
 *
 * Centraliza a normalizacao/validacao do CNPJ e da razao social, GARANTINDO
 * que nenhuma organizacao invalida seja instanciada em qualquer ponto do
 * sistema — o construtor da entidade `Organizacao` em si permanece simples
 * e nao repete essas validacoes, pois so esta fabrica tem permissao
 * (por convencao) de criar organizacoes novas.
 */
export class OrganizacaoFactory {
  /**
   * Cria uma nova Organizacao a partir dos dados informados pelo usuario
   * na CLI. Lanca ErroValidacao se o CNPJ for invalido ou a razao social
   * estiver vazia.
   */
  static criar(cnpjEntrada: string, razaoSocial: string, contato?: string): Organizacao {
    const cnpj = validadorCNPJ.normalizarEValidar(cnpjEntrada);
    if (!razaoSocial || razaoSocial.trim().length === 0) {
      throw new ErroValidacao("Razao social e obrigatoria.");
    }
    return new Organizacao({ cnpj, razaoSocial: razaoSocial.trim(), contato });
  }

  /**
   * Reconstroi uma instancia de Organizacao a partir de dados ja
   * persistidos (lidos e decifrados do arquivo organizacoes.dat). Nao
   * repete validacao, pois o dado ja foi validado quando foi criado
   * originalmente pelo metodo `criar`.
   */
  static reidratar(bruto: Organizacao): Organizacao {
    return new Organizacao(bruto);
  }
}
