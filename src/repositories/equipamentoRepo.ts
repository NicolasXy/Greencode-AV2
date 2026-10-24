import * as crypto from "crypto";
import { ErroValidacao, EstadoFisico, StatusEquipamento } from "../types";
import { Equipamento } from "../models/Equipamento";
import { Movimentacao, TransicaoParcial } from "../models/Movimentacao";
import { EquipamentoFactory } from "../factories/EquipamentoFactory";
import { MovimentacaoFactory } from "../factories/MovimentacaoFactory";
import { RepositorioBase } from "./base";
import { LoteRepo } from "./loteRepo";

/**
 * Repositorio de equipamentos.
 *
 * Diferente dos demais repositorios, este NAO aplica regras de negocio
 * diretamente: ele delega toda a logica de transicao de estado para a
 * propria entidade `Equipamento` (equip.moverParaStatus,
 * equip.alterarEstadoFisico), que por sua vez usa os validadores
 * apropriados. O papel deste repositorio se resume a: localizar o
 * equipamento, pedir para ele proprio mudar de estado, e persistir o
 * resultado — um bom exemplo de separacao entre "persistencia" (aqui) e
 * "comportamento de dominio" (na entidade).
 */
export class EquipamentoRepo extends RepositorioBase<Equipamento> {
  /**
   * Cadastra um novo equipamento em um lote existente. A escolha de qual
   * subclasse concreta instanciar (Terminal, CPU, Monitor, Servidor...)
   * e feita pela EquipamentoFactory a partir do texto de `tipo` — este
   * repositorio nunca precisa saber quais subclasses existem.
   *
   * O codigo de barras e OPCIONAL: se o gestor de almoxarifado nao
   * informar um (equipamento sem etiqueta previa do fabricante, por
   * exemplo), o proprio sistema aloca um codigo de barras INTERNO unico
   * automaticamente — e exatamente a "alocacao de codigos de barras
   * internos" atribuida a este papel na especificacao do sistema. Quando
   * o equipamento ja possui um codigo (de fabrica ou de um sistema
   * externo), o operador pode informa-lo normalmente via --codigo.
   */
  cadastrar(loteId: string, codigoBarras: string | undefined, tipo: string, loteRepo: LoteRepo): Equipamento {
    const lote = loteRepo.buscarPorId(loteId);
    if (!lote) throw new ErroValidacao(`Lote ${loteId} nao encontrado.`);

    const lista = this.listarBruto();

    const codigoFinal = codigoBarras?.trim()
      ? codigoBarras.trim()
      : this.alocarCodigoBarrasInterno(lista);

    if (lista.some((e) => e.codigoBarras === codigoFinal)) {
      throw new ErroValidacao(`Ja existe equipamento com o codigo de barras ${codigoFinal}.`);
    }

    // Factory Method: a subclasse concreta e escolhida em tempo de
    // execucao a partir do texto informado em `tipo`.
    const equip = EquipamentoFactory.criar(tipo, loteId, codigoFinal);
    lista.push(equip);
    this.salvar(lista);
    return equip;
  }

  /**
   * Gera um codigo de barras interno unico, no formato INT-XXXXXX-YYYY
   * (prefixo fixo + timestamp em base 36 + sufixo aleatorio em hex),
   * verificando contra a lista atual para garantir que nao colida com
   * nenhum codigo ja existente (a colisao e praticamente impossivel dado
   * o espaco combinado de timestamp + aleatoriedade, mas o laco de
   * repeticao garante a unicidade de forma explicita em vez de assumir).
   */
  private alocarCodigoBarrasInterno(listaAtual: Equipamento[]): string {
    let codigo: string;
    do {
      const marcador = Date.now().toString(36).toUpperCase();
      const sufixo = crypto.randomBytes(2).toString("hex").toUpperCase();
      codigo = `INT-${marcador}-${sufixo}`;
    } while (listaAtual.some((e) => e.codigoBarras === codigo));
    return codigo;
  }

  /** Busca um equipamento pelo id, ja reidratado na subclasse polimorfica correta. */
  buscarPorId(id: string): Equipamento | undefined {
    const bruto = this.listarBruto().find((e) => e.id === id);
    return bruto ? EquipamentoFactory.reidratar(bruto) : undefined;
  }

