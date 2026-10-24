// spiderman
import { Papel } from "../generated/prisma/enums";

/** Usuario autenticado que executa a operacao (extraido do JWT e confirmado no banco). */
export interface Ator {
  id: string;
  username: string;
  papel: Papel;
}

/** Parametros de paginacao ja normalizados. */
export interface Paginacao {
  pagina: number;
  tamanhoPagina: number;
}

export function paraSkipTake(p: Paginacao): { skip: number; take: number } {
  return { skip: (p.pagina - 1) * p.tamanhoPagina, take: p.tamanhoPagina };
}

/**
 * Define qual versao usar no controle otimista: a informada pelo cliente
 * (garante que ele esta agindo sobre o dado que viu) ou, se omitida, a
 * versao lida dentro da propria transacao (protege apenas contra corrida
 * entre leitura e escrita da mesma requisicao).
 */
export function versaoEfetiva(informada: number | undefined, atual: number): number {
  return informada ?? atual;
}
