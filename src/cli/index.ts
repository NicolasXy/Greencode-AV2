#!/usr/bin/env node
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { ContextoApp, caminhoPadraoDados } from "./contexto";
import { parseLinha } from "./parser";
import { despachar, comandosDisponiveisParaPapel } from "../commands/router";
import { ErroPermissao, ErroSessao, ErroValidacao } from "../types";
import { validarForcaSenha } from "../core/auth";

/**
 * Ponto de entrada da CLI greencode. Este arquivo cuida de tudo que e
 * "interface com o usuario": ler linhas do terminal, mostrar prompts,
 * mascarar senha, mostrar mensagens formatadas, autocompletar comandos e
 * manter o historico entre sessoes. A LOGICA DE NEGOCIO propriamente dita
 * nao mora aqui — ela e delegada ao ContextoApp e ao roteador de comandos
 * (src/commands/router.ts); este arquivo apenas orquestra a conversa com
 * quem esta digitando.
 */

// Diretorio onde os dados sao persistidos. Pode ser sobrescrito pela
// variavel de ambiente GREENCODE_DATA_DIR (usado pelos scripts de teste,
// que apontam para uma pasta temporaria isolada a cada execucao).
const DIRETORIO_DADOS = process.env.GREENCODE_DATA_DIR ?? caminhoPadraoDados();
const CAMINHO_HISTORICO = path.join(DIRETORIO_DADOS, ".cli_history");

// Instancia unica do contexto da aplicacao para todo o processo.
const ctx = new ContextoApp(DIRETORIO_DADOS);

// spiderman

/** Retorna o codigo de escape ANSI da cor associada a cada nivel de mensagem. */
function corDe(nivel: "sucesso" | "erro" | "aviso" | "info"): string {
  // Codigos ANSI simples; funcionam em terminais Windows 10+ (VT habilitado por padrao) e Linux.
  switch (nivel) {
    case "sucesso":
      return "\x1b[32m"; // verde
    case "erro":
      return "\x1b[31m"; // vermelho
    case "aviso":
      return "\x1b[33m"; // amarelo
    case "info":
      return "\x1b[36m"; // ciano
  }
}
const RESET = "\x1b[0m"; // codigo ANSI que restaura a cor padrao do terminal

/** Imprime uma mensagem de feedback padronizada, com rotulo e cor de acordo com a severidade. */
function feedback(nivel: "sucesso" | "erro" | "aviso" | "info", mensagem: string): void {
  const rotulo = { sucesso: "OK", erro: "ERRO", aviso: "AVISO", info: "INFO" }[nivel];
  console.log(`${corDe(nivel)}[${rotulo}]${RESET} ${mensagem}`);
}

/** Carrega o historico de comandos salvo de uma sessao anterior, se existir. */
function carregarHistorico(): string[] {
  try {
    if (fs.existsSync(CAMINHO_HISTORICO)) {
      return fs
        .readFileSync(CAMINHO_HISTORICO, "utf8")
        .split("\n")
        .filter((l) => l.trim().length > 0);
    }
  } catch {
    // historico e um recurso de conveniencia; falhas de leitura nao devem impedir o uso do sistema
  }
  return [];
}

/** Salva o historico de comandos em disco ao encerrar o programa, limitando aos ultimos 500 para o arquivo nao crescer indefinidamente. */
function salvarHistorico(historico: string[]): void {
  try {
    fs.mkdirSync(DIRETORIO_DADOS, { recursive: true });
    fs.writeFileSync(CAMINHO_HISTORICO, historico.slice(-500).join("\n"), "utf8");
  } catch {
    // idem: nao interrompe o encerramento do programa
  }
}

/**
 * Leitor de linhas unificado.
 *
 * Em vez de usar rl.question() de forma reentrante (o que pode PERDER
 * linhas quando o stdin e um pipe nao interativo, pois o readline pode
 * emitir o evento 'line' para dados ja bufferizados entre uma pergunta e
 * outra, sem que haja um listener ativo naquele instante), mantemos um
 * UNICO listener 'line' durante toda a execucao, alimentando uma fila.
 * Cada leitura consome da fila ou aguarda a proxima linha. Esse padrao
 * funciona identicamente em modo interativo (TTY) e em modo automatizado
 * (scripts de teste via pipe) — esse detalhe foi descoberto durante o
 * desenvolvimento, quando testes automatizados perdiam linhas de entrada
 * usando a abordagem ingenua com rl.question().
 */
