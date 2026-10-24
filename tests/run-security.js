#!/usr/bin/env node
/**
 * Teste de cenarios de seguranca e permissao do greencode.
 *
 * Cobre casos complementares ao teste de jornada (run-journey.js):
 *   1. Rejeicao de senha fraca no provisionamento.
 *   2. Rejeicao de login com senha incorreta / usuario inexistente.
 *   3. Usuario desativado pelo administrador nao consegue mais logar.
 *   4. Operador de cadastro nao pode cadastrar equipamentos (fora de sua alcada).
 *   5. Gestor de almoxarifado nao pode criar usuarios (fora de sua alcada).
 *   6. Comando para recurso/subcomando inexistente retorna erro tratado
 *      (nao derruba o processo).
 *
 * Uso: node tests/run-security.js
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const RAIZ = path.join(__dirname, "..");
const BIN = path.join(RAIZ, "dist", "cli", "index.js");

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

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class DriverCLI {
  constructor(dirDados) {
    this.proc = spawn(process.execPath, [BIN], {
      cwd: RAIZ,
      env: { ...process.env, GREENCODE_DATA_DIR: dirDados },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.buffer = "";
    this.lido = 0;
    this.proc.stdout.on("data", (d) => (this.buffer += d.toString("utf8")));
    this.proc.stderr.on("data", (d) => (this.buffer += d.toString("utf8")));
  }

  async aguardar(padrao, timeoutMs = 5000) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeoutMs) {
      const novo = this.buffer.substring(this.lido);
      const m = novo.match(padrao);
      if (m) {
        const fimMatch = (m.index ?? 0) + m[0].length;
        this.lido += fimMatch;
        return novo.substring(0, fimMatch);
      }
      await esperar(25);
    }
    throw new Error(`Timeout aguardando padrao ${padrao} apos: ...${this.buffer.slice(-300)}`);
  }

  enviarLinha(linha) {
    this.proc.stdin.write(linha + "\n");
  }

  async comando(linha, timeoutMs = 5000) {
    this.enviarLinha(linha);
    const novo = await this.aguardar(/greencode>\s*$/, timeoutMs);
    return novo.replace(/greencode>\s*$/, "");
  }

  encerrar() {
    try {
      this.proc.stdin.end();
      this.proc.kill();
    } catch {
      /* ignore */
    }
  }
}

async function testeProvisionamentoComSenhaFraca() {
  console.log("\n1) Rejeicao de senha fraca no provisionamento");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "greencode-sec-"));
  const cli = new DriverCLI(dir);
  await cli.aguardar(/Defina o nome de usuario do administrador/);
  cli.enviarLinha("admin1");
  await esperar(60);
  cli.enviarLinha("123"); // senha fraca: curta, sem maiuscula
  await esperar(60);
  cli.enviarLinha("123");
  const out = await cli.aguardar(/ERRO|Provisionamento concluido/, 4000);
  afirmar(/ERRO/.test(out), "senha fraca ('123') foi rejeitada no provisionamento");
  cli.encerrar();
}

async function testeLoginInvalido() {
  console.log("\n2) Login com credenciais invalidas");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "greencode-sec-"));
  const cli = new DriverCLI(dir);
  await cli.aguardar(/Defina o nome de usuario do administrador/);
  cli.enviarLinha("admin1");
  await esperar(60);
  cli.enviarLinha("SenhaForte1");
  await esperar(60);
  cli.enviarLinha("SenhaForte1");
  await cli.aguardar(/Provisionamento concluido/);
  await cli.aguardar(/Usuario:/);

  // 1a tentativa: senha incorreta
  cli.enviarLinha("admin1");
  await esperar(60);
  cli.enviarLinha("SenhaErrada9");
  let out = await cli.aguardar(/(\[ERRO\].*|Login efetuado.*)\n/, 4000);
  afirmar(/ERRO/.test(out) && /invalidos/.test(out), "login com senha incorreta foi rejeitado");
  await cli.aguardar(/greencode>\s*$/);

  // 2a tentativa: usuario inexistente, via comando 'login'
  cli.enviarLinha("login");
  await cli.aguardar(/Usuario:/);
  cli.enviarLinha("usuario_inexistente");
  await esperar(60);
  cli.enviarLinha("QualquerSenha1");
  out = await cli.aguardar(/(\[ERRO\].*|Login efetuado.*)\n/, 4000);
  afirmar(/ERRO/.test(out) && /invalidos/.test(out), "login com usuario inexistente foi rejeitado");
  await cli.aguardar(/greencode>\s*$/);

  // 3a tentativa: credenciais corretas, deve funcionar normalmente
  cli.enviarLinha("login");
  await cli.aguardar(/Usuario:/);
  cli.enviarLinha("admin1");
  await esperar(60);
  cli.enviarLinha("SenhaForte1");
  await cli.aguardar(/Login efetuado.*admin/);
  await cli.aguardar(/greencode>\s*$/);
  afirmar(true, "login com credenciais corretas apos falhas anteriores funciona normalmente");

  cli.encerrar();
  return dir;
}

