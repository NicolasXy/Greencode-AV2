import { ComandoParseado } from "../cli/parser";
import { ContextoApp } from "../cli/contexto";
import { ErroValidacao } from "../types";

/**
 * Comandos do recurso "contrato" (contrato de coleta firmado com uma
 * organizacao cliente). Disponivel para os mesmos papeis de "org"
 * (admin e cadastro), pois e o operador de cadastro quem, segundo a
 * especificacao do sistema, insere organizacoes e seus respectivos
 * contratos de coleta.
 */
export function executarContrato(ctx: ContextoApp, cmd: ComandoParseado): string {
  const sessao = ctx.auth.getSessao()!;
  switch (cmd.acao) {
    case "criar": {
      const org = cmd.flags["org"];
      const inicio = cmd.flags["inicio"];
      const frequenciaStr = cmd.flags["frequencia"] ?? "30"; // padrao: coleta mensal
      const condicoes = cmd.flags["condicoes"];
      const frequencia = Number(frequenciaStr);
      if (!org || !inicio) {
        throw new ErroValidacao(
          'Uso: contrato criar --org <cnpj> --inicio <AAAA-MM-DD> [--frequencia <dias>] [--condicoes "texto"]'
        );
      }
      if (Number.isNaN(frequencia)) {
        throw new ErroValidacao("Frequencia de coleta (--frequencia) deve ser um numero de dias.");
      }
      // Write-ahead: registra a transacao no journal ANTES de aplica-la ao
      // estado corrente. Como o id do contrato so existe apos a criacao,
      // o registro usa os dados de entrada (organizacao + data de inicio)
      // como identificadores da transacao.
      ctx.journal.registrar(sessao.username, "CONTRATO_CRIADO", { org, inicio, frequencia });
      const contrato = ctx.contratoRepo.criar(org, inicio, frequencia, condicoes, ctx.orgRepo);
      return (
        `[OK] Contrato de coleta criado: ${contrato.id} | org=${contrato.orgCnpj} | ` +
        `inicio=${contrato.dataInicio} | frequencia=${contrato.frequenciaColetaDias} dia(s)`
      );
    }
    case "ver": {
      const id = cmd.posicionais[0] ?? cmd.flags["id"];
      if (!id) throw new ErroValidacao("Uso: contrato ver <id>");
      const contrato = ctx.contratoRepo.buscarPorId(id);
      if (!contrato) return `Contrato ${id} nao encontrado.`;
      return (
        `ID: ${contrato.id}\nOrganizacao: ${contrato.orgCnpj}\nInicio: ${contrato.dataInicio}\n` +
        `Frequencia de coleta: ${contrato.frequenciaColetaDias} dia(s)\n` +
        `Condicoes: ${contrato.condicoes ?? "-"}\nAtivo: ${contrato.ativo}`
      );
    }
    case "listar": {
      const orgCnpj = cmd.flags["org"];
      const lista = orgCnpj ? ctx.contratoRepo.listarPorOrg(orgCnpj) : ctx.contratoRepo.listar();
      if (lista.length === 0) return "Nenhum contrato de coleta encontrado.";
      return lista
        .map((c) => `- ${c.id} | org=${c.orgCnpj} | inicio=${c.dataInicio} | ativo=${c.ativo}`)
        .join("\n");
    }
    case "encerrar": {
      const id = cmd.posicionais[0] ?? cmd.flags["id"];
      if (!id) throw new ErroValidacao("Uso: contrato encerrar <id>");
      // Write-ahead: journal antes da gravacao do estado atualizado.
      ctx.journal.registrar(sessao.username, "CONTRATO_ENCERRADO", { contratoId: id });
      const contrato = ctx.contratoRepo.encerrar(id);
      return `[OK] Contrato ${contrato.id} encerrado.`;
    }
    default:
      throw new ErroValidacao("Subcomando desconhecido para 'contrato'. Use: criar | ver | listar | encerrar");
  }
}

// spiderman