class LeitorDeLinhas {
  private fila: string[] = []; // linhas recebidas mas ainda nao consumidas
  private resolvedorPendente: ((linha: string) => void) | null = null; // callback aguardando a proxima linha, se houver
  private encerrado = false; // true quando o stdin fechou (fim do pipe ou Ctrl+D)

  constructor(public readonly rl: readline.Interface) {
    rl.on("line", (linha) => this.receber(linha));
    rl.on("close", () => {
      this.encerrado = true;
      // Se alguem estiver esperando uma linha no momento em que o stdin
      // fecha, resolve com "sair" para que o programa encerre de forma
      // limpa em vez de travar esperando para sempre.
      if (this.resolvedorPendente) {
        this.resolvedorPendente("sair");
        this.resolvedorPendente = null;
      }
    });
  }

  /** Chamado a cada evento 'line' do readline: entrega a linha imediatamente a quem estiver esperando, ou guarda na fila. */
  private receber(linha: string): void {
    if (this.resolvedorPendente) {
      const r = this.resolvedorPendente;
      this.resolvedorPendente = null;
      r(linha);
    } else {
      this.fila.push(linha);
    }
  }

  /** Retorna a proxima linha disponivel (da fila, se houver, ou aguardando o proximo evento 'line'). */
  proxima(): Promise<string> {
    if (this.fila.length > 0) {
      return Promise.resolve(this.fila.shift() as string);
    }
    if (this.encerrado) {
      return Promise.resolve("sair");
    }
    return new Promise((resolve) => {
      this.resolvedorPendente = resolve;
    });
  }
}

/** Pergunta uma linha de texto simples (nao sensivel), como um nome de usuario. */
async function perguntarTexto(leitor: LeitorDeLinhas, pergunta: string): Promise<string> {
  process.stdout.write(pergunta);
  return leitor.proxima();
}

/**
 * Pergunta uma senha. Quando stdin e um terminal interativo (TTY), mascara
 * a digitacao com asteriscos usando a tecnica de sobrescrever
 * temporariamente a funcao interna de escrita do readline. Em modo NAO
 * interativo (scripts de teste automatizados, entrada via pipe), apenas
 * le a proxima linha da fila normalmente — nao ha terminal para exibir
 * eco visual, entao mascarar nao faria sentido nem seria visivel.
 */
async function perguntarSenha(rl: readline.Interface, leitor: LeitorDeLinhas, pergunta: string): Promise<string> {
  const rlAny = rl as any; // acesso a API interna nao tipada do readline, necessario para a mascara
  const isTTY = Boolean(process.stdin.isTTY);
  process.stdout.write(pergunta);

  let escreverOriginal: ((s: string) => void) | null = null;
  if (isTTY) {
    // Guarda a funcao de escrita original para restaura-la depois, e
    // substitui temporariamente por uma versao que troca qualquer
    // caractere digitado por "*", preservando apenas as quebras de linha.
    escreverOriginal = rlAny._writeToOutput?.bind(rl) ?? null;
    rlAny._writeToOutput = function (stringToWrite: string) {
      if (stringToWrite === "\r\n" || stringToWrite === "\n" || stringToWrite === "\r") {
        rlAny.output.write(stringToWrite);
      } else {
        rlAny.output.write("*".repeat(stringToWrite.length));
      }
    };
  }

  const resposta = await leitor.proxima();

  if (isTTY && escreverOriginal) {
    rlAny._writeToOutput = escreverOriginal; // restaura o comportamento normal do readline
  }
  process.stdout.write("\n");
  return resposta;
}

/**
 * Funcao de autocompletar usada pelo readline (acionada com a tecla Tab).
 * A lista de sugestoes muda conforme o papel do usuario logado — um
 * auditor nao ve sugestoes de comandos de escrita, por exemplo.
 */
function completer(linha: string): [string[], string] {
  const sessao = ctx.auth.getSessao();
  const comandosBase = sessao
    ? [...comandosDisponiveisParaPapel(sessao.papel), "logout", "ajuda", "sair"]
    : ["login", "ajuda", "sair"];
  const opcoes = comandosBase.filter((c) => c.startsWith(linha));
  // Se nada bater com o que foi digitado, mostra a lista completa (util
  // para quem apertou Tab sem ter comecado a digitar nada ainda).
  return [opcoes.length ? opcoes : comandosBase, linha];
}

