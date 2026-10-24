/**
 * Tipos, enums e erros compartilhados do dominio greencode.
 *
 * Este arquivo NAO contem as entidades de dominio (Organizacao, Lote,
 * Equipamento, Movimentacao): elas sao classes reais em `src/models/`,
 * com heranca, encapsulamento e polimorfismo, construidas por fabricas em
 * `src/factories/`. Aqui ficam apenas os tipos "primitivos" (enums/unions)
 * usados por essas classes e pela infraestrutura (autenticacao, sessao,
 * journal) — ou seja, blocos de construcao pequenos e reutilizaveis que
 * nao fazem sentido como uma classe por si so.
 */

// spiderman

// Papel de acesso que um usuario pode ter no sistema. Cada papel define um
// conjunto de comandos permitidos (ver src/commands/router.ts).
export type Papel = "admin" | "cadastro" | "almoxarifado" | "auditor";

// Lista de todos os papeis existentes, usada para validar entrada do
// usuario (ex.: comando "usuario criar ... --papel X" precisa verificar se
// X e um papel valido) e para gerar mensagens de erro completas.
export const TODOS_PAPEIS: Papel[] = ["admin", "cadastro", "almoxarifado", "auditor"];

/**
 * Representacao "publica" de um usuario do sistema (sem dados sensiveis
 * como senha/hash). Usada, por exemplo, quando o administrador lista os
 * usuarios cadastrados (o hash e o salt da senha nunca sao expostos).
 */
export interface Usuario {
  username: string;
  papel: Papel;
  criadoEm: string; // data/hora de criacao, em formato ISO 8601
  ativo: boolean; // usuarios desativados nao conseguem mais fazer login
}

/**
 * Representacao COMPLETA de uma credencial de usuario, incluindo o salt e
 * o hash da senha. E o formato realmente gravado (cifrado) no arquivo
 * credenciais.dat. Nunca deve ser exposta para fora da camada de
 * autenticacao (src/core/auth.ts).
 */
export interface CredencialArmazenada {
  username: string;
  salt: string; // valor aleatorio (hex) usado para evitar ataques de rainbow table
  hash: string; // hex - SHA-256(salt + senha), aplicado iterativamente (ver core/crypto.ts)
  papel: Papel;
  criadoEm: string;
  ativo: boolean;
}

// Estados fisicos possiveis de um equipamento, ORDENADOS do melhor para o
// pior estado. A ORDEM DO ARRAY IMPORTA: o indice de cada estado dentro
// deste array representa sua "categoria" de conservacao, e essa categoria
// e usada para calcular se uma mudanca de estado fisico caiu 2 ou mais
// posicoes (regra que exige justificativa textual — ver
// src/core/validators.ts / exigeJustificativaParaEstado).
export const ESTADOS_FISICOS = ["novo", "seminovo", "bom", "regular", "ruim", "sucata"] as const;

// Tipo derivado automaticamente do array acima, garantindo que qualquer
// variavel do tipo EstadoFisico so possa assumir um dos valores listados.
export type EstadoFisico = (typeof ESTADOS_FISICOS)[number];

// Ciclo de vida de um lote de equipamentos recebido de uma organizacao,
// desde a chegada ate o encerramento do processamento.
export type StatusLote = "recebido" | "em_triagem" | "triagem_completa" | "encerrado";

// Ciclo de vida de um equipamento individual dentro de um lote: da
// chegada (aguardando triagem) ate o destino final (reciclagem, descarte
// seguro ou revenda). A transicao para "desmonte" so e permitida apos a
// triagem estar completa (regra aplicada na propria entidade Equipamento).
export type StatusEquipamento =
  | "aguardando_triagem"
  | "em_triagem"
  | "triado"
  | "desmonte"
  | "reciclagem"
  | "descarte_seguro"
  | "revenda";

/**
 * Formato de uma linha gravada no journal (log de auditoria write-ahead).
 * Cada operacao relevante do sistema gera uma entrada como esta ANTES de
 * ser aplicada ao estado corrente, permitindo reconstruir o historico e
 * detectar adulteracao via checksum. Ver src/core/journal.ts.
 */
export interface EntradaJournal {
  seq: number; // numero sequencial, usado para ordenar e detectar linhas faltantes
  timestamp: string;
  usuario: string;
  acao: string; // identificador textual da operacao, ex.: "LOGIN_SUCESSO"
  payload: unknown; // dados especificos da operacao (formato varia por acao)
  checksum: string; // SHA-256 da entrada (sem o proprio checksum), para deteccao de adulteracao
}

/**
 * Representa uma sessao de usuario autenticado, mantida apenas em memoria
 * durante a execucao do processo (nunca persistida em disco). Controla a
 * expiracao por inatividade (30 minutos) feita em src/core/auth.ts.
 */
export interface SessaoAtiva {
  username: string;
  papel: Papel;
  loginEm: string; // instante do login, em ISO 8601
  ultimaAtividade: string; // atualizado a cada comando executado (janela deslizante de expiracao)
}

// --- Classes de erro do dominio -------------------------------------------
//
// Definir subclasses especificas de Error (em vez de lancar Error generico
// ou strings) permite que a camada de CLI (src/cli/index.ts) trate cada
// categoria de falha de forma diferente: ErroValidacao vira uma mensagem
// de erro comum; ErroPermissao indica bloqueio de RBAC; ErroSessao forca
// um novo login. Ver o bloco try/catch do loop de comandos na CLI.

/** Erro lancado quando um dado de entrada ou uma regra de negocio e violada. */
export class ErroValidacao extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErroValidacao";
  }
}

/** Erro lancado quando o usuario autenticado nao tem permissao (papel) para executar a acao pedida. */
export class ErroPermissao extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErroPermissao";
  }
}

/** Erro lancado quando nao ha sessao ativa ou a sessao expirou por inatividade. */
export class ErroSessao extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErroSessao";
  }
}
