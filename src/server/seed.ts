// spiderman
import * as bcrypt from "bcrypt";
import { carregarConfiguracao } from "./config";
import { criarPrisma } from "./db/prisma";
import { UnidadeDeTrabalho } from "./db/unidadeDeTrabalho";
import { AuthService } from "./services/AuthService";
import { OrganizacaoService } from "./services/OrganizacaoService";
import { ContratoService } from "./services/ContratoService";
import { EquipamentoService } from "./services/EquipamentoService";
import { LoteService } from "./services/LoteService";
import { Ator } from "./services/tipos";

/** Gera um CNPJ valido (14 digitos com verificadores corretos) a partir de uma base de 12 digitos. */
function cnpjValido(base12: string): string {
  const dv = (digitos: string, pesos: number[]) => {
    const soma = digitos.split("").reduce((acc, d, i) => acc + Number(d) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = dv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${d2}`;
}

/** Data ISO (AAAA-MM-DD) deslocada em `dias` a partir de hoje (negativo = passado). */
function dataRelativa(dias: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().substring(0, 10);
}

/**
 * Seed (massa de dados inicial). Idempotente: se ja existirem usuarios, nao
 * faz nada (use `npm run db:reset` para recomecar). Todos os dados passam
 * pelos MESMOS services da API, entao as regras de negocio (CNPJ, datas,
 * triagem antes do desmonte, justificativa na queda de estado) tambem sao
 * exercitadas e documentadas pelo proprio seed.
 *
 * Senhas de desenvolvimento (troque em producao via SEED_SENHA):
 *   admin / cadastro1 / almox1 / auditor1  ->  valor de SEED_SENHA (padrao "Greencode#2026")
 */
async function main(): Promise<void> {
  const config = carregarConfiguracao();
  const prisma = criarPrisma(config.databaseUrl);
  const uow = new UnidadeDeTrabalho(prisma);
  const senha = process.env.SEED_SENHA ?? "Greencode#2026";

  try {
    if ((await uow.simples().usuarios.contar()) > 0) {
      console.log("Seed ignorado: o banco ja possui usuarios.");
      return;
    }

    const auth = new AuthService(uow, config.bcryptRounds);
    const orgs = new OrganizacaoService(uow);
    const contratos = new ContratoService(uow);
    const equipamentos = new EquipamentoService(uow);
    const lotes = new LoteService(uow, equipamentos);

    // ---- Usuarios (um por papel) ----
    const adminPublico = await auth.primeiroAdmin("admin", senha);
    const admin: Ator = { id: adminPublico.id, username: adminPublico.username, papel: "admin" };
    await auth.criarUsuario(admin, "cadastro1", senha, "cadastro");
    await auth.criarUsuario(admin, "almox1", senha, "almoxarifado");
    await auth.criarUsuario(admin, "auditor1", senha, "auditor");

    // ---- Organizacoes e contratos ----
    const cnpjs = [cnpjValido("112223330001"), cnpjValido("114447770001"), cnpjValido("459974180001"), cnpjValido("777666550001")];
    await orgs.criar(admin, cnpjs[0], "Tech Solutions Ltda", "contato@techsolutions.example");
    await orgs.criar(admin, cnpjs[1], "Banco Horizonte S.A.", "ti@horizonte.example");
    await orgs.criar(admin, cnpjs[2], "Escola Futuro Digital");
    await orgs.criar(admin, cnpjs[3], "Distribuidora Antiga ME");
    await contratos.criar(admin, {
      orgCnpj: cnpjs[0],
      dataInicio: dataRelativa(-200),
      frequenciaColetaDias: 30,
      condicoes: "Coleta mensal com certificado de destinacao.",
      clausulas: { multaAtrasoPercentual: 2, certificadoDestinacao: true },
    });
    await contratos.criar(admin, { orgCnpj: cnpjs[1], dataInicio: dataRelativa(-90), frequenciaColetaDias: 15 });
    // Org 3: contrato ENCERRADO (inativo) -> nao aceita lotes (regra do cliente), mas continua ativa.
    const contratoEscola = await contratos.criar(admin, { orgCnpj: cnpjs[2], dataInicio: dataRelativa(-120), frequenciaColetaDias: 45 });
    await contratos.encerrar(admin, contratoEscola.id);
    await contratos.criar(admin, { orgCnpj: cnpjs[3], dataInicio: dataRelativa(-80), frequenciaColetaDias: 30 });

    // ---- Lotes com equipamentos (datas dentro da janela de 90 dias) ----
    const l1 = await lotes.criar(admin, {
      orgCnpj: cnpjs[0],
      nf: "NF-0001",
      transportadora: "TransVerde",
      dataEntrada: dataRelativa(-60),
      equipamentos: [
        { tipo: "Terminal" },
        { tipo: "CPU" },
        { tipo: "Monitor" },
        { tipo: "Servidor" },
        { tipo: "Impressora" }, // tipo sem subclasse: EquipamentoGenerico
      ],
    });
    const l2 = await lotes.criar(admin, {
      orgCnpj: cnpjs[1],
      nf: "NF-0002",
      transportadora: "LogReversa Express",
      dataEntrada: dataRelativa(-10),
      equipamentos: [{ tipo: "CPU" }, { tipo: "CPU" }, { tipo: "Monitor" }],
    });
    // Lote vazio (ainda sem equipamentos conferidos).
    await lotes.criar(admin, { orgCnpj: cnpjs[1], nf: "NF-0003", transportadora: "TransVerde", dataEntrada: dataRelativa(0) });
    // Lote da organizacao que sera inativada (demonstra o soft delete em cadeia).
    await lotes.criar(admin, { orgCnpj: cnpjs[3], nf: "NF-0004", transportadora: "TransVerde", dataEntrada: dataRelativa(-20), equipamentos: [{ tipo: "CPU" }] });

    // ---- Estados variados nos equipamentos do lote 1 ----
    const [terminal, cpu, monitor, servidor] = l1.equipamentos;
    await equipamentos.concluirTriagem(admin, terminal.id);
    await equipamentos.mover(admin, terminal.id, "desmonte"); // permitido: triagem concluida

    await equipamentos.concluirTriagem(admin, cpu.id);
    await equipamentos.alterarEstado(admin, cpu.id, "regular", "Desgaste visivel na carcaca"); // queda com justificativa
    await equipamentos.mover(admin, cpu.id, "reciclagem");

    await equipamentos.concluirTriagem(admin, monitor.id);
    await equipamentos.alterarEstado(admin, monitor.id, "sucata", "Tela trincada, sem reparo possivel");
    await equipamentos.mover(admin, monitor.id, "descarte_seguro");

    await equipamentos.concluirTriagem(admin, servidor.id);
    await equipamentos.mover(admin, servidor.id, "revenda");
    // O equipamento 5 (Impressora) permanece "aguardando_triagem" de proposito:
    // como os equipamentos do lote 1 nao tem todos o mesmo status, o lote continua "recebido".

    // Lote 2: TODOS os equipamentos triados -> o status do lote passa sozinho para "triagem_completa".
    for (const e of l2.equipamentos) await equipamentos.concluirTriagem(admin, e.id);

    // Organizacao inativada (soft delete em cadeia): some das listagens junto com seus lotes e equipamentos.
    await orgs.inativar(admin, cnpjs[3]);

    // Verificacao de sanidade do hash (garante que o bcrypt do ambiente funciona).
    const u = await uow.simples().usuarios.buscarPorUsername("admin");
    if (!u || !(await bcrypt.compare(senha, u.senhaHash))) throw new Error("Falha na verificacao do hash do admin.");

    console.log("Seed concluido: 4 usuarios, 4 organizacoes (1 inativa), 4 contratos (1 encerrado), 4 lotes, 9 equipamentos.");
    console.log(`Login de desenvolvimento: admin / ${senha}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Falha no seed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
