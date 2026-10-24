#!/usr/bin/env node
/**
 * Teste funcional da expiracao de sessao por inatividade.
 *
 * Diferente dos demais testes (que dirigem a CLI via subprocesso), este
 * script importa o AuthService JA COMPILADO diretamente e manipula o
 * campo `ultimaAtividade` da sessao para simular a passagem do tempo, sem
 * precisar esperar 30 minutos de verdade. E a unica forma pratica de
 * provar, de forma automatizada, que o mecanismo de expiracao (exigido
 * explicitamente pelo PDF: "expiracao de sessao apos trinta minutos de
 * inatividade") realmente funciona — testes via CLI/subprocesso nunca
 * esperariam 30 minutos reais para validar isso.
 *
 * Uso: node tests/run-session-timeout.js
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

const RAIZ = path.join(__dirname, "..");
const { AuthService } = require(path.join(RAIZ, "dist", "core", "auth.js"));
const { Journal } = require(path.join(RAIZ, "dist", "core", "journal.js"));

let falhas = 0;
let passos = 0;

function afirmar(condicao, mensagem) {
  passos++;
  if (condicao) {
    console.log(`  [PASS] ${mensagem}`);
  } else {
    falhas++;
    console.error(`  [FAIL] ${mensagem}`);
  }
}

function novoAuthService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "greencode-sessao-"));
  const journal = new Journal(dir);
  const auth = new AuthService(dir, journal);
  auth.provisionar("admin1", "SenhaForte1");
  return { auth, journal, dir };
}

function definirInatividadeMinutos(auth, minutos) {
  const sessao = auth.getSessao();
  sessao.ultimaAtividade = new Date(Date.now() - minutos * 60 * 1000).toISOString();
}

function main() {
  console.log("1) Sessao recem-criada deve ser valida");
  let { auth } = novoAuthService();
  auth.login("admin1", "SenhaForte1");
  try {
    auth.exigirSessaoValida();
    afirmar(true, "sessao recem-criada (0 min de inatividade) e valida");
  } catch (e) {
    afirmar(false, `sessao recem-criada deveria ser valida, mas falhou: ${e.message}`);
  }

  console.log("\n2) Limite exato: 29 minutos de inatividade NAO deve expirar");
  definirInatividadeMinutos(auth, 29);
  try {
    auth.exigirSessaoValida();
    afirmar(true, "sessao com 29 min de inatividade continua valida (dentro do limite de 30 min)");
  } catch (e) {
    afirmar(false, `sessao de 29 min nao deveria ter expirado: ${e.message}`);
  }

  console.log("\n3) Janela deslizante: exigirSessaoValida() renova ultimaAtividade");
  const sessaoAntes = auth.getSessao();
  const ultimaAtividadeAntes = sessaoAntes.ultimaAtividade;
  // Pequena espera real para garantir que o novo timestamp seja diferente.
  const inicio = Date.now();
  while (Date.now() - inicio < 5) {
    /* espera ativa minima */
  }
  auth.exigirSessaoValida();
  const ultimaAtividadeDepois = auth.getSessao().ultimaAtividade;
  afirmar(
    ultimaAtividadeDepois !== ultimaAtividadeAntes,
    "cada chamada valida a exigirSessaoValida() atualiza ultimaAtividade (janela deslizante, nao apenas no login)"
  );

  console.log("\n4) Limite exato: 31 minutos de inatividade DEVE expirar");
  ({ auth } = novoAuthService());
  auth.login("admin1", "SenhaForte1");
  definirInatividadeMinutos(auth, 31);
  let expirou = false;
  try {
    auth.exigirSessaoValida();
  } catch (e) {
    expirou = e.name === "ErroSessao" && /expirad/i.test(e.message);
  }
  afirmar(expirou, "sessao com 31 min de inatividade expira com ErroSessao apropriado");

  console.log("\n5) Apos expirar, a sessao e removida (exige novo login)");
  afirmar(auth.getSessao() === null, "getSessao() retorna null apos a expiracao (sessao efetivamente encerrada, nao apenas sinalizada)");

  console.log("\n6) Apos expirar e logar novamente, a sessao volta a funcionar normalmente");
  auth.login("admin1", "SenhaForte1");
  try {
    auth.exigirSessaoValida();
    afirmar(true, "login apos expiracao cria uma sessao nova e valida normalmente");
  } catch (e) {
    afirmar(false, `login apos expiracao deveria funcionar: ${e.message}`);
  }

  console.log("\n7) A expiracao e registrada no journal (rastreabilidade do evento)");
  const terceiro = novoAuthService();
  terceiro.auth.login("admin1", "SenhaForte1");
  definirInatividadeMinutos(terceiro.auth, 45);
  try {
    terceiro.auth.exigirSessaoValida();
  } catch {
    /* esperado: ErroSessao */
  }
  const linhasJournal = fs
    .readFileSync(path.join(terceiro.dir, "journal", "journal.log"), "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
  const entradaExpiracao = linhasJournal.find((e) => e.acao === "SESSAO_EXPIRADA");
  afirmar(
    Boolean(entradaExpiracao) && entradaExpiracao.payload.inativoMs >= 45 * 60 * 1000,
    "evento SESSAO_EXPIRADA e gravado no journal, com o tempo de inatividade observado no payload"
  );

  console.log(`\nResumo: ${passos - falhas}/${passos} verificacoes OK.`);
  if (falhas > 0) {
    console.error(`\n${falhas} verificacao(oes) FALHARAM.`);
    process.exit(1);
  } else {
    console.log("\nTodas as verificacoes passaram.");
    process.exit(0);
  }
}

main();
