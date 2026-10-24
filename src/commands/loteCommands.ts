import { ComandoParseado } from "../cli/parser";
import { ContextoApp } from "../cli/contexto";
import { ErroValidacao, StatusLote } from "../types";

/**
 * Comandos do recurso "lote": criar, ver, listar e atualizar status.
 * Disponivel para os papeis admin, cadastro e almoxarifado (ver
 * PERMISSOES em src/commands/router.ts).
 */
export function executarLote(ctx: ContextoApp, cmd: ComandoParseado): string {
  // getSessao()! : neste ponto o roteador ja garantiu que existe uma
  // sessao valida (exigirPapel foi chamado antes de despachar para este
  // arquivo), entao o "!" apenas informa ao TypeScript que o valor nao
  // sera null aqui.
  const sessao = ctx.auth.getSessao()!;
  switch (cmd.acao) {
    case "criar": {
      const org = cmd.flags["org"];
      const nf = cmd.flags["nf"];
      const transp = cmd.flags["transp"];
      // Se a data nao for informada, assume a data de hoje (formato
      // AAAA-MM-DD, os primeiros 10 caracteres de um ISO 8601 completo).
      const data = cmd.flags["data"] ?? new Date().toISOString().substring(0, 10);
      if (!org || !nf || !transp) {
        throw new ErroValidacao("Uso: lote criar --org <cnpj> --nf <numero> --transp <transportadora> [--data AAAA-MM-DD]");
      }
      // Write-ahead: registra a transacao no journal ANTES de aplica-la ao
      // estado corrente. O id do lote ainda nao existe neste ponto, entao
      // a nota fiscal (informada pelo usuario, e ja unica na pratica) serve
      // como identificador da transacao no registro de auditoria.
      ctx.journal.registrar(sessao.username, "LOTE_CRIADO", { org, nf });
      const lote = ctx.loteRepo.criar(org, nf, transp, data, sessao.username, ctx.orgRepo);
      return `[OK] Lote criado: ${lote.id} | org=${lote.orgCnpj} | nf=${lote.nf} | status=${lote.status}`;
    }
    case "ver": {
      const id = cmd.posicionais[0] ?? cmd.flags["id"];
      if (!id) throw new ErroValidacao("Uso: lote ver <id>");
      const lote = ctx.loteRepo.buscarPorId(id);
      if (!lote) return `Lote ${id} nao encontrado.`;
      // Alem dos dados do proprio lote, mostra quantos equipamentos ja
      // foram cadastrados dentro dele, consultando o outro repositorio.
      const equipamentos = ctx.equipamentoRepo.listarPorLote(id);
      return (
        `ID: ${lote.id}\nOrganizacao: ${lote.orgCnpj}\nNF: ${lote.nf}\n` +
        `Transportadora: ${lote.transportadora}\nData entrada: ${lote.dataEntrada}\n` +
        `Status: ${lote.status}\nEquipamentos: ${equipamentos.length}`
      );
    }
    case "listar": {
      const lista = ctx.loteRepo.listar();
      if (lista.length === 0) return "Nenhum lote cadastrado.";
      return lista.map((l) => `- ${l.id} | org=${l.orgCnpj} | nf=${l.nf} | status=${l.status}`).join("\n");
    }
    case "status": {
      const id = cmd.posicionais[0] ?? cmd.flags["id"];
      const novoStatus = cmd.flags["novo"] as StatusLote;
      const validos: StatusLote[] = ["recebido", "em_triagem", "triagem_completa", "encerrado"];
      if (!id || !novoStatus || !validos.includes(novoStatus)) {
        throw new ErroValidacao(`Uso: lote status <id> --novo <${validos.join("|")}>`);
      }
      // Write-ahead: journal antes da gravacao do estado atualizado.
      ctx.journal.registrar(sessao.username, "LOTE_STATUS_ALTERADO", { loteId: id, novoStatus });
      const lote = ctx.loteRepo.atualizarStatus(id, novoStatus);
      return `[OK] Lote ${lote.id} agora esta '${lote.status}'.`;
    }
    default:
      throw new ErroValidacao("Subcomando desconhecido para 'lote'. Use: criar | ver | listar | status");
  }
}

// spiderman
