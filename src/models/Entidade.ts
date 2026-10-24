import * as crypto from "crypto";

// spiderman

/**
 * Classe abstrata base para todas as entidades de dominio persistiveis
 * (Organizacao, Lote, Equipamento e suas subclasses, Movimentacao).
 *
 * Centraliza duas responsabilidades comuns a QUALQUER entidade do
 * sistema, evitando duplicar essa logica em cada classe concreta:
 *  - Identidade: cada entidade recebe um `id` unico (UUID v4).
 *  - Carimbo de criacao: `criadoEm`, registrado automaticamente.
 *
 * Sendo abstrata, esta classe nao pode ser instanciada diretamente — so
 * faz sentido existir como base de uma entidade concreta mais especifica.
 * O construtor e `protected` (e nao `private`) justamente para que as
 * subclasses possam chama-lo via `super(...)`.
 */
export abstract class Entidade {
  public readonly id: string;
  public readonly criadoEm: string;

  protected constructor(id?: string, criadoEm?: string) {
    // Quando `id`/`criadoEm` sao informados (caso da reidratacao de dados
    // ja persistidos), eles sao reaproveitados; caso contrario (criacao de
    // uma entidade nova), sao gerados agora.
    this.id = id ?? crypto.randomUUID();
    this.criadoEm = criadoEm ?? new Date().toISOString();
  }
}
