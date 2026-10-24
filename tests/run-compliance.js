#!/usr/bin/env node
/**
 * Teste de conformidade com a especificacao original (AV1.pdf):
 *
 *   1. CONTRATO DE COLETA: o PDF exige que o operador de cadastro "insira
 *      novas organizacoes clientes e seus respectivos contratos de
 *      coleta" — este teste cria uma organizacao, um contrato associado a
 *      ela, consulta o contrato, lista contratos por organizacao e
 *      encerra o contrato.
 *
 *   2. ALOCACAO AUTOMATICA DE CODIGO DE BARRAS: o PDF descreve o gestor
 *      de almoxarifado fazendo "a alocacao de codigos de barras
 *      internos" — este teste cadastra um equipamento SEM informar
 *      --codigo e confirma que o sistema aloca um codigo interno unico
 *      automaticamente, e que dois cadastros sem --codigo nunca colidem.
 *
 * Uso: node tests/run-compliance.js
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const RAIZ = path.join(__dirname, "..");
const BIN = path.join(RAIZ, "dist", "cli", "index.js");
const DIR_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), "greencode-conformidade-"));

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
  constructor() {
    this.proc = spawn(process.execPath, [BIN], {
      cwd: RAIZ,
      env: { ...process.env, GREENCODE_DATA_DIR: DIR_DADOS },
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

function extrairUUID(texto, rotulo) {
  const m = texto.match(new RegExp(`${rotulo}:?\\s*([a-f0-9-]{36})`));
  return m ? m[1] : null;
}

async function login(cli, usuario, senha, papelEsperadoRegex) {
  await cli.aguardar(/Usuario:/);
  cli.enviarLinha(usuario);
  await esperar(60);
  cli.enviarLinha(senha);
  await cli.aguardar(new RegExp(`Login efetuado.*${papelEsperadoRegex}`));
  await cli.aguardar(/greencode>\s*$/);
}

async function main() {
  console.log(`Diretorio de dados temporario: ${DIR_DADOS}`);
  const cli = new DriverCLI();

  await cli.aguardar(/Defina o nome de usuario do administrador/);
  cli.enviarLinha("admin1");
  await esperar(60);
  cli.enviarLinha("SenhaAdm1");
  await esperar(60);
  cli.enviarLinha("SenhaAdm1");
  await cli.aguardar(/Provisionamento concluido/);
  await login(cli, "admin1", "SenhaAdm1", "admin");

  await cli.comando("usuario criar cad1 --senha CadSenha1 --papel cadastro");
  await cli.comando("usuario criar alm1 --senha AlmSenha1 --papel almoxarifado");

  cli.enviarLinha("logout");
  await cli.aguardar(/Logout efetuado/);
  await login(cli, "cad1", "CadSenha1", "cadastro");

  console.log("\n1) Contrato de coleta associado a uma organizacao");
  let out = await cli.comando('org criar --cnpj 11222333000181 --razao "Hospital Central"');
  afirmar(out.includes("Organizacao criada"), "organizacao criada com sucesso");

  out = await cli.comando(
    'contrato criar --org 11222333000181 --inicio 2026-01-10 --frequencia 15 --condicoes "coleta quinzenal, turno da manha"'
  );
  const contratoId = extrairUUID(out, "Contrato de coleta criado");
  afirmar(
    Boolean(contratoId) && out.includes("frequencia=15"),
    `contrato de coleta criado e associado a organizacao (id=${contratoId})`
  );

  out = await cli.comando("contrato criar --org 00000000000000 --inicio 2026-01-10");
  afirmar(
    /ERRO/.test(out) && /nao encontrada/.test(out),
    "contrato rejeitado quando a organizacao referenciada nao existe"
  );

  out = await cli.comando(`contrato ver ${contratoId}`);
  afirmar(
    out.includes("Frequencia de coleta: 15 dia(s)") && out.includes("Ativo: true"),
    "consulta do contrato retorna os dados completos e status ativo"
  );

  out = await cli.comando("contrato listar --org 11222333000181");
  afirmar(out.includes(contratoId), "contrato aparece na listagem filtrada pela organizacao");

  out = await cli.comando(`contrato encerrar ${contratoId}`);
  afirmar(out.includes("encerrado"), "contrato pode ser encerrado");

  out = await cli.comando(`contrato ver ${contratoId}`);
  afirmar(out.includes("Ativo: false"), "apos encerrado, o contrato reflete ativo=false (historico preservado, nao removido)");

  console.log("\n2) Alocacao automatica de codigo de barras interno");
  out = await cli.comando("lote criar --org 11222333000181 --nf 555 --transp T1");
  const loteId = extrairUUID(out, "Lote criado");
  afirmar(Boolean(loteId), `lote criado para o teste de alocacao de codigo (id=${loteId})`);

  cli.enviarLinha("logout");
  await cli.aguardar(/Logout efetuado/);
  await login(cli, "alm1", "AlmSenha1", "almoxarifado");

  out = await cli.comando(`equipamento cadastrar --lote ${loteId} --tipo monitor`);
  const equipId1 = extrairUUID(out, "Equipamento cadastrado");
  const codigo1 = (out.match(/codigo=(\S+)/) || [])[1];
  afirmar(
    Boolean(equipId1) && Boolean(codigo1) && codigo1.startsWith("INT-"),
    `equipamento cadastrado SEM --codigo recebeu um codigo interno alocado automaticamente (${codigo1})`
  );

  out = await cli.comando(`equipamento cadastrar --lote ${loteId} --tipo monitor`);
  const codigo2 = (out.match(/codigo=(\S+)/) || [])[1];
  afirmar(
    Boolean(codigo2) && codigo2 !== codigo1,
    `um segundo cadastro sem --codigo recebe um codigo interno DIFERENTE do primeiro (unicidade garantida) (${codigo2})`
  );

  out = await cli.comando(`equipamento cadastrar --lote ${loteId} --codigo ETQ-FABRICA-001 --tipo terminal`);
  afirmar(
    out.includes("codigo=ETQ-FABRICA-001"),
    "informar --codigo explicitamente ainda funciona normalmente (nao obrigatorio, mas suportado)"
  );

  console.log("\n3) Encerramento");
  cli.enviarLinha("sair");
  await esperar(200);
  cli.encerrar();

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
  console.error("Erro fatal no teste de conformidade:", e);
  process.exit(1);
});
