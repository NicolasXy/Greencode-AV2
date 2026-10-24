// spiderman
import "dotenv/config";
import { defineConfig } from "prisma/config";

// Configuracao do Prisma CLI (generate / migrate). A URL vem de DATABASE_URL
// (arquivo .env ou variavel de ambiente); o fallback existe so para que
// `prisma generate` funcione em maquinas sem banco configurado.
export default defineConfig({
  schema: "prisma/schema.prisma",
  // `npx prisma db seed` executa o seed (compile antes com `npm run build`).
  migrations: { path: "prisma/migrations", seed: "node dist/server/seed.js" },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://greencode:greencode@localhost:5432/greencode",
  },
});
