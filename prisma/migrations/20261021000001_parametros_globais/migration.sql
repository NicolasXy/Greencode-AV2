-- Parametros globais (admin): chave/valor versionado, como o "config set/get" do CLI.
CREATE TABLE "ParametroGlobal" (
    "chave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParametroGlobal_pkey" PRIMARY KEY ("chave")
);
ALTER TABLE "ParametroGlobal" ADD CONSTRAINT "ParametroGlobal_chave_chk" CHECK ("chave" ~ '^[A-Za-z0-9_.-]{1,64}$');
ALTER TABLE "ParametroGlobal" ADD CONSTRAINT "ParametroGlobal_versao_chk" CHECK ("versao" >= 1);
