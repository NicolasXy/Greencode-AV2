-- AV2 (respostas do cliente): soft delete, delete definitivo em cadeia,
-- codigo de barras = id e posicao automatica do equipamento no lote.

-- 1) Soft delete em Organizacao e Lote.
ALTER TABLE "Organizacao" ADD COLUMN "ativo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Organizacao" ADD COLUMN "inativadoEm" TIMESTAMPTZ(3);
ALTER TABLE "Lote" ADD COLUMN "ativo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Lote" ADD COLUMN "inativadoEm" TIMESTAMPTZ(3);

-- 2) Posicao automatica do equipamento no lote (backfill 1..N por ordem de criacao).
ALTER TABLE "Equipamento" ADD COLUMN "posicao" INTEGER;
UPDATE "Equipamento" e SET "posicao" = x.rn
  FROM (SELECT id, row_number() OVER (PARTITION BY "loteId" ORDER BY "criadoEm", id) AS rn FROM "Equipamento") x
  WHERE e.id = x.id;
ALTER TABLE "Equipamento" ALTER COLUMN "posicao" SET NOT NULL;
CREATE UNIQUE INDEX "Equipamento_loteId_posicao_key" ON "Equipamento"("loteId", "posicao");
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_posicao_chk" CHECK ("posicao" >= 1);

-- 3) Codigo de barras e o id do equipamento (backfill + regra no banco).
UPDATE "Equipamento" SET "codigoBarrasInterno" = id::text;
ALTER TABLE "Equipamento"
  ADD CONSTRAINT "Equipamento_codigo_igual_id_chk" CHECK ("codigoBarrasInterno" = id::text);

-- 4) Delete definitivo em cadeia: organizacao -> contrato/lotes -> equipamentos -> movimentacoes.
ALTER TABLE "Contrato" DROP CONSTRAINT "Contrato_organizacaoId_fkey";
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_organizacaoId_fkey"
  FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lote" DROP CONSTRAINT "Lote_organizacaoId_fkey";
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_organizacaoId_fkey"
  FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Equipamento" DROP CONSTRAINT "Equipamento_loteId_fkey";
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_loteId_fkey"
  FOREIGN KEY ("loteId") REFERENCES "Lote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Movimentacao" DROP CONSTRAINT "Movimentacao_equipamentoId_fkey";
ALTER TABLE "Movimentacao" ADD CONSTRAINT "Movimentacao_equipamentoId_fkey"
  FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5) Imutabilidade: continua proibido alterar/apagar Movimentacao e Auditoria
--    DIRETAMENTE. Acoes de chave estrangeira (cascata / SET NULL) executam
--    dentro de outro trigger (pg_trigger_depth() > 1) e sao permitidas.
CREATE OR REPLACE FUNCTION greencode_bloquear_alteracao() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A tabela % e imutavel (somente INSERT permitido).', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