  /** Lista os equipamentos de um lote especifico. */
  listarPorLote(loteId: string): Equipamento[] {
    return this.listarBruto()
      .filter((e) => e.loteId === loteId)
      .map(EquipamentoFactory.reidratar);
  }

  /** Lista todos os equipamentos cadastrados no sistema. */
  listar(): Equipamento[] {
    return this.listarBruto().map(EquipamentoFactory.reidratar);
  }

  /** Sobrescreve, no arquivo, o registro de um equipamento ja existente com sua versao atualizada. */
  private persistirAtualizacao(equip: Equipamento): void {
    const lista = this.listarBruto();
    const idx = lista.findIndex((e) => e.id === equip.id);
    if (idx === -1) throw new ErroValidacao(`Equipamento ${equip.id} nao encontrado.`);
    lista[idx] = equip;
    this.salvar(lista);
  }

  /** Marca a triagem do equipamento como completa (comportamento delegado a propria entidade). */
  concluirTriagem(id: string): Equipamento {
    const equip = this.exigir(id);
    equip.concluirTriagem();
    this.persistirAtualizacao(equip);
    return equip;
  }

  // spiderman

  /**
   * Move o equipamento para um novo status. A entidade e quem valida se a
   * transicao e permitida (ex.: exigir triagem completa antes de
   * "desmonte") — se a validacao falhar, `equip.moverParaStatus` lanca
   * ErroValidacao e nada e persistido nem registrado no historico.
   */
  moverStatus(
    id: string,
    novoStatus: StatusEquipamento,
    usuario: string,
    movRepo: MovimentacaoRepo
  ): Equipamento {
    const equip = this.exigir(id);
    const statusAnterior = equip.status;
    equip.moverParaStatus(novoStatus);
    this.persistirAtualizacao(equip);
    // So chega aqui se a mudanca foi aceita, entao o registro de
    // rastreabilidade so e criado quando algo de fato mudou.
    movRepo.registrar(equip.id, { status: statusAnterior }, { status: novoStatus }, usuario);
    return equip;
  }

  /**
   * Altera o estado fisico do equipamento. A exigencia de justificativa
   * para quedas de 2 ou mais categorias tambem mora na entidade, nao
   * neste repositorio.
   */
  alterarEstadoFisico(
    id: string,
    novoEstado: EstadoFisico,
    justificativa: string | undefined,
    usuario: string,
    movRepo: MovimentacaoRepo
  ): Equipamento {
    const equip = this.exigir(id);
    const estadoAnterior = equip.estadoFisico;
    equip.alterarEstadoFisico(novoEstado, justificativa);
    this.persistirAtualizacao(equip);
    movRepo.registrar(
      equip.id,
      { estadoFisico: estadoAnterior },
      { estadoFisico: novoEstado },
      usuario,
      justificativa
    );
    return equip;
  }

  /** Busca um equipamento pelo id ou lanca erro se nao existir — usado internamente para evitar repetir a checagem em cada metodo publico. */
  private exigir(id: string): Equipamento {
    const equip = this.buscarPorId(id);
    if (!equip) throw new ErroValidacao(`Equipamento ${id} nao encontrado.`);
    return equip;
  }
}

/**
 * Repositorio de movimentacoes (trilha de rastreabilidade). Cada
 * movimentacao e imutavel depois de criada: nao existe metodo de
 * atualizacao aqui, apenas registro (append) e consulta.
 */
export class MovimentacaoRepo extends RepositorioBase<Movimentacao> {
  /** Registra uma nova movimentacao, resultado de uma transicao ja aplicada a um equipamento. */
  registrar(
    equipamentoId: string,
    de: TransicaoParcial,
    para: TransicaoParcial,
    usuario: string,
    justificativa?: string
  ): Movimentacao {
    const mov = MovimentacaoFactory.registrar(equipamentoId, de, para, usuario, justificativa);
    const lista = this.listarBruto();
    lista.push(mov);
    this.salvar(lista);
    return mov;
  }

  /**
   * Retorna o historico completo de movimentacoes de um equipamento, em
   * ordem cronologica — e a base do comando "rastreio equipamento".
   */
  historicoDoEquipamento(equipamentoId: string): Movimentacao[] {
    return this.listarBruto()
      .filter((m) => m.equipamentoId === equipamentoId)
      .map(MovimentacaoFactory.reidratar)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp)); // strings ISO 8601 ordenam corretamente por comparacao lexicografica
  }
}
