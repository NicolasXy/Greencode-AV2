#!/usr/bin/env node
/**
 * Executa todos os scripts de teste do greencode em sequencia e resume o
 * resultado. Pressupoe que o projeto ja foi compilado (npm run build).
 */
const { spawnSync } = require("child_process");
const path = require("path");

const testes = [
  "run-journey.js",
  "run-security.js",
  "run-domain.js",
  "run-compliance.js",
  "run-write-ahead.js",
  "run-session-timeout.js",
  "run-api.js", // exige PostgreSQL; sai com codigo 3 (pulado) se indisponivel
];
const pulados = [];
let algumaFalha = false;

for (const teste of testes) {
  console.log(`\n${"=".repeat(60)}\nExecutando ${teste}\n${"=".repeat(60)}`);
  const resultado = spawnSync(process.execPath, [path.join(__dirname, teste)], {
    stdio: "inherit",
  });
  if (resultado.status === 3) {
    pulados.push(teste);
    console.warn(`\n>>> ${teste} PULADO (PostgreSQL indisponivel; nao conta como aprovado)`);
  } else if (resultado.status !== 0) {
    algumaFalha = true;
    console.error(`\n>>> ${teste} FALHOU (codigo ${resultado.status})`);
  }
}

console.log(`\n${"=".repeat(60)}`);
if (pulados.length) console.log(`Pulados: ${pulados.join(", ")}`);
console.log(algumaFalha ? "RESULTADO FINAL: FALHAS ENCONTRADAS" : "RESULTADO FINAL: TODOS OS TESTES PASSARAM");
process.exit(algumaFalha ? 1 : 0);