async function testeUsuarioDesativado() {
  console.log("\n3) Usuario desativado nao consegue mais logar");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "greencode-sec-"));
  const cli = new DriverCLI(dir);
  await cli.aguardar(/Defina o nome de usuario do administrador/);
  cli.enviarLinha("admin1");
  await esperar(60);
  cli.enviarLinha("SenhaForte1");
  await esperar(60);
  cli.enviarLinha("SenhaForte1");
  await cli.aguardar(/Provisionamento concluido/);
  await cli.aguardar(/Usuario:/);
  cli.enviarLinha("admin1");
  await esperar(60);
  cli.enviarLinha("SenhaForte1");
  await cli.aguardar(/Login efetuado.*admin/);
  await cli.aguardar(/greencode>\s*$/);

  let out = await cli.comando("usuario criar temp1 --senha SenhaTemp1 --papel auditor");
  afirmar(out.includes("criado com papel"), "usuario temporario criado");

  // Renomear: validacoes e efeito real no login.
  out = await cli.comando("usuario renomear temp1 ab");
  afirmar(/ERRO/.test(out), "renomear rejeita novo nome com menos de 3 caracteres");
  out = await cli.comando("usuario renomear temp1 admin1");
  afirmar(/ja existe/.test(out), "renomear rejeita nome ja existente");
  out = await cli.comando("usuario renomear inexistente novo1");
  afirmar(/nao encontrado/.test(out), "renomear rejeita usuario inexistente");
  out = await cli.comando("usuario renomear temp1 temp2");
  afirmar(out.includes("renomeado para 'temp2'"), "usuario renomeado pelo administrador");
  out = await cli.comando("usuario listar");
  afirmar(out.includes("temp2") && !out.includes("temp1 |"), "listagem reflete o novo nome");

  out = await cli.comando("usuario desativar temp2");
  afirmar(out.includes("desativado"), "usuario temporario desativado pelo administrador");

  cli.enviarLinha("logout");
  await cli.aguardar(/Logout efetuado/);
  await cli.aguardar(/Usuario:/);
  cli.enviarLinha("temp2");
  await esperar(60);
  cli.enviarLinha("SenhaTemp1");
  out = await cli.aguardar(/(\[ERRO\].*|Login efetuado.*)\n/, 4000);
  afirmar(/ERRO/.test(out) && /invalidos/.test(out), "usuario desativado foi impedido de logar");

  cli.encerrar();
}

