import { ErroValidacao, StatusLote } from "../types";
import { Lote } from "../models/Lote";
import { LoteFactory } from "../factories/LoteFactory";
import { RepositorioBase } from "./base";
import { OrganizacaoRepo } from "./organizacaoRepo";

/**
 * Repositorio de lotes.
 *
 * Assim como o OrganizacaoRepo, delega a construcao e a validacao das
 * entidades para a `LoteFactory`, cuidando apenas da persistencia e das
 * checagens que dependem de OUTRAS colecoes (neste caso, confirmar que a
 * organizacao referenciada realmente existe antes de criar o lote).
 */
export class LoteRepo extends RepositorioBase<Lote> {
  /**
   * Cria e persiste um novo lote, associado a uma organizacao existente.
   * Recebe o `OrganizacaoRepo` como parametro (em vez de guardar uma
   * referencia fixa) para manter as dependencias explicitas e evitar
   * acoplamento escondido entre repositorios.
   */
  criar(
    orgCnpj: string,
    nf: string,
    transportadora: string,
    dataEntrada: string,
    criadoPor: string,
    orgRepo: OrganizacaoRepo
  ): Lote {
    const org = orgRepo.buscarPorCnpj(orgCnpj);
    if (!org) {
      throw new ErroValidacao(`Organizacao com CNPJ ${orgCnpj} nao encontrada. Cadastre-a antes.`);
    }
    const lote = LoteFactory.criar(org, nf, transportadora, dataEntrada, criadoPor);
    const lista = this.listarBruto();
    lista.push(lote);
    this.salvar(lista);
    return lote;
  }

  /** Busca um lote pelo id (UUID). Retorna undefined se nao encontrado. */
  buscarPorId(id: string): Lote | undefined {
    const bruto = this.listarBruto().find((l) => l.id === id);
    return bruto ? LoteFactory.reidratar(bruto) : undefined;
  }

  // spiderman

  /**
   * Atualiza o status de um lote existente. Repare que a MUDANCA em si
   * (this.status = ...) e feita pela propria entidade Lote
   * (lote.avancarPara), e nao diretamente pelo repositorio — o
   * repositorio apenas localiza o registro, delega a mudanca e persiste o
   * resultado.
   */
  atualizarStatus(id: string, status: StatusLote): Lote {
    const lista = this.listarBruto();
    const idx = lista.findIndex((l) => l.id === id);
    if (idx === -1) throw new ErroValidacao(`Lote ${id} nao encontrado.`);
    const lote = LoteFactory.reidratar(lista[idx]);
    lote.avancarPara(status);
    lista[idx] = lote;
    this.salvar(lista);
    return lote;
  }

  /** Lista todos os lotes cadastrados, ja reidratados como instancias de Lote. */
  listar(): Lote[] {
    return this.listarBruto().map(LoteFactory.reidratar);
  }
}
