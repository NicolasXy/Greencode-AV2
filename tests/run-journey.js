#!/usr/bin/env node
/**
 * Teste de jornada completa do greencode.
 *
 * Simula, de ponta a ponta, via a propria CLI (sem acessar o storage
 * diretamente), o seguinte fluxo:
 *   1. Provisionamento inicial (cria o admin e a chave mestra).
 *   2. Login como administrador; criacao dos demais usuarios (cadastro,
 *      almoxarifado, auditor).
 *   3. Cadastro de organizacoes, incluindo CNPJs INVALIDOS (devem falhar).
 *   4. Login como operador de cadastro; criacao de um lote valido e de um
 *      lote com data futura (deve falhar).
 *   5. Login como gestor de almoxarifado; cadastro de um equipamento,
 *      tentativa de ir direto para 'desmonte' sem triagem (deve falhar),
 *      conclusao da triagem, movimentacao para 'desmonte' (deve funcionar),
 *      alteracao de estado fisico com queda de 2+ categorias sem
 *      justificativa (deve falhar) e com justificativa (deve funcionar).
 *   6. Login como auditor; consulta de rastreabilidade do equipamento e do
 *      journal, e tentativa de escrita (deve falhar por permissao).
 *   7. Verificacao de que o journal foi gravado em disco (arquivo
 *      imutavel, append-only) e que os arquivos de dados estao cifrados
 *      (nao contêm texto plano reconhecivel).
 *
 * Uso: node tests/run-journey.js
 * Sai com codigo 0 se todas as expectativas forem atendidas; codigo != 0 e
 * uma mensagem de diagnostico caso alguma etapa falhe.
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const RAIZ = path.join(__dirname, "..");
const BIN = path.join(RAIZ, "dist", "cli", "index.js");
const DIR_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), "greencode-teste-"));

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

/**
 * Driver interativo do processo CLI. Mantem um cursor de leitura (`lido`) para
 * que cada espera/leitura considere apenas o texto NOVO produzido desde a
 * ultima operacao, evitando falsos positivos causados por texto de prompts
 * anteriores que permanecem no buffer acumulado.
 */
class DriverCLI {
  constructor() {
    this.proc = spawn(process.execPath, [BIN], {
      cwd: RAIZ,
      env: { ...process.env, GREENCODE_DATA_DIR: DIR_DADOS },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.buffer = "";
    this.lido = 0;
    this.proc.stdout.on("data", (d) => {
      this.buffer += d.toString("utf8");
    });
    this.proc.stderr.on("data", (d) => {
      this.buffer += d.toString("utf8");
    });
  }

  /**
   * Aguarda que um padrao apareca no texto NOVO (a partir do cursor) e avanca
   * o cursor apenas ate o FIM DA CORRESPONDENCIA (nao ate o fim do buffer),
   * preservando qualquer texto que ja tenha chegado logo em seguida (ex.: o
   * proximo prompt, que pode chegar no mesmo chunk de stdout).
   */
  async aguardar(padrao, timeoutMs = 5000) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeoutMs) {
      const novo = this.buffer.substring(this.lido);
      const m = novo.match(padrao);
      if (m) {
        const fimMatch = (m.index ?? 0) + m[0].length;
        const consumido = novo.substring(0, fimMatch);
        this.lido += fimMatch;
        return consumido;
      }
      await esperar(25);
    }
    throw new Error(`Timeout aguardando padrao ${padrao} apos: ...${this.buffer.slice(-300)}`);
  }

  enviarLinha(linha) {
    this.proc.stdin.write(linha + "\n");
  }

