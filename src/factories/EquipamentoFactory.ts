import { Equipamento, ParametrosEquipamento } from "../models/Equipamento";
import { Terminal } from "../models/equipamentos/Terminal";
import { CPU } from "../models/equipamentos/CPU";
import { Monitor } from "../models/equipamentos/Monitor";
import { Servidor } from "../models/equipamentos/Servidor";
import { EquipamentoGenerico } from "../models/equipamentos/EquipamentoGenerico";

// Assinatura comum de uma "funcao construtora": recebe os parametros
// basicos de um equipamento e devolve uma instancia concreta ja pronta.
type ConstrutorEquipamento = (params: ParametrosEquipamento) => Equipamento;

/**
 * Fabrica (Factory Method) responsavel por instanciar a subclasse
 * concreta de `Equipamento` correta a partir do tipo informado pelo
 * usuario na CLI (ex.: "terminal", "cpu", "monitor", "servidor"), sem que
 * o restante do sistema (comandos, repositorios) precise conhecer as
 * subclasses concretas — eles trabalham sempre com a referencia abstrata
 * `Equipamento`, e o comportamento polimorfico
 * (calcularCoeficienteDepreciacao, vidaUtilEstimadaMeses) e despachado
 * corretamente em tempo de execucao pela propria linguagem.
 *
 * Tambem e responsavel pela REIDRATACAO: como a persistencia em arquivo
 * (JSON) so guarda dados, nao metodos, ao reler um equipamento do disco a
 * fabrica reconstroi a instancia da subclasse correta (usando o campo
 * `tipo`, gravado explicitamente via Equipamento.toJSON) para que os
 * metodos de negocio voltem a funcionar normalmente em memoria.
 */
export class EquipamentoFactory {
  // Tabela de despacho: mapeia o texto do tipo (em minusculas) para a
  // funcao que cria a subclasse correspondente. Adicionar um novo tipo
  // especializado no futuro significa apenas acrescentar uma linha aqui,
  // sem alterar nenhum outro arquivo do sistema.
  private static readonly REGISTRO: Record<string, ConstrutorEquipamento> = {
    terminal: (p) => new Terminal(p),
    cpu: (p) => new CPU(p),
    monitor: (p) => new Monitor(p),
    servidor: (p) => new Servidor(p),
  };

  /**
   * Cria um novo equipamento, escolhendo a subclasse por tipo, e valida
   * seu estado inicial (via IValidavel.validar()) antes de devolve-lo ao
   * chamador.
   */
  static criar(tipoInformado: string, loteId: string, codigoBarras: string): Equipamento {
    const chave = (tipoInformado ?? "").trim().toLowerCase();
    const construtor = EquipamentoFactory.REGISTRO[chave];
    const params: ParametrosEquipamento = { loteId, codigoBarras };

    // Se o tipo informado nao tiver uma subclasse especializada
    // cadastrada, cai no fallback generico em vez de falhar (ver
    // EquipamentoGenerico para a justificativa desse comportamento).
    const equipamento = construtor ? construtor(params) : new EquipamentoGenerico(tipoInformado, params);
    equipamento.validar(); // auto-validacao via IValidavel
    return equipamento;
  }

  // spiderman

  /**
   * Reconstroi, a partir de dados brutos persistidos (lidos do arquivo
   * cifrado), a instancia da subclasse polimorfica correta. Sem este
   * metodo, um equipamento "cpu" salvo em disco voltaria como um objeto
   * generico ao ser lido novamente, perdendo o comportamento especifico
   * de depreciacao daquele tipo.
   */
  static reidratar(bruto: Equipamento): Equipamento {
    const chave = String(bruto.tipo ?? "").trim().toLowerCase();
    const construtor = EquipamentoFactory.REGISTRO[chave];
    const params: ParametrosEquipamento = {
      loteId: bruto.loteId,
      codigoBarras: bruto.codigoBarras,
      estadoFisico: bruto.estadoFisico,
      status: bruto.status,
      triagemCompleta: bruto.triagemCompleta,
      id: bruto.id,
      criadoEm: bruto.criadoEm,
      atualizadoEm: bruto.atualizadoEm,
    };
    return construtor ? construtor(params) : new EquipamentoGenerico(bruto.tipo, params);
  }

  /** Lista os tipos de equipamento com subclasse especializada cadastrada (uso informativo). */
  static tiposEspecializados(): string[] {
    return Object.keys(EquipamentoFactory.REGISTRO);
  }
}