/** Implementa o comando "ajuda": lista os comandos disponiveis para o papel atualmente logado. */
function imprimirAjuda(): void {
  const sessao = ctx.auth.getSessao();
  if (!sessao) {
    console.log("Comandos disponiveis: login | ajuda | sair");
    return;
  }
  console.log(`Papel atual: ${sessao.papel}. Comandos disponiveis:`);
  for (const c of comandosDisponiveisParaPapel(sessao.papel)) {
    console.log(`  - ${c}`);
  }
  console.log("  - logout");
  console.log("  - ajuda");
  console.log("  - sair");
}

/**
 * Executa o fluxo de provisionamento inicial (primeira execucao do
 * sistema): pede o nome do administrador e a senha (com confirmacao),
 * validando a forca da senha em um LOOP ate que uma senha valida seja
 * informada — assim uma senha fraca digitada por engano nao interrompe o
 * programa com um erro fatal, apenas pede para tentar novamente.
 */
async function fluxoProvisionamento(leitor: LeitorDeLinhas): Promise<void> {
  feedback("aviso", "Arquivo de configuracao mestre nao encontrado.");
  feedback("info", "Entrando em modo de provisionamento inicial do sistema greencode.");
  const username = await perguntarTexto(leitor, "Defina o nome de usuario do administrador: ");

  let senha = "";
  while (true) {
    const tentativa = await perguntarSenha(
      leitor.rl,
      leitor,
      "Defina a senha do administrador (min. 8 caracteres, 1 maiuscula, 1 numero): "
    );
    const confirmacao = await perguntarSenha(leitor.rl, leitor, "Confirme a senha: ");
    if (tentativa !== confirmacao) {
      feedback("erro", "As senhas nao conferem. Tente novamente.");
      continue;
    }
    try {
      // Valida a forca da senha ANTES de provisionar o sistema de fato,
      // para que o usuario tenha chance de corrigir sem reiniciar o programa.
      validarForcaSenha(tentativa);
      senha = tentativa;
      break;
    } catch (e) {
      feedback("erro", (e as Error).message + " Tente novamente.");
    }
  }

  ctx.auth.provisionar(username.trim(), senha);
  ctx.inicializarRepositorios();
  feedback("sucesso", "Provisionamento concluido. Chave de criptografia mestra gerada automaticamente.");
  feedback("sucesso", `Administrador '${username.trim()}' criado. Faca login para continuar.`);
}

/** Pede usuario e senha e tenta autenticar. Falhas de login sao tratadas aqui mesmo (nao interrompem o programa). */
async function fluxoLogin(leitor: LeitorDeLinhas): Promise<void> {
  const username = await perguntarTexto(leitor, "Usuario: ");
  const senha = await perguntarSenha(leitor.rl, leitor, "Senha: ");
  try {
    const sessao = ctx.auth.login(username.trim(), senha);
    feedback("sucesso", `Login efetuado. Bem-vindo(a), ${sessao.username} (${sessao.papel}).`);
  } catch (e) {
    feedback("erro", (e as Error).message);
  }
}

/**
 * Funcao principal: monta a interface de readline, decide entre
 * provisionamento ou carregamento normal, garante que ha uma sessao
 * autenticada antes de liberar o uso, e entra no loop de comandos.
 */
async function main(): Promise<void> {
  console.log("========================================");
  console.log(" greencode - plataforma de logistica reversa");
  console.log("========================================");

  const historico = carregarHistorico();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
    history: historico.slice().reverse(), // readline espera o historico do mais recente para o mais antigo
    // terminal:false evita que o readline tente aplicar controles de
    // terminal (cores, cursor) quando a entrada nao e um TTY de verdade
    // (por exemplo, quando um script de teste alimenta o processo via pipe).
    terminal: process.stdin.isTTY === true,
    prompt: "greencode> ",
  } as readline.ReadLineOptions);

  const leitor = new LeitorDeLinhas(rl);

  // Decide entre o fluxo de primeira execucao (provisionamento) ou o
  // carregamento normal da chave mestra ja existente.
  if (ctx.auth.precisaDeProvisionamento()) {
    await fluxoProvisionamento(leitor);
  } else {
    ctx.auth.carregarChaveMestra();
    ctx.inicializarRepositorios();
  }

  // Apos o provisionamento, ainda nao ha sessao ativa (o admin so foi
  // CRIADO, nao logado automaticamente) — por isso este segundo bloco
  // pede login sempre que necessario, tanto apos provisionar quanto em
  // uma execucao normal do sistema ja existente.
  if (!ctx.auth.getSessao()) {
    feedback("info", "Efetue login para continuar.");
    await fluxoLogin(leitor);
  }

  await loopComandos(rl, leitor, historico);
}

