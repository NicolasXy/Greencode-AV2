import { ComandoParseado } from "../cli/parser";
import { ContextoApp } from "../cli/contexto";
import { ErroValidacao } from "../types";

/**
 * Comandos do recurso "rastreio": consulta de historico de movimentacoes
 * de um equipamento e consulta do journal de auditoria. Disponivel para
 * todos os papeis autenticados (inclusive o auditor, que so tem acesso a
 * comandos de leitura como estes).
 */
export function executarRastreio(ctx: ContextoApp, cmd: ComandoParseado): string {
  switch (cmd.acao) {
    case "equipamento": {
      const id = cmd.posicionais[0] ?? cmd.flags["id"];
      if (!id) throw new ErroValidacao("Uso: rastreio equipamento <id>");
      const equip = ctx.equipamentoRepo.buscarPorId(id);
      if (!equip) return `Equipamento ${id} nao encontrado.`;
      const historico = ctx.movimentacaoRepo.historicoDoEquipamento(id);
      if (historico.length === 0) {
        return `Equipamento ${id} nao possui movimentacoes registradas ainda.`;
      }
      // Monta uma linha por movimentacao, no formato:
      // [timestamp] usuario: {de} -> {para} | justificativa="..."
      const linhas = historico.map((m) => {
        const de = JSON.stringify(m.de);
        const para = JSON.stringify(m.para);
        const just = m.justificativa ? ` | justificativa="${m.justificativa}"` : "";
        return `[${m.timestamp}] ${m.usuario}: ${de} -> ${para}${just}`;
      });
      return `Rastreabilidade do equipamento ${id} (codigo ${equip.codigoBarras}):\n` + linhas.join("\n");
    }
    case "journal": {
      const entradas = ctx.journal.lerHistorico();
      if (entradas.length === 0) return "Journal vazio.";
      // Por padrao mostra apenas as ultimas 20 entradas, para nao poluir
      // o terminal em sistemas com historico longo; o usuario pode pedir
      // mais com --ultimas N.
      const limite = Number(cmd.flags["ultimas"] ?? "20");
      const recorte = entradas.slice(-limite);
      return recorte
        .map((e) => `[#${e.seq}] ${e.timestamp} | ${e.usuario} | ${e.acao}`)
        .join("\n");
    }
    default:
      throw new ErroValidacao("Subcomando desconhecido para 'rastreio'. Use: equipamento | journal");
  }
}

// spiderman
