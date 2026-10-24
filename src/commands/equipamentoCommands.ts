import { ComandoParseado } from "../cli/parser";
import { ContextoApp } from "../cli/contexto";
import { ErroValidacao, StatusEquipamento } from "../types";
import { validarEstadoFisico } from "../core/validators";

// Lista de status possiveis, usada tanto para validar a entrada do
// usuario quanto para compor a mensagem de uso quando o comando falha.
const STATUS_VALIDOS: StatusEquipamento[] = [
  "aguardando_triagem",
  "em_triagem",
  "triado",
  "desmonte",
  "reciclagem",
  "descarte_seguro",
  "revenda",
];

/**
 * Comandos do recurso "equipamento": cadastro, triagem, movimentacao de
 * status e de estado fisico, consulta e calculo de depreciacao.
 * Disponivel para os papeis admin e almoxarifado.
 */
export function executarEquipamento(ctx: ContextoApp, cmd: ComandoParseado): string {
  const sessao = ctx.auth.getSessao()!;
  switch (cmd.acao) {
    case "cadastrar": {
      const loteId = cmd.flags["lote"];
      const codigo = cmd.flags["codigo"]; // opcional: se omitido, o sistema aloca um codigo interno automaticamente
      const tipo = cmd.flags["tipo"];
      if (!loteId || !tipo) {
        throw new ErroValidacao("Uso: equipamento cadastrar --lote <id> [--codigo <codigo_barras>] --tipo <tipo>");
      }
      // Write-ahead: registra a transacao no journal ANTES de aplica-la ao
      // estado corrente. O id do equipamento (e o codigo de barras, quando
      // alocado automaticamente) ainda nao existem neste ponto, entao o
      // registro usa os dados de entrada disponiveis (lote e tipo).
      ctx.journal.registrar(sessao.username, "EQUIPAMENTO_CADASTRADO", { loteId, tipo, codigoInformado: codigo ?? null });
      // A escolha da subclasse concreta (Terminal, CPU, Monitor,
      // Servidor, ou o fallback generico) acontece dentro do repositorio,
      // via EquipamentoFactory — este comando so repassa o texto do tipo.
      // Quando --codigo nao e informado, o repositorio aloca um codigo de
      // barras interno unico (ver EquipamentoRepo.alocarCodigoBarrasInterno).
      const equip = ctx.equipamentoRepo.cadastrar(loteId, codigo, tipo, ctx.loteRepo);
      return `[OK] Equipamento cadastrado: ${equip.id} | codigo=${equip.codigoBarras} | tipo=${equip.tipo}`;
    }
    case "triagem": {
      const id = cmd.posicionais[0] ?? cmd.flags["id"];
      if (!id) throw new ErroValidacao("Uso: equipamento triagem <id>");
      // Write-ahead: journal antes da gravacao do estado atualizado.
      ctx.journal.registrar(sessao.username, "EQUIPAMENTO_TRIAGEM_COMPLETA", { equipamentoId: id });
      const equip = ctx.equipamentoRepo.concluirTriagem(id);
      return `[OK] Triagem concluida para ${equip.id}. Status atual: ${equip.status}.`;
    }
    case "mover": {
      const id = cmd.posicionais[0] ?? cmd.flags["id"];
      const novoStatus = cmd.flags["status"] as StatusEquipamento;
      if (!id || !novoStatus || !STATUS_VALIDOS.includes(novoStatus)) {
        throw new ErroValidacao(`Uso: equipamento mover <id> --status <${STATUS_VALIDOS.join("|")}>`);
      }
      // Write-ahead: esta movimentacao de status (incluindo a transicao
      // sensivel para "desmonte", que so e permitida apos triagem
      // completa) e registrada no journal ANTES de ser aplicada.
      ctx.journal.registrar(sessao.username, "EQUIPAMENTO_STATUS_ALTERADO", { equipamentoId: id, novoStatus });
      // A regra "so pode ir para desmonte apos triagem completa" e
      // aplicada dentro do repositorio/entidade, nao aqui — se a
      // transicao for invalida, moverStatus lanca ErroValidacao.
      const equip = ctx.equipamentoRepo.moverStatus(id, novoStatus, sessao.username, ctx.movimentacaoRepo);
      return `[OK] Equipamento ${equip.id} movido para status '${equip.status}'.`;
    }
    case "estado": {
      const id = cmd.posicionais[0] ?? cmd.flags["id"];
      const novoEstadoStr = cmd.flags["novo"];
      const justificativa = cmd.flags["justificativa"];
      if (!id || !novoEstadoStr) {
        throw new ErroValidacao(
          "Uso: equipamento estado <id> --novo <novo|seminovo|bom|regular|ruim|sucata> [--justificativa \"texto\"]"
        );
      }
      const novoEstado = validarEstadoFisico(novoEstadoStr);
      // Write-ahead: esta alteracao de estado fisico (incluindo a
      // exigencia de justificativa para quedas de 2+ categorias) e
      // registrada no journal ANTES de ser aplicada.
      ctx.journal.registrar(sessao.username, "EQUIPAMENTO_ESTADO_ALTERADO", { equipamentoId: id, novoEstado, justificativa: justificativa ?? null });
      // A exigencia de justificativa para quedas de 2+ categorias e
      // verificada dentro de alterarEstadoFisico, nao neste comando.
      const equip = ctx.equipamentoRepo.alterarEstadoFisico(
        id,
        novoEstado,
        justificativa,
        sessao.username,
        ctx.movimentacaoRepo
      );
      return `[OK] Estado fisico de ${equip.id} alterado para '${equip.estadoFisico}'.`;
    }
    case "ver": {
      const id = cmd.posicionais[0] ?? cmd.flags["id"];
      if (!id) throw new ErroValidacao("Uso: equipamento ver <id>");
      const equip = ctx.equipamentoRepo.buscarPorId(id);
      if (!equip) return `Equipamento ${id} nao encontrado.`;
      // vidaUtilEstimadaMeses() e uma chamada POLIMORFICA: o valor
      // exibido varia conforme a subclasse real do equipamento.
      return (
        `ID: ${equip.id}\nLote: ${equip.loteId}\nCodigo de barras: ${equip.codigoBarras}\n` +
        `Tipo: ${equip.tipo}\nEstado fisico: ${equip.estadoFisico}\nStatus: ${equip.status}\n` +
        `Triagem completa: ${equip.triagemCompleta}\nAtualizado em: ${equip.atualizadoEm}\n` +
        `Vida util de referencia: ${equip.vidaUtilEstimadaMeses()} meses`
      );
    }
    case "depreciacao": {
      const id = cmd.posicionais[0] ?? cmd.flags["id"];
      const mesesStr = cmd.flags["meses"];
      const meses = Number(mesesStr);
      if (!id || mesesStr === undefined || Number.isNaN(meses) || meses < 0) {
        throw new ErroValidacao("Uso: equipamento depreciacao <id> --meses <numero_de_meses_de_uso>");
      }
      const equip = ctx.equipamentoRepo.buscarPorId(id);
      if (!equip) return `Equipamento ${id} nao encontrado.`;
      // Chamada polimorfica: cada subclasse concreta (Terminal, CPU, Monitor,
      // Servidor, ...) calcula o coeficiente de depreciacao com sua propria
      // formula, sem que este comando precise saber qual subclasse esta em uso.
      const coeficiente = equip.calcularCoeficienteDepreciacao(meses);
      const percentual = (coeficiente * 100).toFixed(1);
      return (
        `Equipamento ${equip.id} (tipo='${equip.tipo}'): apos ${meses} meses de uso, ` +
        `coeficiente de depreciacao estimado = ${percentual}% ` +
        `(vida util de referencia: ${equip.vidaUtilEstimadaMeses()} meses).`
      );
    }
    case "listar": {
      const loteId = cmd.flags["lote"];
      // Se --lote for informado, filtra por lote; caso contrario, lista
      // todos os equipamentos do sistema.
      const lista = loteId ? ctx.equipamentoRepo.listarPorLote(loteId) : ctx.equipamentoRepo.listar();
      if (lista.length === 0) return "Nenhum equipamento encontrado.";
      return lista
        .map((e) => `- ${e.id} | codigo=${e.codigoBarras} | status=${e.status} | estado=${e.estadoFisico}`)
        .join("\n");
    }
    default:
      throw new ErroValidacao(
        "Subcomando desconhecido para 'equipamento'. Use: cadastrar | triagem | mover | estado | ver | listar | depreciacao"
      );
  }
}

// spiderman
