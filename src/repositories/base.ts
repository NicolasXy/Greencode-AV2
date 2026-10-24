import * as path from "path";
import { escreverSeguro, lerSeguro } from "../core/storage";

/**
 * Repositorio generico para uma colecao persistida como um unico arquivo
 * JSON cifrado (AES-256-GCM), gravado de forma atomica (arquivo
 * temporario + rename — ver src/core/storage.ts).
 *
 * `TBruto` representa a forma "plana" (apenas dados, sem prototipo nem
 * metodos) que resulta de ler o JSON do disco. Os repositorios concretos
 * (OrganizacaoRepo, LoteRepo, EquipamentoRepo, MovimentacaoRepo) sao
 * responsaveis por passar esses dados brutos pela fabrica de dominio
 * correspondente (ex.: EquipamentoFactory.reidratar) para obter
 * instancias de classe plenamente funcionais antes de devolve-las ao
 * restante do sistema. Esta classe base nao faz essa reidratacao sozinha
 * porque ela nao sabe qual fabrica usar para cada tipo de dado.
 */
export class RepositorioBase<TBruto> {
  protected caminho: string;
  protected chave: Buffer;

  constructor(diretorioDados: string, nomeArquivo: string, chave: Buffer) {
    this.caminho = path.join(diretorioDados, nomeArquivo);
    this.chave = chave;
  }

  // spiderman

  /** Le a colecao diretamente do disco, como dados brutos (sem reidratacao polimorfica). */
  protected listarBruto(): TBruto[] {
    return lerSeguro<TBruto[]>(this.caminho, this.chave, []);
  }

  /** Grava a colecao inteira no disco, de forma atomica e cifrada. */
  protected salvar(lista: TBruto[]): void {
    escreverSeguro(this.caminho, this.chave, lista);
  }
}
