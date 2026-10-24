// spiderman
import { Paginacao } from "../services/tipos";

/** Query string padrao de paginacao (usada nos JSON Schemas das rotas de listagem). */
export const schemaPaginacao = {
  pagina: { type: "integer", minimum: 1, default: 1 },
  tamanhoPagina: { type: "integer", minimum: 1, maximum: 100, default: 20 },
} as const;

export const schemaId = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

export function lerPaginacao(q: { pagina?: number; tamanhoPagina?: number }): Paginacao {
  return { pagina: q.pagina ?? 1, tamanhoPagina: q.tamanhoPagina ?? 20 };
}

/** Monta o envelope de resposta paginada. */
export function paginado<T>(r: { itens: T[]; total: number }, p: Paginacao) {
  return {
    itens: r.itens,
    total: r.total,
    pagina: p.pagina,
    tamanhoPagina: p.tamanhoPagina,
    totalPaginas: Math.max(1, Math.ceil(r.total / p.tamanhoPagina)),
  };
}

/** Query string dos DELETE de entidades com soft delete: `permanente=true` pede o delete definitivo. */
export const schemaExclusao = {
  type: "object",
  properties: {
    permanente: { type: "boolean", default: false, description: "false = soft delete (inativar); true = delete definitivo em cadeia (somente admin)." },
    versao: { type: "integer", minimum: 1 },
  },
} as const;

export const schemaIncluirInativos = {
  incluirInativos: { type: "boolean", default: false, description: "Inclui registros inativados (soft delete)." },
} as const;
