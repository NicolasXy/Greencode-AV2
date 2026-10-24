-- Restricoes de integridade que o Prisma Schema nao consegue expressar.
-- Elas impedem que estados inconsistentes sejam persistidos mesmo por
-- caminhos que contornem a camada de servico (scripts, SQL manual, bugs).

-- CNPJ armazenado sempre normalizado: exatamente 14 digitos.
ALTER TABLE "Organizacao"
  ADD CONSTRAINT "Organizacao_cnpj_formato_chk" CHECK ("cnpj" ~ '^[0-9]{14}$');

-- Contrato: frequencia de coleta estritamente positiva.
ALTER TABLE "Contrato"
  ADD CONSTRAINT "Contrato_frequencia_chk" CHECK ("frequenciaColetaDias" > 0);

-- Versao otimista sempre positiva em todas as tabelas versionadas.
ALTER TABLE "Usuario"     ADD CONSTRAINT "Usuario_versao_chk"     CHECK ("versao" >= 1);
ALTER TABLE "Organizacao" ADD CONSTRAINT "Organizacao_versao_chk" CHECK ("versao" >= 1);
ALTER TABLE "Contrato"    ADD CONSTRAINT "Contrato_versao_chk"    CHECK ("versao" >= 1);
ALTER TABLE "Lote"        ADD CONSTRAINT "Lote_versao_chk"        CHECK ("versao" >= 1);
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_versao_chk" CHECK ("versao" >= 1);

-- Regra de negocio: nenhum equipamento pode estar em 'desmonte' sem triagem completa.
ALTER TABLE "Equipamento"
  ADD CONSTRAINT "Equipamento_desmonte_exige_triagem_chk"
  CHECK ("status" <> 'desmonte' OR "triagemCompleta" = true);

-- Codigo de barras nao pode ser vazio.
ALTER TABLE "Equipamento"
  ADD CONSTRAINT "Equipamento_codigo_nao_vazio_chk" CHECK (length(btrim("codigoBarrasInterno")) > 0);

-- Movimentacao deve registrar mudanca de status OU de estado fisico, sempre em pares (de/para).
ALTER TABLE "Movimentacao"
  ADD CONSTRAINT "Movimentacao_par_chk" CHECK (
    ("statusDe" IS NULL) = ("statusPara" IS NULL)
    AND ("estadoDe" IS NULL) = ("estadoPara" IS NULL)
    AND ("statusDe" IS NOT NULL OR "estadoDe" IS NOT NULL)
  );

-- Movimentacoes e auditoria sao imutaveis: UPDATE e DELETE sao bloqueados por trigger.
CREATE OR REPLACE FUNCTION greencode_bloquear_alteracao() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A tabela % e imutavel (somente INSERT permitido).', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Movimentacao_imutavel_trg"
  BEFORE UPDATE OR DELETE ON "Movimentacao"
  FOR EACH ROW EXECUTE FUNCTION greencode_bloquear_alteracao();

CREATE TRIGGER "Auditoria_imutavel_trg"
  BEFORE UPDATE OR DELETE ON "Auditoria"
  FOR EACH ROW EXECUTE FUNCTION greencode_bloquear_alteracao();
