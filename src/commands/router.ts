import { ComandoParseado } from "../cli/parser";
import { ContextoApp } from "../cli/contexto";
import { ErroValidacao, Papel } from "../types";
import { executarUsuario } from "./usuarioCommands";
import { executarOrg } from "./orgCommands";
import { executarContrato } from "./contratoCommands";
import { executarLote } from "./loteCommands";
import { executarEquipamento } from "./equipamentoCommands";
import { executarRastreio } from "./rastreioCommands";
import { executarConfig } from "./configCommands";

/**
 * Roteador de comandos: ponto UNICO por onde toda entrada da CLI passa
 * antes de chegar aos modulos de comando especificos. Responsabilidades:
 *  1. Verificar se o recurso pedido existe.
 *  2. Aplicar o controle de acesso baseado em papel (RBAC).
 *  3. Despachar para a funcao executora correta.
 *  4. Fornecer, para o menu dinamico da CLI, a lista de comandos que cada
 *     papel pode usar.
 */

/**
 * Matriz de permissoes: para cada recurso, quais papeis podem executar
 * ALGUMA acao daquele recurso (a granularidade fina — que acao
 * especificamente — e resolvida pela segunda camada, ACOES_SOMENTE_LEITURA,
 * logo abaixo). O papel 'auditor' e incluido em TODOS os recursos de
 * consulta (org, contrato, lote, equipamento, rastreio), pois a
 * especificacao do sistema define seu acesso como "consultar historicos e
 * gerar relatorios, sem qualquer capacidade de alteracao" — ou seja, o
 * auditor deve conseguir LER qualquer dado do sistema, apenas nunca
 * escrever. Sem essa segunda camada, seria necessario duplicar cada
 * recurso em uma entrada "somente leitura" separada; com ela, o mesmo
 * recurso serve tanto para quem pode escrever quanto para quem so pode ler.
 */
const PERMISSOES: Record<string, Papel[]> = {
  usuario: ["admin"],
  config: ["admin"],
  org: ["admin", "cadastro", "auditor"],
  contrato: ["admin", "cadastro", "auditor"],
  lote: ["admin", "cadastro", "almoxarifado", "auditor"],
  equipamento: ["admin", "almoxarifado", "auditor"],
  rastreio: ["admin", "cadastro", "almoxarifado", "auditor"],
};

// Acoes de escrita bloqueadas para o papel 'auditor' mesmo em recursos
// onde ele tem acesso de leitura (como "rastreio"). Esta e uma SEGUNDA
// camada de controle, alem da matriz PERMISSOES acima: mesmo que um
// recurso esteja liberado para o auditor, uma acao especifica dentro
// dele so e permitida se estiver nesta lista.
const ACOES_SOMENTE_LEITURA = new Set(["listar", "ver", "get", "journal", "equipamento", "depreciacao"]);

/**
 * Ponto de entrada usado pela CLI para executar qualquer comando digitado
 * pelo usuario. Aplica as duas camadas de controle de acesso descritas
 * acima antes de despachar para o modulo de comando correspondente.
 */
export function despachar(ctx: ContextoApp, cmd: ComandoParseado): string {
  const papeisPermitidos = PERMISSOES[cmd.recurso];
  if (!papeisPermitidos) {
    throw new ErroValidacao(`Recurso desconhecido: '${cmd.recurso}'. Digite 'ajuda' para ver os comandos.`);
  }

  // exigirPapel tambem valida que a sessao existe e nao expirou por
  // inatividade (ver AuthService.exigirSessaoValida).
  const sessao = ctx.auth.exigirPapel(...papeisPermitidos);

  if (sessao.papel === "auditor" && !ACOES_SOMENTE_LEITURA.has(cmd.acao)) {
    throw new ErroValidacao(
      `O papel 'auditor' possui acesso somente de consulta. Acao '${cmd.acao}' nao permitida.`
    );
  }

  // spiderman

  switch (cmd.recurso) {
    case "usuario":
      return executarUsuario(ctx, cmd);
    case "org":
      return executarOrg(ctx, cmd);
    case "contrato":
      return executarContrato(ctx, cmd);
    case "lote":
      return executarLote(ctx, cmd);
    case "equipamento":
      return executarEquipamento(ctx, cmd);
    case "rastreio":
      return executarRastreio(ctx, cmd);
    case "config":
      return executarConfig(ctx, cmd);
    default:
      // Este caso e teoricamente inalcancavel (ja foi checado no inicio
      // da funcao), mas fica aqui como rede de seguranca caso um novo
      // recurso seja adicionado a PERMISSOES sem um "case" correspondente.
      throw new ErroValidacao(`Recurso desconhecido: '${cmd.recurso}'.`);
  }
}

/**
 * Monta a lista de comandos disponiveis para um papel especifico, usada
 * tanto pelo comando "ajuda" quanto pelo autocompletar da CLI (ver
 * src/cli/index.ts). A logica reflete as mesmas duas camadas de
 * permissao aplicadas em despachar(): primeiro filtra por recurso
 * permitido, depois (no caso do auditor) filtra tambem por acao de
 * leitura.
 */
export function comandosDisponiveisParaPapel(papel: Papel): string[] {
  const base: Record<string, string[]> = {
    usuario: ["usuario criar", "usuario desativar", "usuario renomear", "usuario listar"],
    config: ["config set", "config get", "config retencao"],
    org: ["org criar", "org ver", "org listar"],
    contrato: ["contrato criar", "contrato ver", "contrato listar", "contrato encerrar"],
    lote: ["lote criar", "lote ver", "lote listar", "lote status"],
    equipamento: [
      "equipamento cadastrar",
      "equipamento triagem",
      "equipamento mover",
      "equipamento estado",
      "equipamento ver",
      "equipamento listar",
      "equipamento depreciacao",
    ],
    rastreio: ["rastreio equipamento", "rastreio journal"],
  };

  const disponiveis: string[] = [];
  for (const [recurso, comandos] of Object.entries(base)) {
    const permitido = (PERMISSOES[recurso] ?? []).includes(papel);
    if (!permitido) continue;
    if (papel === "auditor") {
      // Para o auditor, so inclui os comandos cuja acao (segunda palavra,
      // ex.: "listar" em "org listar") esteja na lista de leitura.
      disponiveis.push(...comandos.filter((c) => ACOES_SOMENTE_LEITURA.has(c.split(" ")[1])));
    } else {
      disponiveis.push(...comandos);
    }
  }
  return disponiveis;
}
