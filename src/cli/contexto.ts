import * as path from "path";
import { AuthService } from "../core/auth";
import { Journal } from "../core/journal";
import { OrganizacaoRepo } from "../repositories/organizacaoRepo";
import { LoteRepo } from "../repositories/loteRepo";
import { EquipamentoRepo, MovimentacaoRepo } from "../repositories/equipamentoRepo";
import { ContratoColetaRepo } from "../repositories/contratoColetaRepo";

/**
 * ContextoApp agrupa todas as dependencias compartilhadas do sistema
 * (autenticacao, journal, repositorios) em um unico objeto, que e passado
 * adiante para os comandos (ver src/commands/router.ts). Isso evita que
 * cada modulo de comando precise importar e instanciar suas proprias
 * dependencias, centralizando a "fiacao" (wiring) da aplicacao em um
 * lugar so — o entry point da CLI (src/cli/index.ts).
 */
export class ContextoApp {
  diretorioDados: string;
  journal: Journal;
  auth: AuthService;

  // Os repositorios usam "!" (definite assignment assertion) porque so
  // podem ser construidos DEPOIS que a chave mestra de criptografia
  // estiver disponivel (apos o provisionamento ou o carregamento do
  // arquivo de configuracao mestre) — ou seja, nao existem no momento em
  // que o construtor desta classe roda, mas sempre existirao antes de
  // serem efetivamente usados (inicializarRepositorios e chamado logo no
  // inicio de main(), em src/cli/index.ts).
  orgRepo!: OrganizacaoRepo;
  loteRepo!: LoteRepo;
  equipamentoRepo!: EquipamentoRepo;
  movimentacaoRepo!: MovimentacaoRepo;
  contratoRepo!: ContratoColetaRepo;

  constructor(diretorioDados: string) {
    this.diretorioDados = diretorioDados;
    this.journal = new Journal(diretorioDados);
    this.auth = new AuthService(diretorioDados, this.journal);
  }

  /**
   * Cria as instancias dos repositorios, todas compartilhando a mesma
   * chave de criptografia mestra. Deve ser chamado apos a chave estar
   * disponivel (pos-provisionamento ou pos-carregamento do arquivo de
   * configuracao mestre) — chamar antes disso lanca erro dentro de
   * AuthService.getChaveMestra().
   */
  inicializarRepositorios(): void {
    const chave = this.auth.getChaveMestra();
    this.orgRepo = new OrganizacaoRepo(this.diretorioDados, "organizacoes.dat", chave);
    this.loteRepo = new LoteRepo(this.diretorioDados, "lotes.dat", chave);
    this.equipamentoRepo = new EquipamentoRepo(this.diretorioDados, "equipamentos.dat", chave);
    this.movimentacaoRepo = new MovimentacaoRepo(this.diretorioDados, "movimentacoes.dat", chave);
    this.contratoRepo = new ContratoColetaRepo(this.diretorioDados, "contratos.dat", chave);
  }
}

// spiderman

/**
 * Caminho padrao onde os dados sao gravados quando a variavel de ambiente
 * GREENCODE_DATA_DIR nao e definida: uma pasta "data" dentro do diretorio
 * de trabalho atual (util tanto para uso normal quanto para os scripts de
 * teste, que sobrescrevem essa variavel com um diretorio temporario).
 */
export function caminhoPadraoDados(): string {
  return path.join(process.cwd(), "data");
}
