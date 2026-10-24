import * as fs from "fs";
import * as path from "path";
import {
  CredencialArmazenada,
  ErroPermissao,
  ErroSessao,
  ErroValidacao,
  Papel,
  SessaoAtiva,
} from "../types";
import { gerarChaveDados, gerarHashSenha, verificarSenha } from "./crypto";
import { escreverSeguro, escreverTextoAtomico, lerSeguro, garantirDiretorio } from "./storage";
import { Journal } from "./journal";

// Tempo maximo de inatividade permitido antes da sessao expirar automaticamente.
const TIMEOUT_SESSAO_MS = 30 * 60 * 1000; // 30 minutos

/**
 * Formato do arquivo de configuracao mestre (master.config.json). Guarda a
 * chave de criptografia usada para cifrar TODOS os demais arquivos de
 * dados do sistema. Ver docs/SECURITY.md para a discussao sobre onde essa
 * chave deveria idealmente residir em producao (cofre de segredos/KMS).
 */
interface ConfigMestre {
  chaveMestraHex: string;
  criadoEm: string;
  versao: number; // reservado para permitir migracoes de formato no futuro
}

// spiderman

/**
 * AuthService concentra toda a logica de identidade e acesso do sistema:
 *  - Provisionamento inicial (primeira execucao: cria a chave mestra e o
 *    primeiro administrador).
 *  - Login/logout e emissao de sessao em memoria.
 *  - Expiracao de sessao por inatividade (janela deslizante de 30 min).
 *  - Controle de acesso por papel (RBAC): metodo exigirPapel().
 *  - Gestao de contas de usuario (criar/desativar/listar), restrita ao
 *    papel admin.
 *
 * A chave mestra de dados fica SOMENTE em memoria depois de carregada, e
 * nunca e devolvida para fora desta classe em texto plano, exceto pelo
 * metodo getChaveMestra(), usado internamente pelos repositorios para
 * cifrar/decifrar seus proprios arquivos.
 */
export class AuthService {
  private diretorioDados: string;
  private caminhoConfig: string; // caminho do arquivo de configuracao mestre
  private caminhoCredenciais: string; // caminho do arquivo cifrado de credenciais de usuario
  private chaveMestra: Buffer | null = null; // carregada em memoria apos provisionamento/inicializacao
  private sessao: SessaoAtiva | null = null; // sessao do usuario atualmente logado (uma por processo)
  private journal: Journal;

  constructor(diretorioDados: string, journal: Journal) {
    this.diretorioDados = diretorioDados;
    this.caminhoConfig = path.join(diretorioDados, "master.config.json");
    this.caminhoCredenciais = path.join(diretorioDados, "credenciais.dat");
    this.journal = journal;
    garantirDiretorio(diretorioDados);
  }

  /** Indica se o sistema ainda nao foi configurado (primeira execucao). */
  precisaDeProvisionamento(): boolean {
    return !fs.existsSync(this.caminhoConfig);
  }

  /**
   * Executa o provisionamento inicial do sistema: gera a chave mestra de
   * criptografia, grava o arquivo de configuracao mestre e cadastra o
   * primeiro usuario administrador. So pode ser executado uma unica vez
   * (chamadas subsequentes lancam erro).
   */
  provisionar(usernameAdmin: string, senhaAdmin: string): void {
    if (!this.precisaDeProvisionamento()) {
      throw new ErroValidacao("O sistema ja foi provisionado.");
    }
    if (!usernameAdmin || usernameAdmin.trim().length < 3) {
      throw new ErroValidacao("Nome de usuario do administrador deve ter ao menos 3 caracteres.");
    }
    validarForcaSenha(senhaAdmin);

    const chaveMestra = gerarChaveDados();
    const config: ConfigMestre = {
      chaveMestraHex: chaveMestra.toString("hex"),
      criadoEm: new Date().toISOString(),
      versao: 1,
    };

    // Grava o arquivo de configuracao mestre. Em producao, a chave
    // deveria residir em um cofre/KMS dedicado; aqui restringimos as
    // permissoes do arquivo como mitigacao (ver docs/SECURITY.md).
    escreverTextoAtomico(this.caminhoConfig, JSON.stringify(config, null, 2));
    try {
      // chmod 600 = leitura/escrita apenas para o dono do arquivo (POSIX).
      fs.chmodSync(this.caminhoConfig, 0o600);
    } catch {
      // No Windows o chmod do Node tem efeito limitado; a recomendacao
      // operacional (restringir ACL da pasta data/) fica documentada no
      // README, e a falha aqui nao deve impedir o provisionamento.
    }

    this.chaveMestra = chaveMestra;

    // O journal e escrito ANTES da credencial do administrador ser
    // persistida (write-ahead): assim, mesmo que o processo seja
    // interrompido logo apos esta linha, ja existe um registro de que o
    // provisionamento foi iniciado com este administrador, coerente com a
    // exigencia de que "cada transacao seja registrada em um log imutavel
    // antes de ser aplicada ao estado corrente".
    this.journal.registrar("SYSTEM", "PROVISIONAMENTO", { admin: usernameAdmin });

    // Cria a credencial do primeiro administrador, ja com hash de senha
    // (nunca a senha em texto plano) e gravada cifrada com a chave recem-gerada.
    const { salt, hash } = gerarHashSenha(senhaAdmin);
    const credencial: CredencialArmazenada = {
      username: usernameAdmin,
      salt,
      hash,
      papel: "admin",
      criadoEm: new Date().toISOString(),
      ativo: true,
    };
    escreverSeguro(this.caminhoCredenciais, this.chaveMestra, [credencial]);
  }

