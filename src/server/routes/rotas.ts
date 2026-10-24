// spiderman
import { FastifyInstance } from "fastify";
import { permitir } from "../plugins/autenticacao";
import { schemaExclusao, schemaId, schemaIncluirInativos, schemaPaginacao } from "../controllers/util";
import { AuthController } from "../controllers/AuthController";
import { ContratoController, OrganizacaoController } from "../controllers/OrganizacaoController";
import { AuditoriaController, EquipamentoController, LoteController, ParametroController } from "../controllers/LoteController";

const STATUS_LOTE = ["recebido", "em_triagem", "triagem_completa", "encerrado"];
const STATUS_EQUIP = ["aguardando_triagem", "em_triagem", "triado", "desmonte", "reciclagem", "descarte_seguro", "revenda"];
const PAPEIS = ["admin", "cadastro", "almoxarifado", "auditor"];

const versao = { type: "integer", minimum: 1, description: "Versao lida pelo cliente (controle otimista de concorrencia)." };
const query = (extra: Record<string, unknown> = {}) => ({
  type: "object",
  properties: { ...schemaPaginacao, ...extra },
});

export interface Controllers {
  auth: AuthController;
  organizacoes: OrganizacaoController;
  contratos: ContratoController;
  lotes: LoteController;
  equipamentos: EquipamentoController;
  auditoria: AuditoriaController;
  parametros: ParametroController;
}

/**
 * Tabela de rotas da API. Cada rota declara: JSON Schema de entrada (a
 * validacao acontece ANTES do controller), papeis autorizados (mesma
 * matriz do CLI) e o metodo do controller que a atende. O auditor e
 * bloqueado em qualquer metodo de escrita pelo hook global de autenticacao.
 */
