// spiderman
import * as bcrypt from "bcrypt";
import { UnidadeDeTrabalho } from "../db/unidadeDeTrabalho";
import { Papel } from "../generated/prisma/enums";
import { validarForcaSenha } from "../../core/auth";
import { ErroPermissao, ErroValidacao } from "../../types";
import { ErroConflito, ErroNaoAutenticado, ErroNaoEncontrado } from "../errors";
import { Ator, versaoEfetiva } from "./tipos";

/** Resultado sem dados sensiveis (nunca expomos senhaHash). */
export interface UsuarioPublico {
  id: string;
  username: string;
  papel: Papel;
  ativo: boolean;
  versao: number;
  criadoEm: Date;
}

function publico(u: { id: string; username: string; papel: Papel; ativo: boolean; versao: number; criadoEm: Date }): UsuarioPublico {
  return { id: u.id, username: u.username, papel: u.papel, ativo: u.ativo, versao: u.versao, criadoEm: u.criadoEm };
}

function validarUsername(username: string): string {
  const nome = (username ?? "").trim();
  if (nome.length < 3 || /\s/.test(nome)) {
    throw new ErroValidacao("O nome de usuario deve ter no minimo 3 caracteres e nao pode conter espacos.");
  }
  return nome;
}

/**
 * Regras de negocio de autenticacao e gestao de usuarios. Em API stateless
 * nao ha sessao em memoria: o login apenas VERIFICA credenciais; a emissao
 * do JWT acontece no controller (que conhece o Fastify). O hash de senha
 * usa bcrypt (salt aleatorio embutido no proprio hash e custo configuravel).
 */
export class AuthService {
  // Hash "isca" usado quando o usuario nao existe, para que o tempo de
  // resposta nao revele se o username e valido (mitiga enumeracao de contas).
  private readonly hashIsca: string;

  constructor(private readonly uow: UnidadeDeTrabalho, private readonly bcryptRounds: number) {
    this.hashIsca = bcrypt.hashSync("senha-isca-greencode", bcryptRounds);
  }

  private hash(senha: string): Promise<string> {
    return bcrypt.hash(senha, this.bcryptRounds);
  }

  /** Modo de provisionamento: so funciona enquanto NAO existir nenhum usuario. */
  async primeiroAdmin(username: string, senha: string): Promise<UsuarioPublico> {
    const nome = validarUsername(username);
    validarForcaSenha(senha);
    const senhaHash = await this.hash(senha);
    return this.uow.transacao(async (r) => {
      if ((await r.usuarios.contar()) > 0) {
        throw new ErroConflito("O sistema ja foi provisionado.");
      }
      const u = await r.usuarios.criar({ username: nome, senhaHash, papel: "admin" });
      await r.auditoria.registrar(u.id, "PROVISIONAMENTO", { username: nome });
      return publico(u);
    });
  }

  async login(username: string, senha: string): Promise<UsuarioPublico> {
    const r = this.uow.simples();
    const u = await r.usuarios.buscarPorUsername((username ?? "").trim());
    const senhaOk = await bcrypt.compare(senha ?? "", u ? u.senhaHash : this.hashIsca);
    if (!u || !senhaOk || !u.ativo) {
      await r.auditoria.registrar(u?.id ?? null, "LOGIN_FALHA", { username });
      // Mensagem generica: nao revela se a conta existe, esta desativada ou a senha errou.
      throw new ErroNaoAutenticado("Credenciais invalidas.");
    }
    await r.auditoria.registrar(u.id, "LOGIN_SUCESSO", {});
    return publico(u);
  }

  /**
   * Resolve o ator de uma requisicao autenticada: relê o usuario no banco e
   * exige conta existente e ativa. Usado pelo hook de autenticacao (assim o
   * hook nao acessa repositorio diretamente, respeitando as camadas).
   */
  async obterAtor(id: string): Promise<Ator> {
    const u = await this.uow.simples().usuarios.buscarPorId(id);
    if (!u || !u.ativo) throw new ErroNaoAutenticado("Conta inexistente ou desativada.");
    return { id: u.id, username: u.username, papel: u.papel };
  }

  async obter(id: string): Promise<UsuarioPublico> {
    const u = await this.uow.simples().usuarios.buscarPorId(id);
    if (!u) throw new ErroNaoEncontrado("Usuario nao encontrado.");
    return publico(u);
  }

  async criarUsuario(ator: Ator, username: string, senha: string, papel: Papel): Promise<UsuarioPublico> {
    const nome = validarUsername(username);
    validarForcaSenha(senha);
    const senhaHash = await this.hash(senha);
    return this.uow.transacao(async (r) => {
      if (await r.usuarios.buscarPorUsername(nome)) throw new ErroConflito(`Usuario '${nome}' ja existe.`);
      const u = await r.usuarios.criar({ username: nome, senhaHash, papel });
      await r.auditoria.registrar(ator.id, "USUARIO_CRIADO", { username: nome, papel });
      return publico(u);
    });
  }

  async listar(): Promise<UsuarioPublico[]> {
    return (await this.uow.simples().usuarios.listar()).map(publico);
  }

