// spiderman
import { Repositorios } from "../db/unidadeDeTrabalho";
import { StatusEquipamento, StatusLote } from "../generated/prisma/enums";
import { Ator } from "./tipos";

/** Destinos finais de um equipamento: quando todos chegam a um deles, o lote esta concluido. */
const DESTINOS_FINAIS: StatusEquipamento[] = ["reciclagem", "descarte_seguro", "revenda"];

/**
 * Regra do cliente: o status do lote e DERIVADO dos equipamentos e so muda
 * quando TODOS os equipamentos tiverem o mesmo status (um unico equipamento
 * em triagem nao move o lote).
 *
 *   todos aguardando_triagem  -> recebido
 *   todos em_triagem          -> em_triagem
 *   todos triado              -> triagem_completa
 *   todos em destino final    -> encerrado   (reciclagem, descarte_seguro ou revenda;
 *                                             pode ser uma mistura, pois um lote real
 *                                             tem destinos diferentes por equipamento)
 *   qualquer outra combinacao -> sem mudanca (retorna null)
 *
 * Funcao pura: facil de testar e sem acesso a banco.
 */
export function derivarStatusLote(statuses: StatusEquipamento[]): StatusLote | null {
  if (statuses.length === 0) return null;
  if (statuses.every((s) => s === "aguardando_triagem")) return "recebido";
  if (statuses.every((s) => s === "em_triagem")) return "em_triagem";
  if (statuses.every((s) => s === "triado")) return "triagem_completa";
  if (statuses.every((s) => DESTINOS_FINAIS.includes(s))) return "encerrado";
  return null;
}

/**
 * Recalcula e persiste o status do lote dentro da transacao em curso.
 * Pressupoe que o lote ja foi travado (LoteRepository.bloquear), o que
 * garante que duas transicoes simultaneas de equipamentos do mesmo lote
 * nao calculem o status sobre dados desatualizados.
 */
export async function sincronizarStatusLote(r: Repositorios, ator: Ator, loteId: string): Promise<void> {
  const lote = await r.lotes.buscarPorId(loteId);
  if (!lote) return;
  const novo = derivarStatusLote(await r.equipamentos.statusDoLote(loteId));
  if (!novo || novo === lote.status) return;
  await r.lotes.atualizarStatusComVersao(loteId, lote.versao, novo);
  await r.auditoria.registrar(ator.id, "LOTE_STATUS_ATUALIZADO", { loteId, de: lote.status, para: novo, origem: "derivado-dos-equipamentos" });
}
