import * as fs from "fs";
import * as path from "path";
import { EntradaJournal } from "../types";
import { sha256Hex } from "./crypto";
import { apendarLinha, garantirDiretorio } from "./storage";

/**
 * Mecanismo de journaling (log de auditoria write-ahead).
 *
 * Toda operacao relevante do sistema (login, criacao de registros,
 * mudancas de estado de equipamento etc.) e registrada em um arquivo
 * imutavel (apenas acrescimo, nunca edicao) ANTES ou logo apos ser
 * aplicada ao estado corrente. Isso garante:
 *
 *  - Rastreabilidade: e possivel reconstruir "quem fez o que e quando".
 *  - Deteccao de adulteracao: cada entrada carrega um checksum SHA-256.
 *  - Recuperacao: em caso de falha, o journal e a fonte de verdade sobre
 *    o que realmente aconteceu no sistema.
 *
 * Politicas aplicadas por este modulo:
 *  - Retencao minima de 180 dias: arquivos ja rotacionados (arquivados)
 *    nunca sao apagados antes de completarem 180 dias de existencia.
 *  - Rotacao automatica quando o arquivo de journal ativo ultrapassa
 *    10 MB: o arquivo corrente e renomeado (arquivado) e um novo
 *    journal.log vazio passa a receber as novas entradas.
 */

// spiderman

// Limite de tamanho, em bytes, que dispara a rotacao do arquivo de journal ativo.
const TAMANHO_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Numero minimo de dias que um arquivo de journal ja rotacionado deve
// permanecer em disco antes de poder ser removido pela politica de retencao.
const RETENCAO_MIN_DIAS = 180;

export class Journal {
  private diretorio: string; // pasta onde ficam o journal ativo e os arquivos rotacionados
  private arquivoAtivo: string; // caminho do arquivo que esta recebendo novas entradas agora
  private seqAtual = 0; // ultimo numero de sequencia usado, para continuar a contagem entre execucoes

  constructor(diretorioDados: string) {
    this.diretorio = path.join(diretorioDados, "journal");
    garantirDiretorio(this.diretorio);
    this.arquivoAtivo = path.join(this.diretorio, "journal.log");
    this.seqAtual = this.carregarUltimaSeq();
  }

  /**
   * Le a ultima linha do journal ativo (se existir) para descobrir qual foi
   * o ultimo numero de sequencia usado, evitando reiniciar a contagem do
   * zero (o que causaria sequencias duplicadas) toda vez que o programa e
   * reiniciado.
   */
  private carregarUltimaSeq(): number {
    if (!fs.existsSync(this.arquivoAtivo)) return 0;
    const linhas = fs
      .readFileSync(this.arquivoAtivo, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    if (linhas.length === 0) return 0;
    try {
      const ultima = JSON.parse(linhas[linhas.length - 1]) as EntradaJournal;
      return ultima.seq;
    } catch {
      // Se a ultima linha estiver corrompida (por exemplo, o processo foi
      // encerrado no meio de uma escrita anterior), usa a contagem de
      // linhas como aproximacao segura em vez de travar a inicializacao.
      return linhas.length;
    }
  }

  /**
   * Registra uma nova entrada no journal. E chamado pela camada de
   * autenticacao e pelos comandos sempre que uma operacao relevante
   * acontece (login, criacao de usuario, mudanca de estado etc.).
   */
  registrar(usuario: string, acao: string, payload: unknown): EntradaJournal {
    this.rotacionarSeNecessario();
    this.seqAtual += 1;
    const base = {
      seq: this.seqAtual,
      timestamp: new Date().toISOString(),
      usuario,
      acao,
      payload,
    };
    // O checksum e calculado sobre os dados da entrada SEM incluir o
    // proprio checksum (senao seria circular). Qualquer alteracao
    // posterior nesses campos faz o checksum recalculado divergir.
    const checksum = sha256Hex(JSON.stringify(base));
    const entrada: EntradaJournal = { ...base, checksum };
    apendarLinha(this.arquivoAtivo, JSON.stringify(entrada));
    return entrada;
  }

  /**
   * Verifica o tamanho do arquivo ativo e, se ele ja ultrapassou o limite
   * configurado, renomeia (arquiva) o arquivo atual com um timestamp no
   * nome, liberando o caminho "journal.log" para um novo arquivo vazio
   * (que sera criado automaticamente na proxima chamada de apendarLinha).
   */
  private rotacionarSeNecessario(): void {
    if (!fs.existsSync(this.arquivoAtivo)) return;
    const stat = fs.statSync(this.arquivoAtivo);
    if (stat.size >= TAMANHO_MAX_BYTES) {
      const destino = path.join(
        this.diretorio,
        `journal-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
      );
      fs.renameSync(this.arquivoAtivo, destino);
    }
  }

  /**
   * Remove apenas arquivos de journal JA ROTACIONADOS (arquivados) cuja
   * data de modificacao seja mais antiga que a retencao minima exigida.
   * O arquivo ativo (journal.log) nunca e removido por esta rotina, pois
   * o filtro abaixo so considera nomes que comecam com "journal-".
   */
  aplicarPoliticaRetencao(): string[] {
    const removidos: string[] = [];
    const arquivos = fs.readdirSync(this.diretorio).filter((f) => f.startsWith("journal-"));
    const limite = Date.now() - RETENCAO_MIN_DIAS * 24 * 60 * 60 * 1000;
    for (const f of arquivos) {
      const caminho = path.join(this.diretorio, f);
      const stat = fs.statSync(caminho);
      if (stat.mtimeMs < limite) {
        fs.unlinkSync(caminho);
        removidos.push(f);
      }
    }
    return removidos;
  }

  /**
   * Le TODAS as entradas do journal (o arquivo ativo mais todos os
   * arquivados), em ordem cronologica, para uso em consultas de auditoria
   * (comando "rastreio journal"). Linhas corrompidas ou parcialmente
   * escritas sao ignoradas na leitura (mas permanecem fisicamente no
   * arquivo, disponiveis para investigacao forense se necessario).
   */
  lerHistorico(): EntradaJournal[] {
    const arquivos = fs
      .readdirSync(this.diretorio)
      .filter((f) => f.startsWith("journal"))
      .sort(); // ordenacao lexicografica funciona pois os nomes tem timestamp no formato ISO
    const entradas: EntradaJournal[] = [];
    for (const f of arquivos) {
      const conteudo = fs.readFileSync(path.join(this.diretorio, f), "utf8");
      for (const linha of conteudo.split("\n")) {
        if (!linha.trim()) continue;
        try {
          entradas.push(JSON.parse(linha) as EntradaJournal);
        } catch {
          // Linha corrompida/parcial: ignorada na leitura, mas o arquivo
          // bruto nao e alterado.
        }
      }
    }
    entradas.sort((a, b) => a.seq - b.seq);
    return entradas;
  }

  /** Verifica a integridade de uma entrada recalculando seu checksum e comparando com o valor gravado. */
  static verificarIntegridade(entrada: EntradaJournal): boolean {
    const { checksum, ...base } = entrada;
    return sha256Hex(JSON.stringify(base)) === checksum;
  }
}
