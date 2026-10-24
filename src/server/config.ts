// spiderman
import "dotenv/config";

/**
 * Configuracao do servidor, lida UMA vez das variaveis de ambiente (ou do
 * arquivo .env). Centralizar aqui evita espalhar `process.env` pelo codigo
 * e permite validar os valores obrigatorios na inicializacao.
 */
export interface Configuracao {
  porta: number;
  host: string;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiraEm: string;
  bcryptRounds: number;
  corsOrigin: string | boolean;
  logLevel: string;
  encerramentoTimeoutMs: number;
}

export function carregarConfiguracao(env: NodeJS.ProcessEnv = process.env): Configuracao {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL nao definida. Copie .env.example para .env e ajuste os valores.");
  }
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET deve ser definido com pelo menos 32 caracteres.");
  }
  const porta = Number(env.PORT ?? 3000);
  if (!Number.isInteger(porta) || porta < 0 || porta > 65535) {
    throw new Error(`PORT invalida: ${env.PORT}`);
  }
  const cors = env.CORS_ORIGIN;
  return {
    porta,
    host: env.HOST ?? "0.0.0.0",
    databaseUrl,
    jwtSecret,
    jwtExpiraEm: env.JWT_EXPIRES_IN ?? "30m",
    // 12 rounds e o equilibrio usual; testes podem reduzir via BCRYPT_ROUNDS para acelerar.
    bcryptRounds: Number(env.BCRYPT_ROUNDS ?? 12),
    corsOrigin: cors === undefined || cors === "" ? false : cors === "*" ? true : cors,
    logLevel: env.LOG_LEVEL ?? "info",
    encerramentoTimeoutMs: Number(env.SHUTDOWN_TIMEOUT_MS ?? 10000),
  };
}