  async renomear(ator: Ator, id: string, novoUsername: string, versao?: number): Promise<UsuarioPublico> {
    const novo = validarUsername(novoUsername);
    return this.uow.transacao(async (r) => {
      const alvo = await r.usuarios.buscarPorId(id);
      if (!alvo) throw new ErroNaoEncontrado("Usuario nao encontrado.");
      if (alvo.username === novo) throw new ErroValidacao("O novo nome de usuario e igual ao atual.");
      if (await r.usuarios.buscarPorUsername(novo)) throw new ErroConflito(`Usuario '${novo}' ja existe.`);
      const atualizado = await r.usuarios.atualizarComVersao(id, versaoEfetiva(versao, alvo.versao), { username: novo });
      await r.auditoria.registrar(ator.id, "USUARIO_RENOMEADO", { de: alvo.username, para: novo });
      return publico(atualizado);
    });
  }

  async alterarAtivo(ator: Ator, id: string, ativo: boolean, versao?: number): Promise<UsuarioPublico> {
    return this.uow.transacao(async (r) => {
      const alvo = await r.usuarios.buscarPorId(id);
      if (!alvo) throw new ErroNaoEncontrado("Usuario nao encontrado.");
      if (!ativo && alvo.id === ator.id) throw new ErroValidacao("Voce nao pode desativar a propria conta.");
      const atualizado = await r.usuarios.atualizarComVersao(id, versaoEfetiva(versao, alvo.versao), { ativo });
      await r.auditoria.registrar(ator.id, ativo ? "USUARIO_REATIVADO" : "USUARIO_DESATIVADO", { username: alvo.username });
      return publico(atualizado);
    });
  }

  /**
   * Delete definitivo de usuario. O banco recusa (409) se ele ja tiver
   * lotes ou movimentacoes associados; nesse caso use a inativacao
   * (`alterarAtivo(false)`), que e o soft delete e preserva o historico.
   */
  async excluir(ator: Ator, id: string): Promise<void> {
    if (ator.papel !== "admin") throw new ErroPermissao("Somente o administrador pode excluir definitivamente.");
    await this.uow.transacao(async (r) => {
      const alvo = await r.usuarios.buscarPorId(id);
      if (!alvo) throw new ErroNaoEncontrado("Usuario nao encontrado.");
      if (alvo.id === ator.id) throw new ErroValidacao("Voce nao pode excluir a propria conta.");
      try {
        await r.usuarios.excluir(id);
      } catch (e) {
        if ((e as { code?: string }).code === "P2003") {
          throw new ErroConflito("O usuario possui historico (lotes ou movimentacoes); inative-o em vez de exclui-lo.");
        }
        throw e;
      }
      await r.auditoria.registrar(ator.id, "USUARIO_EXCLUIDO", { username: alvo.username });
    });
  }

  /** Admin altera o papel de OUTRO usuario (nunca o proprio, para nao se bloquear do sistema). */
  async alterarPapel(ator: Ator, id: string, papel: Papel, versao?: number): Promise<UsuarioPublico> {
    return this.uow.transacao(async (r) => {
      const alvo = await r.usuarios.buscarPorId(id);
      if (!alvo) throw new ErroNaoEncontrado("Usuario nao encontrado.");
      if (alvo.id === ator.id) throw new ErroValidacao("Voce nao pode alterar o proprio papel.");
      if (alvo.papel === papel) throw new ErroValidacao(`O usuario ja possui o papel '${papel}'.`);
      const atualizado = await r.usuarios.atualizarComVersao(id, versaoEfetiva(versao, alvo.versao), { papel });
      await r.auditoria.registrar(ator.id, "USUARIO_PAPEL_ALTERADO", { username: alvo.username, de: alvo.papel, para: papel });
      return publico(atualizado);
    });
  }

  /** Admin redefine a senha de outro usuario (a politica de forca de senha continua valendo). */
  async redefinirSenha(ator: Ator, id: string, novaSenha: string, versao?: number): Promise<void> {
    validarForcaSenha(novaSenha);
    const senhaHash = await this.hash(novaSenha);
    await this.uow.transacao(async (r) => {
      const alvo = await r.usuarios.buscarPorId(id);
      if (!alvo) throw new ErroNaoEncontrado("Usuario nao encontrado.");
      await r.usuarios.atualizarComVersao(id, versaoEfetiva(versao, alvo.versao), { senhaHash });
      await r.auditoria.registrar(ator.id, "USUARIO_SENHA_REDEFINIDA", { username: alvo.username });
    });
  }

  async alterarPropriaSenha(ator: Ator, senhaAtual: string, novaSenha: string): Promise<void> {
    validarForcaSenha(novaSenha);
    const novoHash = await this.hash(novaSenha);
    await this.uow.transacao(async (r) => {
      const u = await r.usuarios.buscarPorId(ator.id);
      if (!u || !(await bcrypt.compare(senhaAtual ?? "", u.senhaHash))) {
        throw new ErroNaoAutenticado("Senha atual incorreta.");
      }
      await r.usuarios.atualizarComVersao(u.id, u.versao, { senhaHash: novoHash });
      await r.auditoria.registrar(ator.id, "SENHA_ALTERADA", {});
    });
  }
}