async function testePermissoesCruzadas() {
  console.log("\n4) Permissoes cruzadas entre papeis (RBAC)");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "greencode-sec-"));
  const cli = new DriverCLI(dir);
  await cli.aguardar(/Defina o nome de usuario do administrador/);
  cli.enviarLinha("admin1");
  await esperar(60);
  cli.enviarLinha("SenhaForte1");
  await esperar(60);
  cli.enviarLinha("SenhaForte1");
  await cli.aguardar(/Provisionamento concluido/);
  await cli.aguardar(/Usuario:/);
  cli.enviarLinha("admin1");
  await esperar(60);
  cli.enviarLinha("SenhaForte1");
  await cli.aguardar(/Login efetuado.*admin/);
  await cli.aguardar(/greencode>\s*$/);

  await cli.comando("usuario criar cad1 --senha CadSenha1 --papel cadastro");
  await cli.comando("usuario criar alm1 --senha AlmSenha1 --papel almoxarifado");

  cli.enviarLinha("logout");
  await cli.aguardar(/Logout efetuado/);
  await cli.aguardar(/Usuario:/);
  cli.enviarLinha("cad1");
  await esperar(60);
  cli.enviarLinha("CadSenha1");
  await cli.aguardar(/Login efetuado.*cadastro/);
  await cli.aguardar(/greencode>\s*$/);

  let out = await cli.comando("equipamento cadastrar --lote qualquer --codigo BC1 --tipo terminal");
  afirmar(
    /PERMISSAO NEGADA/.test(out),
    "operador de cadastro foi bloqueado de cadastrar equipamentos (fora de sua alcada)"
  );

  out = await cli.comando("usuario criar outro --senha OutraSenha1 --papel auditor");
  afirmar(
    /PERMISSAO NEGADA/.test(out),
    "operador de cadastro foi bloqueado de criar usuarios (acao exclusiva do administrador)"
  );

  cli.enviarLinha("logout");
  await cli.aguardar(/Logout efetuado/);
  await cli.aguardar(/Usuario:/);
  cli.enviarLinha("alm1");
  await esperar(60);
  cli.enviarLinha("AlmSenha1");
  await cli.aguardar(/Login efetuado.*almoxarifado/);
  await cli.aguardar(/greencode>\s*$/);

  out = await cli.comando('org criar --cnpj 11222333000181 --razao "Teste"');
  afirmar(
    /PERMISSAO NEGADA/.test(out),
    "gestor de almoxarifado foi bloqueado de cadastrar organizacoes (fora de sua alcada)"
  );

  // --- Papel auditor: leitura ampla, escrita totalmente bloqueada -------
  cli.enviarLinha("logout");
  await cli.aguardar(/Logout efetuado/);
  await cli.aguardar(/Usuario:/);
  cli.enviarLinha("admin1");
  await esperar(60);
  cli.enviarLinha("SenhaForte1");
  await cli.aguardar(/Login efetuado.*admin/);
  await cli.aguardar(/greencode>\s*$/);

  await cli.comando("usuario criar aud1 --senha AudSenha1 --papel auditor");
  await cli.comando('org criar --cnpj 11444777000161 --razao "Org Para Auditor"');
  await cli.comando("contrato criar --org 11444777000161 --inicio 2026-01-05");
  await cli.comando("lote criar --org 11444777000161 --nf 321 --transp T9");

  cli.enviarLinha("logout");
  await cli.aguardar(/Logout efetuado/);
  await cli.aguardar(/Usuario:/);
  cli.enviarLinha("aud1");
  await esperar(60);
  cli.enviarLinha("AudSenha1");
  await cli.aguardar(/Login efetuado.*auditor/);
  await cli.aguardar(/greencode>\s*$/);

  out = await cli.comando("org listar");
  afirmar(
    out.includes("Org Para Auditor"),
    "auditor CONSEGUE consultar 'org listar' (leitura ampla, nao apenas rastreio)"
  );

  out = await cli.comando("contrato listar");
  afirmar(!/PERMISSAO NEGADA|ERRO/.test(out), "auditor CONSEGUE consultar 'contrato listar'");

  out = await cli.comando("lote listar");
  afirmar(!/PERMISSAO NEGADA|ERRO/.test(out), "auditor CONSEGUE consultar 'lote listar'");

  out = await cli.comando('org criar --cnpj 11222333000181 --razao "Tentativa Auditor"');
  afirmar(/PERMISSAO NEGADA|somente de consulta/.test(out), "auditor e bloqueado de 'org criar' (escrita)");

  out = await cli.comando("contrato criar --org 11444777000161 --inicio 2026-02-01");
  afirmar(/PERMISSAO NEGADA|somente de consulta/.test(out), "auditor e bloqueado de 'contrato criar' (escrita)");

  out = await cli.comando("lote status inexistente --novo em_triagem");
  afirmar(/PERMISSAO NEGADA|somente de consulta/.test(out), "auditor e bloqueado de 'lote status' (escrita)");

  out = await cli.comando('usuario criar hacker1 --senha Hacker123 --papel admin');
  afirmar(/PERMISSAO NEGADA/.test(out), "auditor continua bloqueado do recurso 'usuario' por completo (nem leitura)");

  out = await cli.comando("config set qualquer 1");
  afirmar(/PERMISSAO NEGADA/.test(out), "auditor continua bloqueado do recurso 'config' por completo (nem leitura)");

  cli.encerrar();
}

async function testeComandoDesconhecidoNaoDerrubaProcesso() {
  console.log("\n5) Comando desconhecido e tratado sem encerrar o processo");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "greencode-sec-"));
  const cli = new DriverCLI(dir);
  await cli.aguardar(/Defina o nome de usuario do administrador/);
  cli.enviarLinha("admin1");
  await esperar(60);
  cli.enviarLinha("SenhaForte1");
  await esperar(60);
  cli.enviarLinha("SenhaForte1");
  await cli.aguardar(/Provisionamento concluido/);
  await cli.aguardar(/Usuario:/);
  cli.enviarLinha("admin1");
  await esperar(60);
  cli.enviarLinha("SenhaForte1");
  await cli.aguardar(/Login efetuado.*admin/);
  await cli.aguardar(/greencode>\s*$/);

  let out = await cli.comando("recurso_que_nao_existe fazer_algo");
  afirmar(/ERRO/.test(out) && /Recurso desconhecido/.test(out), "recurso inexistente retorna erro tratado");

  out = await cli.comando("usuario listar");
  afirmar(out.includes("admin1"), "processo continua respondendo normalmente apos o erro anterior");

  cli.encerrar();
}

async function main() {
  await testeProvisionamentoComSenhaFraca();
  await testeLoginInvalido();
  await testeUsuarioDesativado();
  await testePermissoesCruzadas();
  await testeComandoDesconhecidoNaoDerrubaProcesso();

  console.log(`\nResumo: ${passos - falhas}/${passos} verificacoes OK.`);
  if (falhas > 0) {
    console.error(`\n${falhas} verificacao(oes) FALHARAM.`);
    process.exit(1);
  } else {
    console.log("\nTodas as verificacoes passaram.");
    process.exit(0);
  }
}

main().catch((e) => {
  console.error("Erro fatal no teste de seguranca:", e);
  process.exit(1);
});
