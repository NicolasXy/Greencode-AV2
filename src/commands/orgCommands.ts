import { ComandoParseado } from "../cli/parser";
import { ContextoApp } from "../cli/contexto";
import { ErroValidacao } from "../types";
import { formatarCNPJ } from "../core/validators";
import { ValidadorCNPJ } from "../validation/ValidadorCNPJ";

const validadorCNPJ = new ValidadorCNPJ();

// spiderman

/**
 * Comandos do recurso "org" (organizacoes clientes): criar, ver e listar.
 * A validacao de CNPJ e a checagem de duplicidade acontecem dentro de
 * `ctx.orgRepo.criar` (que por sua vez usa a OrganizacaoFactory) — este
 * arquivo cuida apenas de interpretar os argumentos da CLI e formatar a
 * resposta.
 */
export function executarOrg(ctx: ContextoApp, cmd: ComandoParseado): string {
  switch (cmd.acao) {
    case "criar": {
      const cnpj = cmd.flags["cnpj"];
      // Aceita tanto --razao quanto --nome como sinonimos, por conveniencia do usuario.
      const razao = cmd.flags["razao"] ?? cmd.flags["nome"];
      const contato = cmd.flags["contato"];
      if (!cnpj || !razao) {
        throw new ErroValidacao('Uso: org criar --cnpj <cnpj> --razao "<razao social>" [--contato <contato>]');
      }
      // Normaliza/valida o CNPJ aqui (operacao em memoria, sem tocar disco)
      // para poder registrar no journal com o valor ja normalizado.
      const cnpjNormalizado = validadorCNPJ.normalizarEValidar(cnpj);
      // Write-ahead: a transacao e registrada no journal ANTES de ser
      // aplicada ao estado corrente (ctx.orgRepo.criar, que grava o
      // arquivo organizacoes.dat), conforme exigido pela especificacao.
      ctx.journal.registrar(ctx.auth.getSessao()!.username, "ORG_CRIADA", { cnpj: cnpjNormalizado });
      const org = ctx.orgRepo.criar(cnpj, razao, contato);
      return `[OK] Organizacao criada: ${org.razaoSocial} (${formatarCNPJ(org.cnpj)})`;
    }
    case "ver": {
      const cnpj = cmd.posicionais[0] ?? cmd.flags["cnpj"];
      if (!cnpj) throw new ErroValidacao("Uso: org ver <cnpj>");
      const org = ctx.orgRepo.buscarPorCnpj(cnpj);
      if (!org) return `Organizacao com CNPJ ${cnpj} nao encontrada.`;
      return `Razao social: ${org.razaoSocial}\nCNPJ: ${formatarCNPJ(org.cnpj)}\nContato: ${org.contato ?? "-"}\nCriado em: ${org.criadoEm}`;
    }
    case "listar": {
      const lista = ctx.orgRepo.listar();
      if (lista.length === 0) return "Nenhuma organizacao cadastrada.";
      return lista.map((o) => `- ${formatarCNPJ(o.cnpj)} | ${o.razaoSocial}`).join("\n");
    }
    default:
      throw new ErroValidacao("Subcomando desconhecido para 'org'. Use: criar | ver | listar");
  }
}