/**
 * Loop principal de comandos: le uma linha, decide se e um comando
 * especial tratado diretamente aqui (sair, ajuda, login, logout) ou se
 * deve ser interpretado pelo parser e despachado para o roteador de
 * comandos. Continua rodando ate o usuario pedir para sair ou o stdin ser
 * fechado.
 */
async function loopComandos(
  rl: readline.Interface,
  leitor: LeitorDeLinhas,
  historico: string[]
): Promise<void> {
  while (true) {
    process.stdout.write("greencode> ");
    const linhaBruta = await leitor.proxima();
    const linha = linhaBruta.trim();

    if (linha.length > 0) {
      historico.push(linha);
    }

    // --- Comandos especiais tratados diretamente pela CLI --------------
    // (nao passam pelo parser nem pelo roteador, pois nao sao operacoes
    // de negocio: sao acoes da propria interface de linha de comando)

    if (linha === "sair" || linha === "exit" || linha === "quit") {
      encerrar(rl, historico);
      return;
    }
    if (linha === "ajuda" || linha === "help" || linha === "?") {
      imprimirAjuda();
      continue;
    }
    if (linha === "logout") {
      ctx.auth.logout();
      feedback("sucesso", "Logout efetuado.");
      await fluxoLogin(leitor); // pede login imediatamente, pois o sistema exige um usuario autenticado
      continue;
    }
    if (linha === "login" || linha.startsWith("login ")) {
      if (ctx.auth.getSessao()) {
        feedback("aviso", "Ja existe uma sessao ativa. Use 'logout' antes de logar com outro usuario.");
      } else {
        await fluxoLogin(leitor);
      }
      continue;
    }
    if (linha.length === 0) {
      continue; // linha vazia: apenas mostra o prompt novamente
    }

    // --- Comandos de negocio, via parser + roteador ---------------------

    try {
      const cmd = parseLinha(linha);
      if (!cmd) continue;
      if (!ctx.auth.getSessao()) {
        // Situacao rara (ex.: login falhou e o usuario tentou digitar um
        // comando de negocio direto): garante que nada seja executado
        // sem autenticacao, mesmo que os fluxos acima nao tenham capturado o caso.
        throw new ErroSessao("Nenhum usuario autenticado. Utilize 'login'.");
      }
      const resultado = despachar(ctx, cmd);
      feedback("sucesso", "comando executado.");
      console.log(resultado);
    } catch (e) {
      // Cada tipo de erro do dominio recebe um tratamento apropriado:
      // ErroValidacao e ErroPermissao apenas mostram a mensagem; ErroSessao
      // adicionalmente forca um novo login, ja que a sessao caiu.
      if (e instanceof ErroValidacao) {
        feedback("erro", e.message);
      } else if (e instanceof ErroPermissao) {
        feedback("erro", `[PERMISSAO NEGADA] ${e.message}`);
      } else if (e instanceof ErroSessao) {
        feedback("aviso", e.message);
        await fluxoLogin(leitor);
      } else {
        // Qualquer erro nao previsto (bug, falha de I/O etc.) e
        // capturado aqui para que o programa NUNCA encerre
        // inesperadamente por causa de um comando individual que falhou.
        feedback("erro", `Falha inesperada: ${(e as Error).message}`);
      }
    }
  }
}

/** Salva o historico, encerra a sessao e finaliza o processo de forma organizada. */
function encerrar(rl: readline.Interface, historico: string[]): void {
  salvarHistorico(historico);
  ctx.auth.logout();
  console.log("\nAte logo!");
  rl.close();
  process.exit(0);
}

// Ponto de partida real do programa. Qualquer erro nao tratado durante a
// inicializacao (por exemplo, falha ao ler o arquivo de configuracao
// mestre) e capturado aqui para exibir uma mensagem clara em vez de um
// stack trace cru.
main().catch((e) => {
  console.error("Erro fatal ao iniciar o greencode:", e);
  process.exit(1);
});
