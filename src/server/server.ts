// spiderman
import { carregarConfiguracao } from "./config";
import { criarPrisma } from "./db/prisma";
import { criarApp } from "./app";

/**
 * Ponto de entrada do servidor HTTP. A porta vem da variavel de ambiente
 * PORT. O encerramento e gracioso: ao receber SIGINT/SIGTERM (Ctrl+C no
 * Windows e Linux, ou o stop do orquestrador), o servidor para de aceitar
 * conexoes novas, espera as requisicoes em andamento terminarem e so
 * entao fecha o pool de conexoes do banco. Um temporizador forca a saida
 * se o encerramento demorar mais que SHUTDOWN_TIMEOUT_MS.
 */
async function main(): Promise<void> {
  const config = carregarConfiguracao();
  const prisma = criarPrisma(config.databaseUrl);
  const app = await criarApp(config, prisma);

  let encerrando = false;
  const encerrar = async (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    app.log.info(`Sinal ${sinal} recebido: encerrando com graciosidade...`);
    const limite = setTimeout(() => {
      app.log.error("Tempo limite de encerramento excedido; forcando saida.");
      process.exit(1);
    }, config.encerramentoTimeoutMs);
    limite.unref();
    try {
      await app.close(); // finaliza conexoes HTTP ativas
      await prisma.$disconnect(); // libera o pool do PostgreSQL
      process.exit(0);
    } catch (e) {
      app.log.error(e);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void encerrar("SIGINT"));
  process.on("SIGTERM", () => void encerrar("SIGTERM"));

  await app.listen({ port: config.porta, host: config.host });
}

main().catch((e) => {
  console.error("Falha ao iniciar o servidor:", e instanceof Error ? e.message : e);
  process.exit(1);
});
