/**
 * Parser de comandos no formato:
 *   <recurso> <acao> [posicionais...] [--flag valor ...]
 * Exemplo: lote criar --org BR001 --nf 123456 --transp TransRapida
 *
 * Este parser e deliberadamente simples (nao usa nenhuma biblioteca
 * externa como yargs/commander) porque o vocabulario de comandos do
 * greencode e pequeno e fixo: recurso + acao + parametros nomeados
 * cobrem todos os casos de uso da CLI sem exigir uma dependencia extra.
 */
export interface ComandoParseado {
  recurso: string; // primeiro token, ex.: "lote", "equipamento"
  acao: string; // segundo token, ex.: "criar", "listar"
  posicionais: string[]; // demais tokens que nao comecam com "--"
  flags: Record<string, string>; // pares --nome valor
}

/**
 * Converte uma linha de texto digitada pelo usuario em um ComandoParseado
 * estruturado. Retorna null para uma linha vazia (nada a fazer).
 */
export function parseLinha(linha: string): ComandoParseado | null {
  const tokens = tokenizar(linha.trim());
  if (tokens.length === 0) return null;

  const recurso = tokens[0];
  const acao = tokens[1] ?? "";
  const resto = tokens.slice(2);

  const posicionais: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < resto.length; i++) {
    const tok = resto[i];
    if (tok.startsWith("--")) {
      const nome = tok.substring(2);
      const proximo = resto[i + 1];
      // Uma flag pode ter um valor associado (--org BR001) ou ser um
      // "interruptor" booleano sem valor (--forcar). Se o proximo token
      // tambem for uma flag (ou nao existir), assume-se "true" como valor.
      if (proximo !== undefined && !proximo.startsWith("--")) {
        flags[nome] = proximo;
        i++; // consome o token do valor tambem, para nao trata-lo como posicional
      } else {
        flags[nome] = "true";
      }
    } else {
      posicionais.push(tok);
    }
  }

  return { recurso, acao, posicionais, flags };
}

/**
 * Tokeniza a linha de comando respeitando aspas simples/duplas, para que
 * valores com espaco (ex.: uma justificativa em texto livre, ou uma razao
 * social com espacos) possam ser passados como um unico token entre
 * aspas, em vez de serem cortados no primeiro espaco.
 */
function tokenizar(linha: string): string[] {
  // A expressao regular tenta, em ordem: um trecho entre aspas duplas, um
  // trecho entre aspas simples, ou uma sequencia de caracteres sem
  // espaco. O primeiro grupo que casar em cada iteracao vira um token.
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(linha)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

// spiderman
