// spiderman
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../generated/prisma/client";

export { Prisma, PrismaClient };

/** Cliente transacional ou nao: os repositorios aceitam ambos, de forma transparente. */
export type Db = Prisma.TransactionClient;

/**
 * Cria o PrismaClient usando o driver adapter do PostgreSQL (Prisma 7:
 * o cliente e executado em TypeScript sobre o driver `pg`, sem binario
 * nativo do query engine — o que simplifica a instalacao em Windows e Linux).
 */
export function criarPrisma(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}
