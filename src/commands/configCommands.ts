import * as path from "path";
import { ComandoParseado } from "../cli/parser";
import { ContextoApp } from "../cli/contexto";
import { ErroValidacao } from "../types";
import { escreverSeguro, lerSeguro } from "../core/storage";

/**
 * Formato do arquivo de parametros globais: um dicionario simples de
 * chave/valor em texto (ex.: aliquotas de imposto, coeficientes de
 * depreciacao configuraveis por politica administrativa). Mantido
 * deliberadamente generico para nao exigir alteracao de codigo cada vez
 * que um novo parametro precisar ser adicionado.
 */
interface ParametrosGlobais {
  [chave: string]: string;
}

function caminhoParametros(ctx: ContextoApp): string {
  return path.join(ctx.diretorioDados, "parametros.dat");
}

/**
 * Comandos do recurso "config": definir/consultar parametros globais e
 * disparar a politica de retencao do journal. Restrito ao papel admin.
 */
export function executarConfig(ctx: ContextoApp, cmd: ComandoParseado): string {
  const chaveMestra = ctx.auth.getChaveMestra();
  switch (cmd.acao) {
    case "set": {
      const nome = cmd.posicionais[0];
      const valor = cmd.posicionais[1];
      if (!nome || valor === undefined) {
        throw new ErroValidacao("Uso: config set <parametro> <valor>  (ex.: config set aliquota_icms 0.18)");
      }
      // Le o dicionario atual, atualiza apenas a chave informada e regrava
      // o arquivo inteiro (o volume de dados e pequeno, entao reescrever
      // tudo a cada "set" e simples e seguro, sem necessidade de um
      // formato de atualizacao parcial).
      const params = lerSeguro<ParametrosGlobais>(caminhoParametros(ctx), chaveMestra, {});
      params[nome] = valor;
      // Write-ahead: journal antes da gravacao do arquivo de parametros.
      ctx.journal.registrar(ctx.auth.getSessao()!.username, "PARAMETRO_ALTERADO", { nome, valor });
      escreverSeguro(caminhoParametros(ctx), chaveMestra, params);
      return `[OK] Parametro '${nome}' definido como '${valor}'.`;
    }
    case "get": {
      const nome = cmd.posicionais[0];
      const params = lerSeguro<ParametrosGlobais>(caminhoParametros(ctx), chaveMestra, {});
      if (!nome) {
        // Sem argumento, lista todos os parametros configurados.
        const entradas = Object.entries(params);
        if (entradas.length === 0) return "Nenhum parametro configurado.";
        return entradas.map(([k, v]) => `${k} = ${v}`).join("\n");
      }
      return params[nome] !== undefined ? `${nome} = ${params[nome]}` : `Parametro '${nome}' nao definido.`;
    }
    case "retencao": {
      // Dispara manualmente a limpeza de arquivos de journal ja
      // arquivados que ultrapassaram a retencao minima de 180 dias
      // (ver Journal.aplicarPoliticaRetencao em src/core/journal.ts).
      const removidos = ctx.journal.aplicarPoliticaRetencao();
      return removidos.length === 0
        ? "Nenhum arquivo de journal elegivel para remocao (retencao minima de 180 dias)."
        : `[OK] Arquivos de journal removidos apos 180 dias de retencao: ${removidos.join(", ")}`;
    }
    default:
      throw new ErroValidacao("Subcomando desconhecido para 'config'. Use: set | get | retencao");
  }
}

// spiderman
