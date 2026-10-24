#!/usr/bin/env node
/**
 * Testes da API HTTP do greencode (AV2): Fastify + Prisma + PostgreSQL.
 *
 * Cria um banco temporario, aplica as migracoes SQL de prisma/migrations,
 * sobe o app em memoria (app.inject) e verifica: autenticacao JWT,
 * autorizacao por papel, validacao por JSON Schema, regras de negocio,
 * transacoes atomicas, versionamento otimista (inclusive concorrencia real),
 * restricoes de unicidade/CHECK/triggers do banco, seed e graceful shutdown.
 *
 * Requer um PostgreSQL acessivel. Variavel opcional:
 *   TEST_DATABASE_ADMIN_URL (padrao postgresql://greencode:greencode@localhost:5432/postgres)
 * O usuario precisa poder criar bancos (CREATEDB). Codigo de saida 3 = pulado
 * (PostgreSQL indisponivel).
 *
 * Uso: node tests/run-api.js   (apos npm run build)
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const { Client } = require("pg");

const RAIZ = path.join(__dirname, "..");
const DIST = path.join(RAIZ, "dist", "server");
const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL || "postgresql://greencode:greencode@localhost:5432/postgres";
const NOME_BANCO = `greencode_test_${crypto.randomBytes(4).toString("hex")}`;
const URL_BANCO = (() => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${NOME_BANCO}`;
  return u.toString();
})();
const SEGREDO = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres!";

let falhas = 0;
let passos = 0;
function afirmar(cond, msg) {
  passos++;
  if (cond) console.log(`  [PASS] ${msg}`);
  else {
    falhas++;
    console.log(`  [FAIL] ${msg}`);
  }
}
const titulo = (t) => console.log(`\n${t}`);

function dataRel(dias) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().substring(0, 10);
}
function cnpjValido(base12) {
  const dv = (dig, pesos) => {
    const s = dig.split("").reduce((a, d, i) => a + Number(d) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${d2}`;
}

async function aplicarMigracoes(client) {
  const dir = path.join(RAIZ, "prisma", "migrations");
  const pastas = fs.readdirSync(dir).filter((p) => fs.statSync(path.join(dir, p)).isDirectory()).sort();
  for (const p of pastas) await client.query(fs.readFileSync(path.join(dir, p, "migration.sql"), "utf8"));
  return pastas.length;
}

async function main() {
  // ---- Preparacao: banco temporario ----
  const admin = new Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
  } catch (e) {
    console.log(`PULADO: PostgreSQL indisponivel (${e.message}). Defina TEST_DATABASE_ADMIN_URL.`);
    process.exit(3);
  }
  await admin.query(`CREATE DATABASE "${NOME_BANCO}"`);
  const sql = new Client({ connectionString: URL_BANCO });
  await sql.connect();

  const { criarPrisma } = require(path.join(DIST, "db", "prisma"));
  const { criarApp } = require(path.join(DIST, "app"));
  let prisma, app;

  const config = {
    porta: 0, host: "127.0.0.1", databaseUrl: URL_BANCO, jwtSecret: SEGREDO, jwtExpiraEm: "30m",
    bcryptRounds: 4, corsOrigin: false, logLevel: "silent", encerramentoTimeoutMs: 3000,
  };

  try {
    titulo("1) Migracoes e restricoes do banco");
    const n = await aplicarMigracoes(sql);
    afirmar(n >= 2, `${n} migracoes SQL aplicadas em banco limpo`);
    prisma = criarPrisma(URL_BANCO);
    app = await criarApp(config, prisma);
    await app.ready();

    const req = async (method, url, token, body) => {
      const r = await app.inject({
        method, url: `/api/v1${url}`, payload: body,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      let json = null;
      try { json = r.json(); } catch {}
      return { status: r.statusCode, body: json };
    };

    titulo("2) Provisionamento e autenticacao JWT");
    let r = await req("POST", "/auth/provisionar", null, { username: "admin", senha: "fraca" });
    afirmar(r.status === 400, "provisionamento rejeita senha fraca (400)");
    r = await req("POST", "/auth/provisionar", null, { username: "admin", senha: "SenhaForte1" });
    afirmar(r.status === 201 && !JSON.stringify(r.body).includes("senhaHash"), "primeiro admin criado (201) sem expor o hash");
    r = await req("POST", "/auth/provisionar", null, { username: "outro", senha: "SenhaForte1" });
    afirmar(r.status === 409, "provisionamento so funciona uma vez (409)");
    const hashNoBanco = (await sql.query(`SELECT "senhaHash" FROM "Usuario" WHERE username='admin'`)).rows[0].senhaHash;
    afirmar(/^\$2[aby]\$/.test(hashNoBanco), "senha armazenada como hash bcrypt");

    r = await req("POST", "/auth/login", null, { username: "admin", senha: "errada" });
    const msgErrada = r.body && r.body.mensagem;
    afirmar(r.status === 401, "login com senha errada retorna 401");
    r = await req("POST", "/auth/login", null, { username: "naoexiste", senha: "SenhaForte1" });
    afirmar(r.status === 401 && r.body.mensagem === msgErrada, "usuario inexistente retorna a MESMA mensagem generica");
    r = await req("POST", "/auth/login", null, { username: "admin", senha: "SenhaForte1" });
    afirmar(r.status === 200 && r.body.token && r.body.tipo === "Bearer", "login valido devolve JWT");
    const tAdmin = r.body.token;
    const payload = JSON.parse(Buffer.from(tAdmin.split(".")[1], "base64url").toString());
    afirmar(payload.sub && payload.papel === "admin" && payload.exp, "JWT contem id, papel e expiracao");

    r = await req("GET", "/organizacoes", null);
    afirmar(r.status === 401, "rota protegida sem token retorna 401");
    r = await req("GET", "/organizacoes", "token.invalido.aqui");
    afirmar(r.status === 401, "token invalido retorna 401");
    const adulterado = tAdmin.slice(0, -3) + (tAdmin.endsWith("AAA") ? "BBB" : "AAA");
    r = await req("GET", "/organizacoes", adulterado);
    afirmar(r.status === 401, "token com assinatura adulterada retorna 401");
    r = await req("GET", "/health", null);
    afirmar(r.status === 200, "/health e publico");

    // Token expirado: app separado com expiracao de 1 segundo.
    const appCurto = await criarApp({ ...config, jwtExpiraEm: "1s" }, prisma);
    await appCurto.ready();
    const lg = await appCurto.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", senha: "SenhaForte1" } });
    await new Promise((res) => setTimeout(res, 2200));
    const exp = await appCurto.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${lg.json().token}` } });
    afirmar(exp.statusCode === 401, "token expirado e rejeitado (401)");
    await appCurto.close();

    titulo("3) Usuarios e controle de acesso por papel (RBAC)");
    const mk = (u, p) => req("POST", "/usuarios", tAdmin, { username: u, senha: "SenhaForte1", papel: p });
    afirmar((await mk("cad1", "cadastro")).status === 201, "admin cria usuario de cadastro");
    afirmar((await mk("alm1", "almoxarifado")).status === 201, "admin cria usuario de almoxarifado");
    afirmar((await mk("aud1", "auditor")).status === 201, "admin cria auditor");
    afirmar((await mk("cad1", "cadastro")).status === 409, "username duplicado retorna 409");
    afirmar((await mk("x", "cadastro")).status === 400, "username curto rejeitado (400)");
    afirmar((await req("POST", "/usuarios", tAdmin, { username: "zzz", senha: "SenhaForte1", papel: "root" })).status === 400, "papel fora do enum rejeitado pelo JSON Schema");
    const login = async (u) => (await req("POST", "/auth/login", null, { username: u, senha: "SenhaForte1" })).body.token;
    const tCad = await login("cad1"), tAlm = await login("alm1"), tAud = await login("aud1");

    afirmar((await req("GET", "/usuarios", tCad)).status === 403, "cadastro nao lista usuarios (403)");
    afirmar((await req("GET", "/usuarios", tAdmin)).status === 200, "admin lista usuarios");
    afirmar((await req("GET", "/equipamentos", tCad)).status === 403, "cadastro nao acessa equipamentos (403)");
    const cnpjA = cnpjValido("112223330001");
    afirmar((await req("POST", "/organizacoes", tAlm, { cnpj: cnpjA, razaoSocial: "X" })).status === 403, "almoxarifado nao cadastra organizacao (403)");
    afirmar((await req("GET", "/auditoria", tCad)).status === 403, "cadastro nao le a auditoria (403)");
    afirmar((await req("GET", "/auditoria", tAud)).status === 200, "auditor le a auditoria");

    titulo("4) Organizacoes e contratos (validacao + unicidade)");
    r = await req("POST", "/organizacoes", tCad, { cnpj: "11.111.111/1111-11", razaoSocial: "Invalida" });
    afirmar(r.status === 400, "CNPJ com digitos verificadores invalidos rejeitado (400)");
    r = await req("POST", "/organizacoes", tCad, { razaoSocial: "Sem cnpj" });
    afirmar(r.status === 400, "campo obrigatorio ausente rejeitado pelo JSON Schema (400)");
    r = await req("POST", "/organizacoes", tCad, { cnpj: cnpjA, razaoSocial: "Alfa Ltda", contato: "a@alfa.example", campoExtra: 1 });
    afirmar(r.status === 201 && r.body.cnpj === cnpjA && r.body.versao === 1, "organizacao criada com CNPJ normalizado e versao 1");
    r = await req("POST", "/organizacoes", tAdmin, { cnpj: cnpjA, razaoSocial: "Duplicada" });
    afirmar(r.status === 409, "CNPJ duplicado retorna 409");
    r = await req("POST", "/contratos", tCad, { orgCnpj: cnpjA, dataInicio: dataRel(-10), frequenciaColetaDias: 30, clausulas: { multa: 2 } });
    afirmar(r.status === 201, "contrato criado (clausulas JSON)");
    const contratoId = r.body.id;
    r = await req("POST", "/contratos", tCad, { orgCnpj: cnpjA, dataInicio: dataRel(-10), frequenciaColetaDias: 30 });
    afirmar(r.status === 409, "segundo contrato para a mesma organizacao retorna 409");
    r = await req("POST", "/contratos", tCad, { orgCnpj: cnpjA, dataInicio: dataRel(-10), frequenciaColetaDias: 0 });
    afirmar(r.status === 400, "frequencia de coleta invalida rejeitada");

    titulo("5) Lotes e equipamentos: regras de negocio");
    const corpoLote = (nf, extra = {}) => ({ orgCnpj: cnpjA, nf, transportadora: "TransVerde", dataEntrada: dataRel(-5), ...extra });
    afirmar((await req("POST", "/lotes", tAdmin, corpoLote("NF1", { dataEntrada: dataRel(3) }))).status === 400, "data de entrada futura rejeitada");
    afirmar((await req("POST", "/lotes", tAdmin, corpoLote("NF1", { dataEntrada: dataRel(-120) }))).status === 400, "data de entrada com mais de 90 dias rejeitada");
    afirmar((await req("POST", "/lotes", tAdmin, { ...corpoLote("NF1"), orgCnpj: cnpjValido("999888770001") })).status === 404, "organizacao inexistente retorna 404");
    afirmar((await req("POST", "/lotes", tCad, corpoLote("NF1", { equipamentos: [{ tipo: "CPU" }] }))).status === 403, "cadastro nao insere equipamentos junto com o lote (403)");
    r = await req("POST", "/lotes", tAdmin, corpoLote("NF1", { equipamentos: [{ tipo: "Terminal" }, { tipo: "CPU" }, { tipo: "Impressora" }] }));
    afirmar(r.status === 201 && r.body.equipamentos.length === 3, "lote criado com 3 equipamentos (201)");
    const lote = r.body.lote;
    const [terminal, cpu] = r.body.equipamentos;
    afirmar(r.body.equipamentos.every((e) => e.codigoBarrasInterno === e.id), "codigo de barras e o proprio id do equipamento");
    afirmar(r.body.equipamentos.map((e) => e.posicao).join() === "1,2,3", "posicao no lote automatica (1, 2, 3)");
    afirmar((await req("POST", "/lotes", tAdmin, corpoLote("NF1"))).status === 409, "NF duplicada na mesma organizacao retorna 409");

    // Equipamento: triagem obrigatoria antes do desmonte.
    r = await req("PATCH", `/equipamentos/${terminal.id}/status`, tAlm, { status: "desmonte" });
    afirmar(r.status === 400, "desmonte sem triagem concluida e rejeitado (400)");
    r = await req("POST", `/equipamentos/${terminal.id}/triagem`, tAlm);
    afirmar(r.status === 200 && r.body.triagemCompleta === true && r.body.versao === 2, "triagem concluida incrementa a versao");
    r = await req("PATCH", `/equipamentos/${terminal.id}/status`, tAlm, { status: "desmonte" });
    afirmar(r.status === 200 && r.body.status === "desmonte", "desmonte permitido apos a triagem");
    // Queda de 2+ categorias exige justificativa.
    r = await req("PATCH", `/equipamentos/${cpu.id}/estado`, tAlm, { estadoFisico: "regular" });
    afirmar(r.status === 400, "queda de 2+ categorias sem justificativa rejeitada (400)");
    r = await req("PATCH", `/equipamentos/${cpu.id}/estado`, tAlm, { estadoFisico: "regular", justificativa: "Carcaca danificada" });
    afirmar(r.status === 200 && r.body.estadoFisico === "regular", "queda de estado com justificativa aceita");
    r = await req("GET", `/rastreio/${cpu.id}`, tAud);
    afirmar(r.status === 200 && r.body.movimentacoes.length === 1 && r.body.movimentacoes[0].justificativa === "Carcaca danificada", "movimentacao registrada e visivel no rastreio (auditor)");
    r = await req("GET", `/equipamentos/${cpu.id}/depreciacao?meses=24`, tAud);
    afirmar(r.status === 200 && typeof r.body.coeficiente === "number", "depreciacao calculada pelo dominio (polimorfismo)");
    afirmar((await req("GET", `/equipamentos/${cpu.id}/depreciacao?meses=-1`, tAud)).status === 400, "meses negativos rejeitados");
    afirmar((await req("PATCH", `/equipamentos/${cpu.id}/status`, tAud, { status: "reciclagem" })).status === 403, "auditor nao escreve (403)");
    r = await req("POST", "/equipamentos", tAdmin, { loteId: lote.id, tipo: "Monitor", codigoBarras: "TENTATIVA-MANUAL" });
    afirmar(r.status === 201 && r.body.posicao === 4 && r.body.codigoBarrasInterno === r.body.id, "equipamento avulso: codigo informado pelo cliente e ignorado; posicao 4 automatica");
    r = await req("GET", `/lotes/${lote.id}`, tAud);
    afirmar(r.status === 200 && r.body.equipamentos.length === 4 && r.body.organizacao.cnpj === cnpjA, "lote detalhado traz organizacao e equipamentos (eager loading)");
    r = await req("GET", "/equipamentos?status=desmonte&pagina=1&tamanhoPagina=5", tAud);
    afirmar(r.status === 200 && r.body.total === 1 && r.body.itens[0].id === terminal.id, "listagem paginada com filtro por status");
    afirmar((await req("GET", "/equipamentos?tamanhoPagina=1000", tAud)).status === 400, "tamanho de pagina acima do maximo rejeitado");

    titulo("6) Transacoes atomicas ($transaction)");
    const antes = (await sql.query(`SELECT (SELECT count(*) FROM "Lote")::int l, (SELECT count(*) FROM "Equipamento")::int e, (SELECT count(*) FROM "Auditoria" WHERE acao='LOTE_CRIADO')::int a`)).rows[0];
    r = await req("POST", "/lotes", tAdmin, corpoLote("NF-ATOMICO", { equipamentos: [{ tipo: "CPU" }, { tipo: "   " }] }));
    const depois = (await sql.query(`SELECT (SELECT count(*) FROM "Lote")::int l, (SELECT count(*) FROM "Equipamento")::int e, (SELECT count(*) FROM "Auditoria" WHERE acao='LOTE_CRIADO')::int a`)).rows[0];
    afirmar(r.status === 400, "falha de validacao no 2o equipamento do lote retorna 400");
    afirmar(depois.l === antes.l && depois.e === antes.e && depois.a === antes.a, "rollback total: nenhum lote, equipamento ou auditoria persistido");
    r = await req("POST", "/lotes", tAdmin, corpoLote("NF-ATOMICO", { equipamentos: [{ tipo: "CPU" }] }));
    afirmar(r.status === 201, "mesma NF e aceita depois do rollback (nada ficou gravado)");
    // Mudanca de status + movimentacao + auditoria na mesma transacao.
    const movs = (await sql.query(`SELECT count(*)::int n FROM "Movimentacao"`)).rows[0].n;
    const aud = (await sql.query(`SELECT count(*)::int n FROM "Auditoria" WHERE acao='EQUIPAMENTO_STATUS_ALTERADO'`)).rows[0].n;
    afirmar(movs >= 2 && aud >= 1, "mudanca de status gravou movimentacao e auditoria juntas");

    titulo("7) Controle de concorrencia (versionamento otimista)");
    const eq = (await req("GET", `/equipamentos/${cpu.id}`, tAdmin)).body;
    r = await req("POST", `/equipamentos/${cpu.id}/triagem`, tAdmin, { versao: eq.versao - 1 });
    afirmar(r.status === 409, "versao desatualizada informada pelo cliente retorna 409");
    const alvo = (await req("POST", "/equipamentos", tAdmin, { loteId: lote.id, tipo: "Servidor" })).body;
    const [x, y] = await Promise.all([
      req("POST", `/equipamentos/${alvo.id}/triagem`, tAdmin, { versao: alvo.versao }),
      req("POST", `/equipamentos/${alvo.id}/triagem`, tAdmin, { versao: alvo.versao }),
    ]);
    const codigos = [x.status, y.status].sort();
    afirmar(codigos[0] === 200 && codigos[1] === 409, `duas requisicoes simultaneas com a mesma versao: ${codigos.join(" e ")} (uma vence, a outra conflita)`);
    const final = (await req("GET", `/equipamentos/${alvo.id}`, tAdmin)).body;
    afirmar(final.versao === alvo.versao + 1, "versao incrementada exatamente uma vez (sem atualizacao perdida)");
    // Rajada concorrente SEM versao informada: o lote e travado (FOR UPDATE), entao nada se perde.
    const loteR = (await req("POST", "/lotes", tAdmin, corpoLote("NF-RAJADA", { equipamentos: Array.from({ length: 6 }, () => ({ tipo: "CPU" })) }))).body;
    const rajada = await Promise.all(loteR.equipamentos.map((e) => req("POST", `/equipamentos/${e.id}/triagem`, tAdmin)));
    afirmar(rajada.every((q) => q.status === 200), "6 triagens simultaneas no mesmo lote: todas aceitas (serializadas pelo lock do lote)");
    const stR = (await req("GET", `/lotes/${loteR.lote.id}`, tAdmin)).body;
    afirmar(stR.status === "triagem_completa", "status do lote derivado corretamente apos rajada concorrente (triagem_completa)");
    const avulsos = await Promise.all(Array.from({ length: 5 }, () => req("POST", "/equipamentos", tAdmin, { loteId: loteR.lote.id, tipo: "Monitor" })));
    const posicoes = avulsos.map((q) => q.body && q.body.posicao).sort((x, y) => x - y);
    afirmar(avulsos.every((q) => q.status === 201) && posicoes.join() === "7,8,9,10,11", `5 cadastros simultaneos recebem posicoes unicas e sequenciais (${posicoes.join(",")})`);
    r = await req("PATCH", `/contratos/${contratoId}`, tCad, { frequenciaColetaDias: 15, versao: 1 });
    afirmar(r.status === 200 && r.body.versao === 2, "contrato atualizado com a versao correta");
    r = await req("PATCH", `/contratos/${contratoId}`, tCad, { frequenciaColetaDias: 20, versao: 1 });
    afirmar(r.status === 409, "reenvio com a versao antiga do contrato retorna 409");

    titulo("8) Gestao de usuarios (renomear / desativar) em API stateless");
    const lista = (await req("GET", "/usuarios", tAdmin)).body;
    const uCad = lista.find((u) => u.username === "cad1");
    r = await req("PATCH", `/usuarios/${uCad.id}/username`, tAdmin, { username: "admin" });
    afirmar(r.status === 409, "renomear para nome existente retorna 409");
    r = await req("PATCH", `/usuarios/${uCad.id}/username`, tAdmin, { username: "cadastro_novo" });
    afirmar(r.status === 200 && r.body.username === "cadastro_novo", "usuario renomeado");
    r = await req("POST", "/auth/login", null, { username: "cadastro_novo", senha: "SenhaForte1" });
    afirmar(r.status === 200, "login com o novo nome funciona");
    afirmar((await req("GET", "/organizacoes", tCad)).status === 200, "token emitido antes da renomeacao continua valido (identificado pelo id)");
    const uAlm = lista.find((u) => u.username === "alm1");
    afirmar((await req("PATCH", `/usuarios/${uAlm.id}/ativo`, tAdmin, { ativo: false })).status === 200, "admin desativa usuario");
    afirmar((await req("GET", "/equipamentos", tAlm)).status === 401, "token de usuario desativado deixa de valer imediatamente (401)");
    afirmar((await req("POST", "/auth/login", null, { username: "alm1", senha: "SenhaForte1" })).status === 401, "usuario desativado nao consegue logar");
    const meuId = lista.find((u) => u.username === "admin").id;
    afirmar((await req("PATCH", `/usuarios/${meuId}/ativo`, tAdmin, { ativo: false })).status === 400, "admin nao pode desativar a propria conta");
    r = await req("POST", "/auth/senha", tAud, { senhaAtual: "SenhaForte1", novaSenha: "OutraSenha2" });
    afirmar(r.status === 204, "auditor pode trocar a propria senha (excecao a regra somente leitura)");
    afirmar((await req("POST", "/auth/login", null, { username: "aud1", senha: "OutraSenha2" })).status === 200, "nova senha vale no login");

    titulo("9) Auditoria no banco");
    r = await req("GET", "/auditoria?acao=USUARIO_RENOMEADO", tAud);
    afirmar(r.status === 200 && r.body.total === 1 && r.body.itens[0].detalhes.para === "cadastro_novo", "renomeacao registrada na auditoria com de/para");
    afirmar(r.body.itens[0].id && typeof r.body.itens[0].id === "string", "id BigInt da auditoria serializado como string");

    titulo("10) Restricoes diretas no banco (ultima barreira)");
    const tenta = async (q, params) => {
      try { await sql.query(q, params); return null; } catch (e) { return e.message; }
    };
    let e1 = await tenta(`INSERT INTO "Organizacao"(id,cnpj,"razaoSocial") VALUES (gen_random_uuid(),$1,'Dup')`, [cnpjA]);
    afirmar(e1 && /unique|duplicate/i.test(e1), "UNIQUE do CNPJ impede duplicidade mesmo via SQL");
    e1 = await tenta(`INSERT INTO "Organizacao"(id,cnpj,"razaoSocial") VALUES (gen_random_uuid(),'123','Mal formado')`);
    afirmar(e1 && /check/i.test(e1), "CHECK exige CNPJ com 14 digitos");
    e1 = await tenta(`UPDATE "Equipamento" SET status='desmonte' WHERE "triagemCompleta"=false`);
    afirmar(e1 && /check/i.test(e1), "CHECK impede 'desmonte' sem triagem completa");
    e1 = await tenta(`INSERT INTO "Equipamento"(id,"loteId","codigoBarrasInterno",tipo,posicao) VALUES (gen_random_uuid(),$1,'MANUAL','X',99)`, [lote.id]);
    afirmar(e1 && /check/i.test(e1), "CHECK impede codigo de barras diferente do id, mesmo via SQL");
    e1 = await tenta(`INSERT INTO "Equipamento"(id,"loteId","codigoBarrasInterno",tipo,posicao) SELECT id, "loteId", id::text, tipo, posicao FROM "Equipamento" WHERE "loteId"=$1 LIMIT 1`, [lote.id]);
    afirmar(e1 && /unique|duplicate/i.test(e1), "UNIQUE (id/codigo de barras) impede duplicidade mesmo via SQL");
    e1 = await tenta(`INSERT INTO "Equipamento"(id,"loteId","codigoBarrasInterno",tipo,posicao) SELECT gen_random_uuid(), "loteId", 'x', tipo, posicao FROM "Equipamento" WHERE "loteId"=$1 LIMIT 1`, [lote.id]);
    afirmar(e1 !== null, "restricoes impedem posicao repetida no mesmo lote");
    e1 = await tenta(`UPDATE "Movimentacao" SET justificativa='adulterada'`);
    afirmar(e1 && /imutavel/i.test(e1), "trigger bloqueia UPDATE em Movimentacao");
    e1 = await tenta(`DELETE FROM "Auditoria"`);
    afirmar(e1 && /imutavel/i.test(e1), "trigger bloqueia DELETE em Auditoria");

    afirmar((await mk("alm2", "almoxarifado")).status === 201, "novo usuario de almoxarifado criado para os proximos testes");
    const tAlm2 = await login("alm2");
    titulo("11) Regras do cliente: contrato ativo, status do lote derivado, soft delete e delete em cadeia");
    const cnpjB = cnpjValido("222333440001");
    await req("POST", "/organizacoes", tCad, { cnpj: cnpjB, razaoSocial: "Beta SA" });
    r = await req("POST", "/lotes", tAdmin, { orgCnpj: cnpjB, nf: "B1", transportadora: "T", dataEntrada: dataRel(-1) });
    afirmar(r.status === 409 && /contrato ativo/.test(r.body.mensagem), "lote em organizacao SEM contrato e rejeitado (409)");
    r = await req("POST", "/contratos", tCad, { orgCnpj: cnpjB, dataInicio: dataRel(-5), frequenciaColetaDias: 7 });
    const contratoB = r.body.id;
    afirmar((await req("POST", `/contratos/${contratoB}/encerrar`, tCad)).status === 200, "contrato encerrado");
    r = await req("POST", "/lotes", tAdmin, { orgCnpj: cnpjB, nf: "B1", transportadora: "T", dataEntrada: dataRel(-1) });
    afirmar(r.status === 409, "lote em organizacao com contrato ENCERRADO e rejeitado (409)");
    r = await req("GET", `/organizacoes/${cnpjB}`, tCad);
    afirmar(r.status === 200 && r.body.ativo === true, "falta de contrato ativo nao inativa a organizacao");
    afirmar((await req("DELETE", `/contratos/${contratoB}`, tCad)).status === 204, "contrato so tem delete definitivo (204)");
    afirmar((await req("GET", `/contratos/${contratoB}`, tCad)).status === 404, "contrato excluido nao existe mais");
    afirmar((await req("POST", `/contratos/${contratoB}/reativar`, tCad)).status === 404, "contrato excluido nao pode ser reaberto (404)");
    afirmar((await req("PATCH", `/lotes/${lote.id}/status`, tAdmin, { status: "encerrado" })).status === 404, "status do lote nao pode mais ser alterado manualmente (rota inexistente)");

    // Status do lote derivado dos equipamentos.
    r = await req("POST", "/lotes", tAdmin, corpoLote("NF-DERIVA", { equipamentos: [{ tipo: "CPU" }, { tipo: "Monitor" }] }));
    const loteD = r.body.lote, [d1, d2] = r.body.equipamentos;
    const stLote = async () => (await req("GET", `/lotes/${loteD.id}`, tAdmin)).body.status;
    afirmar((await stLote()) === "recebido", "lote nasce 'recebido'");
    await req("POST", `/equipamentos/${d1.id}/triagem`, tAdmin);
    afirmar((await stLote()) === "recebido", "1 de 2 equipamentos triado: lote continua 'recebido' (so muda quando TODOS coincidem)");
    await req("POST", `/equipamentos/${d2.id}/triagem`, tAdmin);
    afirmar((await stLote()) === "triagem_completa", "todos triados: lote vai para 'triagem_completa'");
    await req("PATCH", `/equipamentos/${d1.id}/status`, tAdmin, { status: "reciclagem" });
    afirmar((await stLote()) === "triagem_completa", "equipamentos com status diferentes: lote nao muda");
    await req("PATCH", `/equipamentos/${d2.id}/status`, tAdmin, { status: "revenda" });
    afirmar((await stLote()) === "encerrado", "todos em destino final: lote 'encerrado'");
    afirmar((await req("POST", "/equipamentos", tAdmin, { loteId: loteD.id, tipo: "CPU" })).status === 400, "lote encerrado nao recebe novos equipamentos");
    const audD = (await req("GET", "/auditoria?acao=LOTE_STATUS_ATUALIZADO", tAdmin)).body;
    afirmar(audD.total >= 3, "mudancas automaticas do lote ficam na auditoria");

    // Excluir equipamento (delete definitivo) recalcula o lote e remove movimentacoes.
    r = await req("POST", "/lotes", tAdmin, corpoLote("NF-EXCL", { equipamentos: [{ tipo: "CPU" }, { tipo: "CPU" }] }));
    const loteE = r.body.lote, [q1, q2] = r.body.equipamentos;
    await req("POST", `/equipamentos/${q1.id}/triagem`, tAdmin);
    afirmar((await req("GET", `/lotes/${loteE.id}`, tAdmin)).body.status === "recebido", "lote com 1 triado e 1 aguardando continua 'recebido'");
    afirmar((await req("DELETE", `/equipamentos/${q2.id}`, tAlm2)).status === 204, "equipamento excluido (204)");
    afirmar((await req("GET", `/equipamentos/${q2.id}`, tAdmin)).status === 404, "equipamento excluido nao existe mais");
    afirmar((await req("GET", `/lotes/${loteE.id}`, tAdmin)).body.status === "triagem_completa", "ao excluir o equipamento restante pendente, o lote e recalculado (todos triados)");
    afirmar((await req("DELETE", `/equipamentos/${q1.id}`, tCad)).status === 403, "operador de cadastro nao exclui equipamento (403)");

    // Soft delete em cadeia.
    const cnpjC = cnpjValido("333444550001");
    await req("POST", "/organizacoes", tCad, { cnpj: cnpjC, razaoSocial: "Gama Ltda" });
    await req("POST", "/contratos", tCad, { orgCnpj: cnpjC, dataInicio: dataRel(-5), frequenciaColetaDias: 10 });
    const mkLote = async (nf, n) => (await req("POST", "/lotes", tAdmin, { orgCnpj: cnpjC, nf, transportadora: "T", dataEntrada: dataRel(-2), equipamentos: Array.from({ length: n }, () => ({ tipo: "CPU" })) })).body;
    const lc1 = await mkLote("C1", 2), lc2 = await mkLote("C2", 1);
    afirmar((await req("DELETE", `/lotes/${lc2.lote.id}`, tCad)).status === 200, "soft delete de um lote isolado (C2)");
    r = await req("DELETE", `/organizacoes/${cnpjC}`, tCad);
    afirmar(r.status === 200 && r.body.ativo === false && r.body.lotesInativados === 1, "soft delete da organizacao inativa em cadeia o lote ainda ativo (C1)");
    r = await req("GET", "/organizacoes?tamanhoPagina=100", tCad);
    afirmar(!r.body.itens.some((o) => o.cnpj === cnpjC), "organizacao inativa some das listagens");
    r = await req("GET", "/organizacoes?incluirInativos=true&tamanhoPagina=100", tCad);
    afirmar(r.body.itens.some((o) => o.cnpj === cnpjC && o.ativo === false), "incluirInativos=true mostra a organizacao inativa");
    r = await req("GET", `/lotes?cnpj=${cnpjC}`, tAdmin);
    afirmar(r.body.total === 0, "lotes da organizacao inativa somem da listagem");
    afirmar((await req("GET", `/equipamentos/${lc1.equipamentos[0].id}`, tAdmin)).status === 404, "equipamentos dos lotes inativos deixam de ser acessiveis");
    afirmar((await req("POST", `/equipamentos/${lc1.equipamentos[0].id}/triagem`, tAdmin)).status === 404, "nao e possivel operar equipamento de lote inativo");
    afirmar((await req("GET", `/lotes/${lc1.lote.id}`, tAud)).body.ativo === false, "auditor ainda consulta o lote inativo pelo id");
    r = await req("POST", "/lotes", tAdmin, { orgCnpj: cnpjC, nf: "C3", transportadora: "T", dataEntrada: dataRel(-1) });
    afirmar(r.status === 409, "organizacao inativa nao recebe novos lotes");
    r = await req("POST", "/organizacoes", tCad, { cnpj: cnpjC, razaoSocial: "Gama de novo" });
    afirmar(r.status === 409 && /inativa/.test(r.body.mensagem), "recadastrar CNPJ inativo orienta a reativar (409)");
    afirmar((await req("DELETE", `/organizacoes/${cnpjC}`, tCad)).status === 409, "inativar duas vezes retorna 409");
    r = await req("POST", `/organizacoes/${cnpjC}/reativar`, tCad);
    afirmar(r.status === 200 && r.body.ativo === true && r.body.lotesReativados === 1, "reativar devolve a organizacao e SO os lotes inativados junto com ela");
    afirmar((await req("GET", `/equipamentos/${lc1.equipamentos[0].id}`, tAdmin)).status === 200, "equipamentos do lote reativado voltam a aparecer");
    afirmar((await req("GET", `/lotes/${lc2.lote.id}`, tAdmin)).body.ativo === false, "lote inativado separadamente continua inativo");
    afirmar((await req("POST", `/lotes/${lc2.lote.id}/reativar`, tCad)).status === 200, "lote reativado individualmente");

    // Delete definitivo em cadeia.
    afirmar((await req("DELETE", `/organizacoes/${cnpjC}?permanente=true`, tCad)).status === 403, "delete definitivo e restrito ao admin (403 para cadastro)");
    afirmar((await req("DELETE", `/lotes/${lc1.lote.id}?permanente=true`, tCad)).status === 403, "delete definitivo de lote restrito ao admin");
    // movimentacao para provar que ela tambem sai em cadeia
    await req("POST", `/equipamentos/${lc1.equipamentos[0].id}/triagem`, tAdmin);
    const idOrgC = (await sql.query(`SELECT id FROM "Organizacao" WHERE cnpj=$1`, [cnpjC])).rows[0].id;
    const contaC = async () => (await sql.query(`SELECT (SELECT count(*) FROM "Contrato" WHERE "organizacaoId"=$1)::int c, (SELECT count(*) FROM "Lote" WHERE "organizacaoId"=$1)::int l, (SELECT count(*) FROM "Equipamento" WHERE "loteId" IN (SELECT id FROM "Lote" WHERE "organizacaoId"=$1))::int e, (SELECT count(*) FROM "Movimentacao" WHERE "equipamentoId" IN (SELECT id FROM "Equipamento" WHERE "loteId" IN (SELECT id FROM "Lote" WHERE "organizacaoId"=$1)))::int m`, [idOrgC])).rows[0];
    const antesC = await contaC();
    afirmar(antesC.c === 1 && antesC.l === 2 && antesC.e === 3 && antesC.m >= 1, `antes: organizacao C tem contrato, ${antesC.l} lotes, ${antesC.e} equipamentos e ${antesC.m} movimentacao(oes)`);
    afirmar((await req("DELETE", `/lotes/${lc2.lote.id}?permanente=true`, tAdmin)).status === 204, "admin exclui lote definitivamente (204)");
    afirmar((await req("DELETE", `/organizacoes/${cnpjC}?permanente=true`, tAdmin)).status === 204, "admin exclui a organizacao definitivamente (204)");
    const depoisC = await contaC();
    afirmar(depoisC.c === 0 && depoisC.l === 0 && depoisC.e === 0 && depoisC.m === 0, "delete em cadeia: contrato, lotes, equipamentos e movimentacoes foram apagados");
    afirmar((await req("GET", `/organizacoes/${cnpjC}`, tAdmin)).status === 404, "organizacao excluida nao existe mais");
    r = await req("GET", "/auditoria?acao=ORG_EXCLUIDA", tAud);
    afirmar(r.body.total === 1, "a exclusao fica registrada na auditoria (que e preservada)");
    const eMov = await tenta(`DELETE FROM "Movimentacao"`);
    afirmar(eMov && /imutavel/i.test(eMov), "movimentacao continua imutavel para delete direto, mesmo com a cascata liberada");

    // Usuarios: soft delete e delete definitivo.
    await mk("temp9", "cadastro");
    const tempId = (await req("GET", "/usuarios", tAdmin)).body.find((u) => u.username === "temp9").id;
    r = await req("DELETE", `/usuarios/${tempId}`, tAdmin);
    afirmar(r.status === 200 && r.body.ativo === false, "DELETE de usuario faz soft delete (inativa)");
    afirmar((await req("DELETE", `/usuarios/${tempId}?permanente=true`, tAdmin)).status === 204, "usuario sem historico pode ser excluido definitivamente");
    const admId = (await req("GET", "/usuarios", tAdmin)).body.find((u) => u.username === "admin").id;
    afirmar((await req("DELETE", `/usuarios/${admId}?permanente=true`, tAdmin)).status === 400, "admin nao exclui a propria conta");
    const idCad = (await req("GET", "/usuarios", tAdmin)).body.find((u) => u.username === "alm1").id; // ja fez triagens: tem historico
    afirmar((await req("DELETE", `/usuarios/${idCad}?permanente=true`, tAdmin)).status === 409, "usuario com historico nao e excluido (409): deve ser inativado");
    afirmar((await req("DELETE", `/usuarios/${idCad}`, tCad)).status === 403, "operador nao inativa usuarios (403)");

    // Admin acessa TODAS as rotas de consulta; operador nao ve a lista de usuarios.
    const rotasLeitura = ["/usuarios", "/organizacoes", "/contratos", "/lotes", "/equipamentos", "/auditoria", "/auth/me"];
    const respostas = await Promise.all(rotasLeitura.map((u) => req("GET", u, tAdmin)));
    afirmar(respostas.every((q) => q.status === 200), "admin tem acesso a todas as rotas de consulta");
    afirmar((await req("GET", "/usuarios", tCad)).status === 403, "operador de cadastro nao ve a lista de usuarios (403)");

    titulo("11-B) Auditoria de lacunas: CRUD completo do admin, parametros globais e camadas");
    // Parametros globais (admin), equivalente ao config set/get do CLI.
    afirmar((await req("PUT", "/config/aliquota_icms", tCad, { valor: "0.18" })).status === 403, "parametros globais: operador nao altera (403)");
    r = await req("PUT", "/config/aliquota_icms", tAdmin, { valor: "0.18" });
    afirmar(r.status === 200 && r.body.valor === "0.18" && r.body.versao === 1, "admin cria parametro global");
    r = await req("PUT", "/config/aliquota_icms", tAdmin, { valor: "0.17", versao: 1 });
    afirmar(r.status === 200 && r.body.versao === 2, "admin atualiza parametro (versao 2)");
    afirmar((await req("PUT", "/config/aliquota_icms", tAdmin, { valor: "0.20", versao: 1 })).status === 409, "atualizar parametro com versao antiga retorna 409");
    afirmar((await req("PUT", "/config/chave invalida!", tAdmin, { valor: "x" })).status === 400, "chave de parametro invalida rejeitada");
    r = await req("GET", "/config", tAdmin);
    afirmar(r.status === 200 && r.body.some((p) => p.chave === "aliquota_icms"), "admin lista os parametros");
    afirmar((await req("GET", "/config", tAud)).status === 403, "auditor nao acessa parametros globais (como no CLI)");
    afirmar((await req("DELETE", "/config/aliquota_icms", tAdmin)).status === 204, "admin remove parametro");
    afirmar((await req("GET", "/config/aliquota_icms", tAdmin)).status === 404, "parametro removido nao existe");

    // Admin edita qualquer entidade: lote.
    const cnpjE = cnpjValido("555666770001");
    await req("POST", "/organizacoes", tAdmin, { cnpj: cnpjE, razaoSocial: "Edicao SA" });
    await req("POST", "/contratos", tAdmin, { orgCnpj: cnpjE, dataInicio: dataRel(-3), frequenciaColetaDias: 5 });
    const mkL = async (nf) => (await req("POST", "/lotes", tAdmin, { orgCnpj: cnpjE, nf, transportadora: "T0", dataEntrada: dataRel(-3), equipamentos: [{ tipo: "CPU" }] })).body;
    const le1 = await mkL("E1"), le2 = await mkL("E2");
    r = await req("PATCH", `/lotes/${le1.lote.id}`, tAdmin, { transportadora: "Nova Transp", nf: "E1-B" });
    afirmar(r.status === 200 && r.body.transportadora === "Nova Transp" && r.body.nf === "E1-B" && r.body.versao === le1.lote.versao + 1, "admin edita NF e transportadora do lote");
    afirmar((await req("PATCH", `/lotes/${le1.lote.id}`, tAdmin, { nf: "E2" })).status === 409, "editar NF para uma ja existente na organizacao retorna 409");
    afirmar((await req("PATCH", `/lotes/${le1.lote.id}`, tAdmin, { dataEntrada: dataRel(5) })).status === 400, "editar data para o futuro e rejeitado");
    afirmar((await req("PATCH", `/lotes/${le1.lote.id}`, tAdmin, { dataEntrada: dataRel(-200) })).status === 400, "editar data para mais de 90 dias e rejeitado");
    afirmar((await req("PATCH", `/lotes/${le1.lote.id}`, tAdmin, { nf: "ZZ", versao: 1 })).status === 409, "edicao do lote com versao antiga retorna 409");
    afirmar((await req("PATCH", `/lotes/${le1.lote.id}`, tAud, { nf: "AUD" })).status === 403, "auditor nao edita lote");
    afirmar((await req("PATCH", `/lotes/${le1.lote.id}`, tAlm2, { nf: "E1-C" })).status === 200, "almoxarifado edita lote (alcada de lote)");
    // equipamento: tipo
    r = await req("PATCH", `/equipamentos/${le2.equipamentos[0].id}`, tAdmin, { tipo: "Servidor" });
    afirmar(r.status === 200 && r.body.tipo === "servidor" || r.body.tipo === "Servidor", "admin corrige o tipo do equipamento");
    afirmar((await req("PATCH", `/equipamentos/${le2.equipamentos[0].id}`, tAdmin, { tipo: "  " })).status === 400, "tipo vazio rejeitado na edicao");
    afirmar((await req("PATCH", `/equipamentos/${le2.equipamentos[0].id}`, tCad, { tipo: "CPU" })).status === 403, "cadastro nao edita equipamento");
    // usuario: papel e senha
    await mk("papel1", "auditor");
    const idP = (await req("GET", "/usuarios", tAdmin)).body.find((u) => u.username === "papel1").id;
    r = await req("PATCH", `/usuarios/${idP}/papel`, tAdmin, { papel: "almoxarifado" });
    afirmar(r.status === 200 && r.body.papel === "almoxarifado", "admin altera o papel de outro usuario");
    afirmar((await req("PATCH", `/usuarios/${admId}/papel`, tAdmin, { papel: "auditor" })).status === 400, "admin nao altera o proprio papel");
    afirmar((await req("PATCH", `/usuarios/${idP}/senha`, tAdmin, { novaSenha: "fraca" })).status === 400, "redefinicao de senha respeita a politica de forca");
    afirmar((await req("PATCH", `/usuarios/${idP}/senha`, tAdmin, { novaSenha: "NovaSenha77" })).status === 204, "admin redefine a senha de outro usuario");
    afirmar((await req("POST", "/auth/login", null, { username: "papel1", senha: "NovaSenha77" })).status === 200, "login com a senha redefinida funciona");
    afirmar((await req("PATCH", `/usuarios/${idP}/papel`, tCad, { papel: "admin" })).status === 403, "operador nao altera papeis");
    // contrato encerrado pode ser reaberto, devolvendo a elegibilidade para lotes
    const cnpjR = cnpjValido("888999000001");
    await req("POST", "/organizacoes", tAdmin, { cnpj: cnpjR, razaoSocial: "Reabre SA" });
    const cR = (await req("POST", "/contratos", tAdmin, { orgCnpj: cnpjR, dataInicio: dataRel(-3), frequenciaColetaDias: 5 })).body;
    await req("POST", `/contratos/${cR.id}/encerrar`, tAdmin);
    const loteR2 = { orgCnpj: cnpjR, nf: "R1", transportadora: "T", dataEntrada: dataRel(-1) };
    afirmar((await req("POST", "/lotes", tAdmin, loteR2)).status === 409, "contrato encerrado: lote rejeitado");
    afirmar((await req("POST", `/contratos/${cR.id}/reativar`, tCad)).status === 200, "contrato encerrado e reaberto");
    afirmar((await req("POST", `/contratos/${cR.id}/reativar`, tCad)).status === 409, "reabrir contrato ja ativo retorna 409");
    afirmar((await req("POST", "/lotes", tAdmin, loteR2)).status === 201, "apos reabrir o contrato, a organizacao volta a receber lotes");
    // contratos de organizacao inativa
    const lcont = (await req("GET", "/contratos?tamanhoPagina=100", tAdmin)).body.itens;
    const cE = lcont.find((c) => c.organizacao.cnpj === cnpjE);
    await req("DELETE", `/organizacoes/${cnpjE}`, tAdmin);
    afirmar(!(await req("GET", "/contratos?tamanhoPagina=100", tAdmin)).body.itens.some((c) => c.id === cE.id), "contrato de organizacao inativa some da listagem");
    afirmar((await req("GET", "/contratos?incluirInativos=true&tamanhoPagina=100", tAdmin)).body.itens.some((c) => c.id === cE.id), "incluirInativos=true mostra o contrato");
    afirmar((await req("PATCH", `/contratos/${cE.id}`, tAdmin, { frequenciaColetaDias: 9 })).status === 409, "contrato de organizacao inativa nao pode ser alterado");
    await req("POST", `/organizacoes/${cnpjE}/reativar`, tAdmin);
    afirmar((await req("PATCH", `/contratos/${cE.id}`, tAdmin, { frequenciaColetaDias: 9 })).status === 200, "apos reativar a organizacao o contrato volta a ser editavel");
    // camadas estritas (analise estatica do codigo-fonte)
    const lerFontes = (dir) => fs.readdirSync(path.join(RAIZ, "src", "server", dir)).filter((f) => f.endsWith(".ts")).map((f) => [f, fs.readFileSync(path.join(RAIZ, "src", "server", dir, f), "utf8")]);
    const viola = (dir, regex) => lerFontes(dir).filter(([, c]) => regex.test(c)).map(([f]) => `${dir}/${f}`);
    const vCtrl = viola("controllers", /from "\.\.\/(repositories|db\/unidadeDeTrabalho)/);
    afirmar(vCtrl.length === 0, `controllers nao importam repositorios nem a unidade de trabalho ${vCtrl.join(",")}`);
    const vPlug = viola("plugins", /from "\.\.\/(repositories|db\/unidadeDeTrabalho)/);
    afirmar(vPlug.length === 0, `plugins/hooks nao acessam repositorios ${vPlug.join(",")}`);
    const vSrv = viola("services", /from "(fastify|@fastify\/[a-z-]+)"/);
    afirmar(vSrv.length === 0, `services nao dependem do framework HTTP ${vSrv.join(",")}`);
    const vRepo = viola("repositories", /from "\.\.\/(services|controllers)/);
    afirmar(vRepo.length === 0, `repositories nao dependem de services/controllers ${vRepo.join(",")}`);
    const vPrisma = ["controllers", "services", "plugins", "routes"].flatMap((d) => viola(d, /PrismaClient|\$transaction|\.\$queryRaw/).filter((f) => !/unidadeDeTrabalho/.test(f)));
    afirmar(vPrisma.length === 0, `acesso direto ao Prisma/transacoes fica fora de controllers, services, plugins e routes ${vPrisma.join(",")}`);
    const pk = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8"));
    afirmar(!!pk.dependencies.bcrypt && !!pk.dependencies["@fastify/jwt"] && !!pk.dependencies.fastify && !!pk.dependencies["@prisma/client"], "dependencias exigidas presentes: fastify, @fastify/jwt, bcrypt, @prisma/client");

    titulo("11-C) Varredura de autorizacao: todas as rotas x todos os papeis");
    const docApi = app.swagger();
    const trocas = (p) => p.replace("/api/v1", "").replace("{id}", "00000000-0000-4000-8000-000000000000").replace("{cnpj}", cnpjValido("000111220001")).replace("{chave}", "inexistente");
    const rotas = [];
    for (const [caminho, ops] of Object.entries(docApi.paths)) {
      if (!caminho.startsWith("/api/v1")) continue;
      const p = caminho.replace("/api/v1", "");
      if (["/health", "/auth/login", "/auth/provisionar"].includes(p)) continue;
      for (const m of Object.keys(ops)) rotas.push({ m: m.toUpperCase(), url: trocas(caminho), p });
    }
    afirmar(rotas.length >= 40, `varredura cobre ${rotas.length} rotas protegidas (metodo + caminho)`);
    const proibido = (papel, p, m) => {
      if (papel === "auditor" && m !== "GET" && p !== "/auth/senha") return true;
      if (/^\/(usuarios|config)/.test(p)) return papel !== "admin";
      if (/^\/(organizacoes|contratos)/.test(p)) return papel === "almoxarifado";
      if (/^\/equipamentos/.test(p)) return papel === "cadastro";
      if (/^\/auditoria/.test(p)) return papel === "cadastro" || papel === "almoxarifado";
      return false;
    };
    const semToken = [];
    for (const rt of rotas) if ((await req(rt.m, rt.url, null, rt.m === "GET" || rt.m === "DELETE" ? undefined : {})).status !== 401) semToken.push(`${rt.m} ${rt.p}`);
    afirmar(semToken.length === 0, `sem token: todas as rotas protegidas retornam 401 ${semToken.slice(0, 3).join("; ")}`);
    const papeisTok = { admin: tAdmin, cadastro: tCad, almoxarifado: tAlm2, auditor: tAud };
    for (const [papel, tok] of Object.entries(papeisTok)) {
      const erradas = [];
      for (const rt of rotas) {
        const corpo = rt.m === "GET" || rt.m === "DELETE" ? undefined : {};
        const st = (await req(rt.m, rt.url, tok, corpo)).status;
        const esperado403 = proibido(papel, rt.p, rt.m);
        if (esperado403 && st !== 403) erradas.push(`${rt.m} ${rt.p} deveria 403, veio ${st}`);
        if (!esperado403 && (st === 401 || st === 403)) erradas.push(`${rt.m} ${rt.p} deveria ser permitido, veio ${st}`);
      }
      afirmar(erradas.length === 0, `matriz de papeis do '${papel}' confere em todas as rotas ${erradas.slice(0, 3).join("; ")}`);
    }

    titulo("12) Documentacao OpenAPI");
    const doc = await app.inject({ method: "GET", url: "/docs/json" });
    afirmar(doc.statusCode === 200 && Object.keys(doc.json().paths).length >= 20, "OpenAPI exposto em /docs/json com as rotas da API");

    await app.close();
    await prisma.$disconnect();
    app = null;

    titulo("13) Seed (massa de dados) e idempotencia");
    const env = { ...process.env, DATABASE_URL: URL_BANCO, JWT_SECRET: SEGREDO, BCRYPT_ROUNDS: "4", LOG_LEVEL: "silent" };
    await sql.query(`TRUNCATE "Usuario","Organizacao" CASCADE`).catch(() => null);
    // As tabelas imutaveis bloqueiam TRUNCATE por trigger de linha? TRUNCATE nao dispara triggers de linha.
    const cont0 = (await sql.query(`SELECT count(*)::int n FROM "Usuario"`)).rows[0].n;
    afirmar(cont0 === 0, "banco limpo antes do seed");
    let s = spawnSync(process.execPath, [path.join(DIST, "seed.js")], { env, encoding: "utf8" });
    afirmar(s.status === 0 && /Seed concluido/.test(s.stdout), `seed executa sem erros ${s.status !== 0 ? "(" + s.stderr.trim() + ")" : ""}`);
    const c = (await sql.query(`SELECT (SELECT count(*) FROM "Usuario")::int u,(SELECT count(*) FROM "Organizacao")::int o,(SELECT count(*) FROM "Contrato")::int c,(SELECT count(*) FROM "Lote")::int l,(SELECT count(*) FROM "Equipamento")::int e`)).rows[0];
    afirmar(c.u === 4 && c.o === 4 && c.c === 4 && c.l === 4 && c.e === 9, `seed populou 4 usuarios, 4 organizacoes, 4 contratos, 4 lotes, 9 equipamentos`);
    const inat = (await sql.query(`SELECT (SELECT count(*) FROM "Organizacao" WHERE NOT ativo)::int o, (SELECT count(*) FROM "Lote" WHERE NOT ativo)::int l, (SELECT count(*) FROM "Contrato" WHERE NOT ativo)::int c`)).rows[0];
    afirmar(inat.o === 1 && inat.l === 1 && inat.c === 1, "seed inclui 1 organizacao inativada em cadeia (com seu lote) e 1 contrato encerrado");
    const stLotes = (await sql.query(`SELECT nf, status::text s FROM "Lote" ORDER BY nf`)).rows.map((x) => `${x.nf}=${x.s}`).join(" ");
    afirmar(/NF-0001=recebido/.test(stLotes) && /NF-0002=triagem_completa/.test(stLotes), `status dos lotes derivado dos equipamentos no seed (${stLotes})`);
    const st = (await sql.query(`SELECT DISTINCT status::text s FROM "Equipamento" ORDER BY 1`)).rows.map((x) => x.s);
    afirmar(st.length >= 5, `equipamentos do seed em estados variados (${st.join(", ")})`);
    s = spawnSync(process.execPath, [path.join(DIST, "seed.js")], { env, encoding: "utf8" });
    afirmar(s.status === 0 && /ignorado/.test(s.stdout), "segunda execucao do seed e ignorada (idempotente)");

    titulo("14) Servidor real: porta por variavel de ambiente e graceful shutdown");
    const porta = 20000 + Math.floor(Math.random() * 20000);
    const srv = spawn(process.execPath, [path.join(DIST, "server.js")], { env: { ...env, PORT: String(porta), HOST: "127.0.0.1" } });
    let saida = "";
    srv.stderr.on("data", (d) => (saida += d));
    let ok2 = false;
    for (let i = 0; i < 40 && !ok2; i++) {
      await new Promise((res) => setTimeout(res, 250));
      try { ok2 = (await fetch(`http://127.0.0.1:${porta}/api/v1/health`)).status === 200; } catch {}
    }
    afirmar(ok2, `servidor escutando na porta definida por PORT (${porta})`);
    const lr = await fetch(`http://127.0.0.1:${porta}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", senha: "Greencode#2026" }),
    });
    afirmar(lr.status === 200, "login do usuario criado pelo seed via HTTP real");
    const codigoSaida = await new Promise((res) => {
      srv.on("exit", (code, sig) => res(sig ? `sinal:${sig}` : code));
      srv.kill("SIGTERM");
    });
    afirmar(codigoSaida === 0, `SIGTERM encerra o processo com codigo 0 (graceful shutdown) -> ${codigoSaida}`);

    titulo("15) Configuracao obrigatoria");
    const semSegredo = spawnSync(process.execPath, [path.join(DIST, "server.js")], {
      env: { PATH: process.env.PATH, DATABASE_URL: URL_BANCO, JWT_SECRET: "curto" }, encoding: "utf8",
    });
    afirmar(semSegredo.status !== 0 && /JWT_SECRET/.test(semSegredo.stderr), "servidor recusa iniciar com JWT_SECRET fraco");
  } finally {
    try { if (app) await app.close(); } catch {}
    try { if (prisma) await prisma.$disconnect(); } catch {}
    await sql.end().catch(() => null);
    await admin.query(`DROP DATABASE IF EXISTS "${NOME_BANCO}" WITH (FORCE)`).catch(() => null);
    await admin.end().catch(() => null);
  }

  console.log(`\nResumo: ${passos - falhas}/${passos} verificacoes OK.`);
  if (falhas > 0) {
    console.log(`${falhas} falha(s).`);
    process.exit(1);
  }
  console.log("Todas as verificacoes passaram.");
}

main().catch((e) => {
  console.error("Erro inesperado no teste de API:", e);
  process.exit(1);
});