  /** Envia uma linha de comando e aguarda o proximo prompt, retornando o texto NOVO produzido (sem o proprio prompt). */
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

async function logout(cli) {
  cli.enviarLinha("logout");
  await cli.aguardar(/Logout efetuado/);
}

async function main() {
  console.log(`Diretorio de dados temporario: ${DIR_DADOS}`);
  const cli = new DriverCLI();

  await cli.aguardar(/Defina o nome de usuario do administrador/);

  console.log("\n1) Provisionamento inicial");
  cli.enviarLinha("admin1");
  await esperar(60);
  cli.enviarLinha("SenhaAdm1");
  await esperar(60);
  cli.enviarLinha("SenhaAdm1");
  await cli.aguardar(/Provisionamento concluido/);
  afirmar(true, "provisionamento concluido com sucesso");

  console.log("\n2) Login como administrador e criacao de usuarios");
  await login(cli, "admin1", "SenhaAdm1", "admin");
  afirmar(true, "login do administrador efetuado");

  let out = await cli.comando("usuario criar cad1 --senha CadSenha1 --papel cadastro");
  afirmar(out.includes("criado com papel 'cadastro'"), "usuario de cadastro criado");

  out = await cli.comando("usuario criar alm1 --senha AlmSenha1 --papel almoxarifado");
  afirmar(out.includes("criado com papel 'almoxarifado'"), "usuario de almoxarifado criado");

  out = await cli.comando("usuario criar aud1 --senha AudSenha1 --papel auditor");
  afirmar(out.includes("criado com papel 'auditor'"), "usuario auditor criado");

  console.log("\n3) Cadastro de organizacoes (com validacao de CNPJ)");
  out = await cli.comando('org criar --cnpj 11222333000181 --razao "Hospital Central"');
  afirmar(out.includes("Organizacao criada"), "organizacao com CNPJ valido criada");

  out = await cli.comando('org criar --cnpj 11111111111111 --razao "CNPJ Invalido"');
  afirmar(/ERRO/.test(out) && /CNPJ/.test(out), "CNPJ com sequencia repetida (invalido) foi rejeitado");

  out = await cli.comando('org criar --cnpj 11222333000199 --razao "Digitos verificadores errados"');
  afirmar(
    /ERRO/.test(out) && /digitos verificadores/.test(out),
    "CNPJ com digitos verificadores incorretos foi rejeitado"
  );

  console.log("\n4) Login como operador de cadastro e criacao de lotes");
  await logout(cli);
  await login(cli, "cad1", "CadSenha1", "cadastro");

  out = await cli.comando("lote criar --org 11222333000181 --nf 123456 --transp TransRapida");
  const loteId = extrairUUID(out, "Lote criado");
  afirmar(Boolean(loteId), `lote valido criado (id=${loteId})`);

  out = await cli.comando("lote criar --org 11222333000181 --nf 999999 --transp TransX --data 2099-01-01");
  afirmar(/ERRO/.test(out) && /futura/.test(out), "lote com data de entrada futura foi rejeitado");

  console.log("\n5) Login como gestor de almoxarifado e ciclo de vida do equipamento");
  await logout(cli);
  await login(cli, "alm1", "AlmSenha1", "almoxarifado");

  out = await cli.comando(`equipamento cadastrar --lote ${loteId} --codigo BC0001 --tipo terminal`);
  const equipId = extrairUUID(out, "Equipamento cadastrado");
  afirmar(Boolean(equipId), `equipamento cadastrado (id=${equipId})`);

  out = await cli.comando(`equipamento mover ${equipId} --status desmonte`);
  afirmar(
    /ERRO/.test(out) && /triagem completa/.test(out),
    "equipamento sem triagem completa foi bloqueado de ir para 'desmonte'"
  );

  out = await cli.comando(`equipamento triagem ${equipId}`);
  afirmar(out.includes("Triagem concluida"), "triagem concluida com sucesso");

  out = await cli.comando(`equipamento mover ${equipId} --status desmonte`);
  afirmar(out.includes("movido para status 'desmonte'"), "equipamento movido para 'desmonte' apos triagem");

  out = await cli.comando(`equipamento estado ${equipId} --novo seminovo`);
  afirmar(out.includes("Estado fisico"), "queda de 1 categoria (novo->seminovo) aceita sem exigir justificativa");

  out = await cli.comando(`equipamento estado ${equipId} --novo sucata`);
  afirmar(
    /ERRO/.test(out) && /justificativa/.test(out),
    "queda de 2+ categorias no estado fisico foi bloqueada sem justificativa"
  );

  out = await cli.comando(
    `equipamento estado ${equipId} --novo sucata --justificativa "dano severo identificado na desmontagem"`
  );
  afirmar(out.includes("Estado fisico"), "queda de 2+ categorias aceita com justificativa textual");

  console.log("\n6) Login como auditor (somente leitura) e rastreabilidade");
  await logout(cli);
  await login(cli, "aud1", "AudSenha1", "auditor");

  out = await cli.comando(`rastreio equipamento ${equipId}`);
  const linhasMovimentacao = out.split("\n").filter((l) => l.includes("->")).length;
  afirmar(linhasMovimentacao >= 3, `rastreabilidade mostra o historico completo (${linhasMovimentacao} movimentacoes)`);

  out = await cli.comando("rastreio journal --ultimas 5");
  afirmar(out.trim().length > 0 && !/ERRO/.test(out), "auditor consulta o journal de transacoes");

  out = await cli.comando('org criar --cnpj 11222333000181 --razao "tentativa auditor"');
  afirmar(
    /PERMISSAO NEGADA|somente de consulta/.test(out),
    "auditor foi bloqueado de executar operacao de escrita"
  );

  console.log("\n7) Verificacoes de persistencia (journal imutavel e dados cifrados em disco)");
  const jornalDir = path.join(DIR_DADOS, "journal");
  const arquivosJournal = fs.readdirSync(jornalDir).filter((f) => f.startsWith("journal"));
  afirmar(arquivosJournal.length > 0, "arquivo(s) de journal foram gravados em disco");

  const conteudoJournal = fs.readFileSync(path.join(jornalDir, "journal.log"), "utf8");
  afirmar(
    conteudoJournal.includes("LOGIN_SUCESSO") && conteudoJournal.includes("EQUIPAMENTO_TRIAGEM_COMPLETA"),
    "journal contem entradas legiveis (write-ahead log) para as operacoes realizadas"
  );

  const orgArquivo = path.join(DIR_DADOS, "organizacoes.dat");
  const cruOrg = fs.readFileSync(orgArquivo, "utf8");
  afirmar(
    !cruOrg.includes("Hospital Central") && !cruOrg.includes("11222333000181"),
    "arquivo de organizacoes esta cifrado em disco (dados de negocio nao aparecem em texto plano)"
  );

  const credArquivo = path.join(DIR_DADOS, "credenciais.dat");
  const cruCred = fs.readFileSync(credArquivo, "utf8");
  afirmar(
    !cruCred.includes("SenhaAdm1") && !cruCred.includes("CadSenha1"),
    "arquivo de credenciais esta cifrado em disco (senhas em texto plano nao aparecem)"
  );

  console.log("\n8) Encerramento");
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
  console.error("Erro fatal no teste de jornada:", e);
  process.exit(1);
});
