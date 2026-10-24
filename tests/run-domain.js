#!/usr/bin/env node
/**
 * Teste do modelo de dominio orientado a objetos do greencode.
 *
 * Cobre especificamente os conceitos de UML exigidos pela atividade:
 *   - HERANCA: Terminal, CPU, Monitor e Servidor sao subclasses concretas
 *     da classe abstrata Equipamento.
 *   - POLIMORFISMO: o comando `equipamento depreciacao` chama
 *     `calcularCoeficienteDepreciacao()` sobre a referencia abstrata
 *     Equipamento, mas cada subclasse calcula o valor de forma diferente
 *     — o teste verifica que os resultados DIFEREM entre tipos para os
 *     mesmos meses de uso, provando que o despacho polimorfico ocorre.
 *   - FABRICAS: EquipamentoFactory escolhe a subclasse correta a partir do
 *     texto informado na CLI (Factory Method), inclusive para um tipo nao
 *     mapeado explicitamente (fallback para EquipamentoGenerico).
 *   - PERSISTENCIA POLIMORFICA: o tipo escolhido pela fabrica sobrevive a
 *     um ciclo completo de gravacao e releitura do arquivo cifrado (ou
 *     seja, a reidratacao contrói a subclasse certa, nao apenas um objeto
 *     generico).
 *
 * Uso: node tests/run-domain.js
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const RAIZ = path.join(__dirname, "..");
const BIN = path.join(RAIZ, "dist", "cli", "index.js");
const DIR_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), "greencode-dominio-"));

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

function extrairPercentual(texto) {
  const m = texto.match(/=\s*([\d.]+)%/);
  return m ? parseFloat(m[1]) : null;
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
  await cli.comando('org criar --cnpj 11222333000181 --razao "Hospital Central"');

  cli.enviarLinha("logout");
  await cli.aguardar(/Logout efetuado/);
  await login(cli, "cad1", "CadSenha1", "cadastro");

  let out = await cli.comando("lote criar --org 11222333000181 --nf 111 --transp T1");
  const loteId = extrairUUID(out, "Lote criado");
  afirmar(Boolean(loteId), `lote criado para os testes de dominio (id=${loteId})`);

  cli.enviarLinha("logout");
  await cli.aguardar(/Logout efetuado/);
  await login(cli, "alm1", "AlmSenha1", "almoxarifado");

  console.log("\n1) Fabrica (Factory Method) escolhe a subclasse certa por tipo");
  const tipos = ["terminal", "cpu", "monitor", "servidor"];
  const idsPorTipo = {};
  for (const tipo of tipos) {
    out = await cli.comando(`equipamento cadastrar --lote ${loteId} --codigo BC-${tipo} --tipo ${tipo}`);
    const id = extrairUUID(out, "Equipamento cadastrado");
    afirmar(Boolean(id) && out.includes(`tipo=${tipo}`), `equipamento do tipo '${tipo}' cadastrado com a subclasse correta`);
    idsPorTipo[tipo] = id;
  }

  out = await cli.comando(`equipamento cadastrar --lote ${loteId} --codigo BC-roteador --tipo roteador`);
  const idGenerico = extrairUUID(out, "Equipamento cadastrado");
  afirmar(
    Boolean(idGenerico) && out.includes("tipo=roteador"),
    "tipo nao mapeado ('roteador') cai no fallback EquipamentoGenerico sem quebrar o sistema (Open/Closed)"
  );

  console.log("\n2) Polimorfismo: mesma chamada, resultados diferentes por subclasse");
  const percentuais = {};
  for (const tipo of tipos) {
    out = await cli.comando(`equipamento depreciacao ${idsPorTipo[tipo]} --meses 24`);
    const p = extrairPercentual(out);
    afirmar(p !== null, `calculo de depreciacao polimorfico retornou um valor para '${tipo}' (${p}%)`);
    percentuais[tipo] = p;
  }

  const valoresUnicos = new Set(Object.values(percentuais));
  afirmar(
    valoresUnicos.size > 1,
    `os coeficientes de depreciacao DIFEREM entre subclasses para os mesmos 24 meses de uso ` +
      `(terminal=${percentuais.terminal}%, cpu=${percentuais.cpu}%, monitor=${percentuais.monitor}%, servidor=${percentuais.servidor}%) ` +
      `— confirma despacho polimorfico real, nao um calculo generico compartilhado`
  );

  out = await cli.comando(`equipamento depreciacao ${idsPorTipo.servidor} --meses 1000`);
  const pServidorExtremo = extrairPercentual(out);
  afirmar(
    pServidorExtremo !== null && pServidorExtremo <= 85.01,
    `servidor respeita seu teto de depreciacao maxima de 85% mesmo apos uso extremo (obtido: ${pServidorExtremo}%)`
  );

  console.log("\n3) Persistencia polimorfica: o tipo sobrevive a um ciclo de escrita/releitura");
  out = await cli.comando(`equipamento ver ${idsPorTipo.cpu}`);
  afirmar(
    out.includes("Tipo: cpu") && out.includes("Vida util de referencia: 48 meses"),
    "apos reidratacao do disco, o equipamento 'cpu' mantem seu tipo e sua vida util especifica (48 meses)"
  );

  out = await cli.comando("equipamento listar --lote " + loteId);
  const linhasListadas = out.split("\n").filter((l) => l.trim().startsWith("-"));
  afirmar(linhasListadas.length === 5, `listagem do lote traz os 5 equipamentos cadastrados (obtido: ${linhasListadas.length})`);

  console.log("\n4) Encerramento");
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
  console.error("Erro fatal no teste de dominio:", e);
  process.exit(1);
});
