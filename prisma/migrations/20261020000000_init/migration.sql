-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('admin', 'cadastro', 'almoxarifado', 'auditor');

-- CreateEnum
CREATE TYPE "StatusLote" AS ENUM ('recebido', 'em_triagem', 'triagem_completa', 'encerrado');

-- CreateEnum
CREATE TYPE "StatusEquipamento" AS ENUM ('aguardando_triagem', 'em_triagem', 'triado', 'desmonte', 'reciclagem', 'descarte_seguro', 'revenda');

-- CreateEnum
CREATE TYPE "EstadoFisico" AS ENUM ('novo', 'seminovo', 'bom', 'regular', 'ruim', 'sucata');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "papel" "Papel" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organizacao" (
    "id" UUID NOT NULL,
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "contato" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organizacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contrato" (
    "id" UUID NOT NULL,
    "organizacaoId" UUID NOT NULL,
    "dataInicio" DATE NOT NULL,
    "frequenciaColetaDias" INTEGER NOT NULL,
    "condicoes" TEXT,
    "clausulas" JSONB,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contrato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lote" (
    "id" UUID NOT NULL,
    "organizacaoId" UUID NOT NULL,
    "nf" TEXT NOT NULL,
    "transportadora" TEXT NOT NULL,
    "dataEntrada" DATE NOT NULL,
    "status" "StatusLote" NOT NULL DEFAULT 'recebido',
    "criadoPorId" UUID NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipamento" (
    "id" UUID NOT NULL,
    "loteId" UUID NOT NULL,
    "codigoBarrasInterno" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "estadoFisico" "EstadoFisico" NOT NULL DEFAULT 'novo',
    "status" "StatusEquipamento" NOT NULL DEFAULT 'aguardando_triagem',
    "triagemCompleta" BOOLEAN NOT NULL DEFAULT false,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Equipamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Movimentacao" (
    "id" UUID NOT NULL,
    "equipamentoId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "statusDe" "StatusEquipamento",
    "statusPara" "StatusEquipamento",
    "estadoDe" "EstadoFisico",
    "estadoPara" "EstadoFisico",
    "justificativa" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Movimentacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auditoria" (
    "id" BIGSERIAL NOT NULL,
    "usuarioId" UUID,
    "acao" TEXT NOT NULL,
    "detalhes" JSONB,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_username_key" ON "Usuario"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Organizacao_cnpj_key" ON "Organizacao"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "Contrato_organizacaoId_key" ON "Contrato"("organizacaoId");

-- CreateIndex
CREATE INDEX "Lote_organizacaoId_idx" ON "Lote"("organizacaoId");

-- CreateIndex
CREATE INDEX "Lote_status_idx" ON "Lote"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Lote_organizacaoId_nf_key" ON "Lote"("organizacaoId", "nf");

-- CreateIndex
CREATE UNIQUE INDEX "Equipamento_codigoBarrasInterno_key" ON "Equipamento"("codigoBarrasInterno");

-- CreateIndex
CREATE INDEX "Equipamento_loteId_idx" ON "Equipamento"("loteId");

-- CreateIndex
CREATE INDEX "Equipamento_status_idx" ON "Equipamento"("status");

-- CreateIndex
CREATE INDEX "Movimentacao_equipamentoId_criadoEm_idx" ON "Movimentacao"("equipamentoId", "criadoEm");

-- CreateIndex
CREATE INDEX "Auditoria_criadoEm_idx" ON "Auditoria"("criadoEm");

-- CreateIndex
CREATE INDEX "Auditoria_acao_idx" ON "Auditoria"("acao");

-- AddForeignKey
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "Lote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimentacao" ADD CONSTRAINT "Movimentacao_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimentacao" ADD CONSTRAINT "Movimentacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auditoria" ADD CONSTRAINT "Auditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
