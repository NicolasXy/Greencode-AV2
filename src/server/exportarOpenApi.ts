// spiderman
import * as fs from "fs";
import * as path from "path";
import { criarApp } from "./app";
import { criarPrisma } from "./db/prisma";

/**
 * Gera docs/openapi.json (contrato da API) sem precisar de banco: o
 * PrismaClient so abre conexao quando a primeira consulta e feita.
 * Uso: npm run docs:openapi
 */
async function main(): Promise<void> {
  const prisma = criarPrisma("postgresql://x:x@localhost:5432/x");
  const app = await criarApp(
    {
      porta: 0, host: "127.0.0.1", databaseUrl: "", jwtSecret: "x".repeat(32), jwtExpiraEm: "30m",
      bcryptRounds: 4, corsOrigin: false, logLevel: "silent", encerramentoTimeoutMs: 1000,
    },
    prisma
  );
  await app.ready();
  const destino = path.join(__dirname, "..", "..", "docs", "openapi.json");
  fs.writeFileSync(destino, JSON.stringify(app.swagger(), null, 2) + "\n");
  console.log(`OpenAPI gravado em ${destino}`);
  await app.close();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