  /**
   * Carrega a chave mestra em memoria a partir do arquivo de configuracao,
   * usado em toda execucao POSTERIOR ao provisionamento (o sistema ja
   * existe, so precisa "destrancar" a chave para operar).
   */
  carregarChaveMestra(): void {
    if (this.precisaDeProvisionamento()) {
      throw new ErroValidacao("Sistema nao provisionado.");
    }
    const raw = fs.readFileSync(this.caminhoConfig, "utf8");
    const config = JSON.parse(raw) as ConfigMestre;
    this.chaveMestra = Buffer.from(config.chaveMestraHex, "hex");
  }

  /** Retorna a chave mestra ja carregada; lanca erro se chamada antes do provisionamento/carregamento. */
  getChaveMestra(): Buffer {
    if (!this.chaveMestra) {
      throw new ErroValidacao("Chave mestra nao carregada. Execute o provisionamento ou inicialize o sistema.");
    }
    return this.chaveMestra;
  }

  private lerCredenciais(): CredencialArmazenada[] {
    return lerSeguro<CredencialArmazenada[]>(this.caminhoCredenciais, this.getChaveMestra(), []);
  }

  private salvarCredenciais(lista: CredencialArmazenada[]): void {
    escreverSeguro(this.caminhoCredenciais, this.getChaveMestra(), lista);
  }

  /**
   * Autentica um usuario e, em caso de sucesso, cria uma nova sessao em
   * memoria. A mensagem de erro e propositalmente GENERICA ("usuario ou
   * senha invalidos") tanto para usuario inexistente quanto para senha
   * incorreta, evitando que um atacante descubra por tentativa e erro
   * quais usernames existem no sistema (mitigacao de enumeracao de contas).
   */
  login(username: string, senha: string): SessaoAtiva {
    const credenciais = this.lerCredenciais();
    const cred = credenciais.find((c) => c.username === username);
    if (!cred || !cred.ativo || !verificarSenha(senha, cred.salt, cred.hash)) {
      this.journal.registrar(username || "DESCONHECIDO", "LOGIN_FALHOU", {});
      throw new ErroValidacao("Usuario ou senha invalidos.");
    }
    const agora = new Date().toISOString();
    this.sessao = {
      username: cred.username,
      papel: cred.papel,
      loginEm: agora,
      ultimaAtividade: agora,
    };
    this.journal.registrar(username, "LOGIN_SUCESSO", { papel: cred.papel });
    return this.sessao;
  }

  /** Encerra a sessao atual (se houver), registrando o evento no journal. */
  logout(): void {
    if (this.sessao) {
      this.journal.registrar(this.sessao.username, "LOGOUT", {});
    }
    this.sessao = null;
  }

  /**
   * Deve ser chamado ANTES de executar qualquer comando protegido. Valida
   * que existe uma sessao ativa e que ela nao expirou por inatividade.
   * Implementa uma janela DESLIZANTE de expiracao: cada chamada bem
   * sucedida atualiza `ultimaAtividade` para o instante atual, entao um
   * usuario que continua usando o sistema ativamente nunca e desconectado
   * no meio de uma tarefa.
   */
  exigirSessaoValida(): SessaoAtiva {
    if (!this.sessao) {
      throw new ErroSessao("Nenhum usuario autenticado. Utilize 'login <usuario>'.");
    }
    const inativoMs = Date.now() - new Date(this.sessao.ultimaAtividade).getTime();
    if (inativoMs > TIMEOUT_SESSAO_MS) {
      const username = this.sessao.username;
      this.sessao = null;
      this.journal.registrar(username, "SESSAO_EXPIRADA", { inativoMs });
      throw new ErroSessao("Sessao expirada por inatividade (30 minutos). Faca login novamente.");
    }
    this.sessao.ultimaAtividade = new Date().toISOString();
    return this.sessao;
  }

  /** Retorna a sessao atual sem validar expiracao (uso interno/leitura simples, ex.: exibir o prompt). */
  getSessao(): SessaoAtiva | null {
    return this.sessao;
  }

