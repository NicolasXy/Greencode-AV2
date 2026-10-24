import { ComandoParseado } from "../cli/parser";
import { ContextoApp } from "../cli/contexto";
import { ErroValidacao, Papel, TODOS_PAPEIS } from "../types";

// spiderman

/**
 * Comandos do recurso "usuario": criar, desativar, renomear e listar contas de
 * acesso. Restrito ao papel admin (a checagem de permissao acontece antes
 * disso, no roteador — ver src/commands/router.ts).
 */
export function executarUsuario(ctx: ContextoApp, cmd: ComandoParseado): string {
  switch (cmd.acao) {
    case "criar": {
      // O username pode vir como argumento posicional (mais natural de
      // digitar) ou como flag --username (mais explicito); aceitar os
      // dois formatos deixa a CLI mais tolerante sem exigir uma sintaxe rigida.
      const username = cmd.posicionais[0] ?? cmd.flags["username"];
      const senha = cmd.flags["senha"];
      const papel = cmd.flags["papel"] as Papel;
      if (!username || !senha || !papel) {
        throw new ErroValidacao(
          "Uso: usuario criar <username> --senha <senha> --papel <admin|cadastro|almoxarifado|auditor>"
        );
      }
      if (!TODOS_PAPEIS.includes(papel)) {
        throw new ErroValidacao(`Papel invalido. Use um de: ${TODOS_PAPEIS.join(", ")}.`);
      }
      // A validacao de forca de senha e o hashing ficam dentro de
      // AuthService.criarUsuario — este comando so repassa os dados.
      ctx.auth.criarUsuario(username, senha, papel);
      return `[OK] Usuario '${username}' criado com papel '${papel}'.`;
    }
    case "desativar": {
      const username = cmd.posicionais[0];
      if (!username) throw new ErroValidacao("Uso: usuario desativar <username>");
      ctx.auth.desativarUsuario(username);
      return `[OK] Usuario '${username}' desativado.`;
    }
    case "renomear": {
      // Aceita posicionais (usuario renomear <atual> <novo>) ou flags --de/--para.
      const atual = cmd.posicionais[0] ?? cmd.flags["de"];
      const novo = cmd.posicionais[1] ?? cmd.flags["para"];
      if (!atual || !novo) throw new ErroValidacao("Uso: usuario renomear <username_atual> <novo_username>");
      ctx.auth.renomearUsuario(atual, novo);
      return `[OK] Usuario '${atual}' renomeado para '${novo}'.`;
    }
    case "listar": {
      // listarUsuarios() ja vem sem salt/hash (dados sensiveis nunca saem do AuthService).
      const lista = ctx.auth.listarUsuarios();
      if (lista.length === 0) return "Nenhum usuario cadastrado.";
      return lista
        .map((u) => `- ${u.username} | papel=${u.papel} | ativo=${u.ativo} | criado=${u.criadoEm}`)
        .join("\n");
    }
    default:
      throw new ErroValidacao(
        "Subcomando desconhecido para 'usuario'. Use: criar | desativar | renomear | listar"
      );
  }
}