export async function registrarRotas(app: FastifyInstance, c: Controllers): Promise<void> {
  // ---------------- Saude e autenticacao ----------------
  app.get("/health", { config: { publica: true }, schema: { tags: ["sistema"] } }, async () => ({
    status: "ok",
    horario: new Date().toISOString(),
  }));

  const credenciais = {
    type: "object",
    required: ["username", "senha"],
    additionalProperties: false,
    properties: { username: { type: "string", minLength: 3 }, senha: { type: "string", minLength: 1 } },
  };

  app.post("/auth/provisionar", {
    config: { publica: true },
    schema: { tags: ["auth"], summary: "Cria o primeiro administrador (so funciona com o banco sem usuarios)", body: credenciais },
    handler: c.auth.provisionar,
  });
  app.post("/auth/login", {
    config: { publica: true },
    schema: { tags: ["auth"], summary: "Autentica e devolve o JWT", body: credenciais },
    handler: c.auth.login,
  });
  app.get("/auth/me", { schema: { tags: ["auth"], summary: "Dados do usuario autenticado" }, handler: c.auth.me });
  app.post("/auth/senha", {
    config: { auditorPodeEscrever: true },
    schema: {
      tags: ["auth"],
      summary: "Altera a propria senha",
      body: {
        type: "object",
        required: ["senhaAtual", "novaSenha"],
        additionalProperties: false,
        properties: { senhaAtual: { type: "string" }, novaSenha: { type: "string" } },
      },
    },
    handler: c.auth.alterarSenha,
  });

  // ---------------- Usuarios (admin) ----------------
  app.post("/usuarios", {
    onRequest: permitir("admin"),
    schema: {
      tags: ["usuarios"],
      body: {
        type: "object",
        required: ["username", "senha", "papel"],
        additionalProperties: false,
        properties: { username: { type: "string" }, senha: { type: "string" }, papel: { type: "string", enum: PAPEIS } },
      },
    },
    handler: c.auth.criarUsuario,
  });
  app.get("/usuarios", { onRequest: permitir("admin"), schema: { tags: ["usuarios"] }, handler: c.auth.listarUsuarios });
  app.patch("/usuarios/:id/username", {
    onRequest: permitir("admin"),
    schema: {
      tags: ["usuarios"],
      summary: "Renomeia um usuario",
      params: schemaId,
      body: { type: "object", required: ["username"], additionalProperties: false, properties: { username: { type: "string" }, versao } },
    },
    handler: c.auth.renomearUsuario,
  });
  app.patch("/usuarios/:id/papel", {
    onRequest: permitir("admin"),
    schema: {
      tags: ["usuarios"],
      summary: "Altera o papel de outro usuario",
      params: schemaId,
      body: { type: "object", required: ["papel"], additionalProperties: false, properties: { papel: { type: "string", enum: PAPEIS }, versao } },
    },
    handler: c.auth.alterarPapel,
  });
  app.patch("/usuarios/:id/senha", {
    onRequest: permitir("admin"),
    schema: {
      tags: ["usuarios"],
      summary: "Admin redefine a senha de outro usuario",
      params: schemaId,
      body: { type: "object", required: ["novaSenha"], additionalProperties: false, properties: { novaSenha: { type: "string" }, versao } },
    },
    handler: c.auth.redefinirSenha,
  });
  app.delete("/usuarios/:id", {
    onRequest: permitir("admin"),
    schema: {
      tags: ["usuarios"],
      summary: "Soft delete (inativa) ou, com permanente=true, exclui de vez (somente sem historico)",
      params: schemaId,
      querystring: schemaExclusao,
    },
    handler: c.auth.removerUsuario,
  });
  app.patch("/usuarios/:id/ativo", {
    onRequest: permitir("admin"),
    schema: {
      tags: ["usuarios"],
      summary: "Ativa ou desativa um usuario",
      params: schemaId,
      body: { type: "object", required: ["ativo"], additionalProperties: false, properties: { ativo: { type: "boolean" }, versao } },
    },
    handler: c.auth.alterarAtivo,
  });

  // ---------------- Organizacoes ----------------
  const leituraOrg = permitir("admin", "cadastro", "auditor");
  const escritaOrg = permitir("admin", "cadastro");
  app.post("/organizacoes", {
    onRequest: escritaOrg,
    schema: {
      tags: ["organizacoes"],
      body: {
        type: "object",
        required: ["cnpj", "razaoSocial"],
        additionalProperties: false,
        properties: { cnpj: { type: "string" }, razaoSocial: { type: "string" }, contato: { type: "string" } },
      },
    },
    handler: c.organizacoes.criar,
  });
  app.get("/organizacoes", {
    onRequest: leituraOrg,
    schema: { tags: ["organizacoes"], querystring: query(schemaIncluirInativos) },
    handler: c.organizacoes.listar,
  });
  app.get("/organizacoes/:cnpj", { onRequest: leituraOrg, schema: { tags: ["organizacoes"] }, handler: c.organizacoes.obter });
  app.patch("/organizacoes/:cnpj", {
    onRequest: escritaOrg,
    schema: {
      tags: ["organizacoes"],
      body: {
        type: "object",
        additionalProperties: false,
        properties: { razaoSocial: { type: "string" }, contato: { type: ["string", "null"] }, versao },
      },
    },
    handler: c.organizacoes.atualizar,
  });

  app.delete("/organizacoes/:cnpj", {
    onRequest: escritaOrg,
    schema: {
      tags: ["organizacoes"],
      summary: "Soft delete em cadeia (organizacao + lotes) ou, com permanente=true (admin), delete definitivo em cadeia",
      querystring: schemaExclusao,
    },
    handler: c.organizacoes.remover,
  });
  app.post("/organizacoes/:cnpj/reativar", {
    onRequest: escritaOrg,
    schema: { tags: ["organizacoes"], summary: "Reativa a organizacao e os lotes inativados junto com ela", body: { type: ["object", "null"], additionalProperties: false, properties: { versao } } },
    handler: c.organizacoes.reativar,
  });

  // ---------------- Contratos ----------------
  app.post("/contratos", {
    onRequest: escritaOrg,
    schema: {
      tags: ["contratos"],
      body: {
        type: "object",
        required: ["orgCnpj", "dataInicio", "frequenciaColetaDias"],
        additionalProperties: false,
        properties: {
          orgCnpj: { type: "string" },
          dataInicio: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          frequenciaColetaDias: { type: "integer", minimum: 1 },
          condicoes: { type: "string" },
          clausulas: {},
        },
      },
    },
    handler: c.contratos.criar,
  });
  app.get("/contratos", { onRequest: leituraOrg, schema: { tags: ["contratos"], querystring: query(schemaIncluirInativos) }, handler: c.contratos.listar });
  app.get("/contratos/:id", { onRequest: leituraOrg, schema: { tags: ["contratos"], params: schemaId }, handler: c.contratos.obter });
  app.patch("/contratos/:id", {
    onRequest: escritaOrg,
    schema: {
      tags: ["contratos"],
      params: schemaId,
      body: {
        type: "object",
        additionalProperties: false,
        properties: { frequenciaColetaDias: { type: "integer", minimum: 1 }, condicoes: { type: ["string", "null"] }, clausulas: {}, versao },
      },
    },
    handler: c.contratos.atualizar,
  });
  app.delete("/contratos/:id", {
    onRequest: escritaOrg,
    schema: { tags: ["contratos"], summary: "Delete definitivo (contrato nao tem soft delete)", params: schemaId },
    handler: c.contratos.remover,
  });
  app.post("/contratos/:id/reativar", {
    onRequest: escritaOrg,
    schema: { tags: ["contratos"], summary: "Reabre um contrato encerrado", params: schemaId, body: { type: ["object", "null"], additionalProperties: false, properties: { versao } } },
    handler: c.contratos.reativar,
  });
  app.post("/contratos/:id/encerrar", {
    onRequest: escritaOrg,
    schema: { tags: ["contratos"], params: schemaId, body: { type: ["object", "null"], additionalProperties: false, properties: { versao } } },
    handler: c.contratos.encerrar,
  });

  // ---------------- Lotes ----------------
  const leituraLote = permitir("admin", "cadastro", "almoxarifado", "auditor");
  const escritaLote = permitir("admin", "cadastro", "almoxarifado");
  app.post("/lotes", {
    onRequest: escritaLote,
    schema: {
      tags: ["lotes"],
      summary: "Cria um lote (e opcionalmente seus equipamentos) em uma unica transacao",
      body: {
        type: "object",
        required: ["orgCnpj", "nf", "transportadora"],
        additionalProperties: false,
        properties: {
          orgCnpj: { type: "string" },
          nf: { type: "string" },
          transportadora: { type: "string" },
          dataEntrada: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          equipamentos: {
            type: "array",
            maxItems: 500,
            items: {
              type: "object",
              required: ["tipo"],
              additionalProperties: false,
              // O codigo de barras e o id do equipamento (gerado pelo servidor); a posicao no lote tambem e automatica.
              properties: { tipo: { type: "string", pattern: "\\S", description: "Tipo do equipamento (nao pode ser vazio)." } },
            },
          },
        },
      },
    },
    handler: c.lotes.criar,
  });
  app.get("/lotes", {
    onRequest: leituraLote,
    schema: { tags: ["lotes"], querystring: query({ status: { type: "string", enum: STATUS_LOTE }, cnpj: { type: "string" }, ...schemaIncluirInativos }) },
    handler: c.lotes.listar,
  });
  app.get("/lotes/:id", { onRequest: leituraLote, schema: { tags: ["lotes"], params: schemaId }, handler: c.lotes.obter });
  app.patch("/lotes/:id", {
    onRequest: escritaLote,
    schema: {
      tags: ["lotes"],
      summary: "Edita NF, transportadora ou data de entrada (mesmas validacoes da criacao)",
      params: schemaId,
      body: {
        type: "object",
        additionalProperties: false,
        properties: {
          nf: { type: "string" },
          transportadora: { type: "string" },
          dataEntrada: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          versao,
        },
      },
    },
    handler: c.lotes.atualizar,
  });
  // O status do lote NAO e alterado manualmente: e derivado dos equipamentos (ver services/statusLote.ts).
  app.delete("/lotes/:id", {
    onRequest: escritaLote,
    schema: {
      tags: ["lotes"],
      summary: "Soft delete do lote (equipamentos somem junto) ou, com permanente=true (admin), delete definitivo em cadeia",
      params: schemaId,
      querystring: schemaExclusao,
    },
    handler: c.lotes.remover,
  });
  app.post("/lotes/:id/reativar", {
    onRequest: escritaLote,
    schema: { tags: ["lotes"], params: schemaId, body: { type: ["object", "null"], additionalProperties: false, properties: { versao } } },
    handler: c.lotes.reativar,
  });

  // ---------------- Equipamentos ----------------
  const leituraEq = permitir("admin", "almoxarifado", "auditor");
  const escritaEq = permitir("admin", "almoxarifado");
  app.post("/equipamentos", {
    onRequest: escritaEq,
    schema: {
      tags: ["equipamentos"],
      body: {
        type: "object",
        required: ["loteId", "tipo"],
        additionalProperties: false,
        properties: { loteId: { type: "string", format: "uuid" }, tipo: { type: "string", pattern: "\\S", description: "Tipo do equipamento (nao pode ser vazio)." } },
      },
    },
    handler: c.equipamentos.cadastrar,
  });
  app.get("/equipamentos", {
    onRequest: leituraEq,
    schema: {
      tags: ["equipamentos"],
      querystring: query({ loteId: { type: "string", format: "uuid" }, status: { type: "string", enum: STATUS_EQUIP } }),
    },
    handler: c.equipamentos.listar,
  });
  app.patch("/equipamentos/:id", {
    onRequest: escritaEq,
    schema: {
      tags: ["equipamentos"],
      summary: "Corrige o tipo do equipamento",
      params: schemaId,
      body: { type: "object", required: ["tipo"], additionalProperties: false, properties: { tipo: { type: "string", pattern: "\\S" }, versao } },
    },
    handler: c.equipamentos.atualizarTipo,
  });
  app.delete("/equipamentos/:id", {
    onRequest: escritaEq,
    schema: { tags: ["equipamentos"], summary: "Delete definitivo (equipamento nao tem soft delete)", params: schemaId },
    handler: c.equipamentos.remover,
  });
  app.get("/equipamentos/:id", { onRequest: leituraEq, schema: { tags: ["equipamentos"], params: schemaId }, handler: c.equipamentos.obter });
  app.post("/equipamentos/:id/triagem", {
    onRequest: escritaEq,
    schema: { tags: ["equipamentos"], params: schemaId, body: { type: ["object", "null"], additionalProperties: false, properties: { versao } } },
    handler: c.equipamentos.concluirTriagem,
  });
  app.patch("/equipamentos/:id/status", {
    onRequest: escritaEq,
    schema: {
      tags: ["equipamentos"],
      params: schemaId,
      body: { type: "object", required: ["status"], additionalProperties: false, properties: { status: { type: "string", enum: STATUS_EQUIP }, versao } },
    },
    handler: c.equipamentos.mover,
  });
  app.patch("/equipamentos/:id/estado", {
    onRequest: escritaEq,
    schema: {
      tags: ["equipamentos"],
      params: schemaId,
      body: {
        type: "object",
        required: ["estadoFisico"],
        additionalProperties: false,
        properties: { estadoFisico: { type: "string" }, justificativa: { type: "string" }, versao },
      },
    },
    handler: c.equipamentos.alterarEstado,
  });
  app.get("/equipamentos/:id/depreciacao", {
    onRequest: leituraEq,
    schema: { tags: ["equipamentos"], params: schemaId, querystring: { type: "object", required: ["meses"], properties: { meses: { type: "number", minimum: 0 } } } },
    handler: c.equipamentos.depreciacao,
  });
  // Rastreio: todos os papeis autenticados podem consultar (igual ao CLI).
  app.get("/rastreio/:id", { schema: { tags: ["rastreio"], params: schemaId }, handler: c.equipamentos.rastreio });

  // ---------------- Parametros globais (admin) ----------------
  app.get("/config", { onRequest: permitir("admin"), schema: { tags: ["config"], summary: "Lista os parametros globais" }, handler: c.parametros.listar });
  app.get("/config/:chave", { onRequest: permitir("admin"), schema: { tags: ["config"] }, handler: c.parametros.obter });
  app.put("/config/:chave", {
    onRequest: permitir("admin"),
    schema: {
      tags: ["config"],
      summary: "Cria ou atualiza um parametro global (ex.: aliquota_icms)",
      body: { type: "object", required: ["valor"], additionalProperties: false, properties: { valor: { type: "string" }, versao } },
    },
    handler: c.parametros.definir,
  });
  app.delete("/config/:chave", { onRequest: permitir("admin"), schema: { tags: ["config"] }, handler: c.parametros.remover });

  // ---------------- Auditoria (equivalente ao journal) ----------------
  app.get("/auditoria", {
    onRequest: permitir("admin", "auditor"),
    schema: { tags: ["auditoria"], querystring: query({ acao: { type: "string" } }) },
    handler: c.auditoria.listar,
  });
}