  /**
   * Verifica se o papel do usuario logado esta entre os papeis permitidos
   * para a acao solicitada (controle de acesso baseado em papel — RBAC).
   * Tambem valida a sessao (chama exigirSessaoValida internamente), entao
   * um unico chamado cobre as duas checagens.
   */
  exigirPapel(...papeisPermitidos: Papel[]): SessaoAtiva {
    const sessao = this.exigirSessaoValida();
    if (!papeisPermitidos.includes(sessao.papel)) {
      throw new ErroPermissao(
        `Acao nao permitida para o papel '${sessao.papel}'. Papeis permitidos: ${papeisPermitidos.join(", ")}.`
      );
    }
    return sessao;
  }

  // --- Gestao de contas (uso exclusivo do administrador) -------------------

  /** Cria um novo usuario. Restrito ao papel admin (checado via exigirPapel). */
  criarUsuario(username: string, senha: string, papel: Papel): void {
    this.exigirPapel("admin");
    validarForcaSenha(senha);
    const credenciais = this.lerCredenciais();
    if (credenciais.some((c) => c.username === username)) {
      throw new ErroValidacao(`Usuario '${username}' ja existe.`);
    }
    const { salt, hash } = gerarHashSenha(senha);
    credenciais.push({
      username,
      salt,
      hash,
      papel,
      criadoEm: new Date().toISOString(),
      ativo: true,
    });
    // Write-ahead: registra a intencao no journal ANTES de gravar a nova
    // credencial em disco, para que a transacao fique registrada mesmo se
    // o processo for interrompido logo em seguida.
    this.journal.registrar(this.getSessao()!.username, "USUARIO_CRIADO", { username, papel });
    this.salvarCredenciais(credenciais);
  }

  /**
   * Desativa um usuario (nao remove o registro, apenas marca `ativo:
   * false`). Um usuario desativado nao consegue mais fazer login, mas seu
   * historico de acoes anteriores permanece integro no journal.
   */
  desativarUsuario(username: string): void {
    this.exigirPapel("admin");
    const credenciais = this.lerCredenciais();
    const alvo = credenciais.find((c) => c.username === username);
    if (!alvo) throw new ErroValidacao(`Usuario '${username}' nao encontrado.`);
    alvo.ativo = false;
    // Write-ahead: journal antes da gravacao do estado atualizado.
    this.journal.registrar(this.getSessao()!.username, "USUARIO_DESATIVADO", { username });
    this.salvarCredenciais(credenciais);
  }

  /**
   * Altera o nome de login de um usuario existente (somente admin).
   * Regras: novo nome com no minimo 3 caracteres, sem espacos, diferente do
   * atual e ainda nao utilizado por outra conta. Senha, papel e estado
   * (ativo/inativo) sao preservados. Se o usuario renomeado for o que esta
   * logado, a sessao em memoria e atualizada para o novo nome. Registros
   * historicos (journal, movimentacoes, lotes) mantem o nome antigo de
   * proposito, pois representam quem era o autor no momento da acao.
   */
  renomearUsuario(usernameAtual: string, novoUsername: string): void {
    this.exigirPapel("admin");
    const novo = (novoUsername ?? "").trim();
    if (novo.length < 3 || /\s/.test(novo)) {
      throw new ErroValidacao("O novo nome de usuario deve ter no minimo 3 caracteres e nao pode conter espacos.");
    }
    const credenciais = this.lerCredenciais();
    const alvo = credenciais.find((c) => c.username === usernameAtual);
    if (!alvo) throw new ErroValidacao(`Usuario '${usernameAtual}' nao encontrado.`);
    if (usernameAtual === novo) {
      throw new ErroValidacao("O novo nome de usuario e igual ao atual.");
    }
    if (credenciais.some((c) => c.username === novo)) {
      throw new ErroValidacao(`Usuario '${novo}' ja existe.`);
    }
    alvo.username = novo;
    // Write-ahead: journal antes da gravacao do estado atualizado.
    this.journal.registrar(this.getSessao()!.username, "USUARIO_RENOMEADO", { de: usernameAtual, para: novo });
    this.salvarCredenciais(credenciais);
    if (this.sessao && this.sessao.username === usernameAtual) {
      this.sessao.username = novo;
    }
  }

  /** Lista os usuarios cadastrados, OMITINDO salt e hash (dados sensiveis nunca saem desta classe). */
  listarUsuarios(): Omit<CredencialArmazenada, "salt" | "hash">[] {
    this.exigirPapel("admin");
    return this.lerCredenciais().map(({ salt, hash, ...resto }) => resto);
  }
}

/**
 * Politica minima de forca de senha: pelo menos 8 caracteres, contendo ao
 * menos uma letra maiuscula e um digito. Aplicada tanto no provisionamento
 * quanto na criacao de novos usuarios pelo administrador.
 */
export function validarForcaSenha(senha: string): void {
  if (!senha || senha.length < 8) {
    throw new ErroValidacao("A senha deve ter no minimo 8 caracteres.");
  }
  if (!/[A-Z]/.test(senha) || !/[0-9]/.test(senha)) {
    throw new ErroValidacao("A senha deve conter ao menos uma letra maiuscula e um numero.");
  }
}
