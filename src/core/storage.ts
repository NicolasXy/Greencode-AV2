import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { cifrar, decifrar, PacoteCifrado } from "./crypto";

/**
 * Camada de persistencia em arquivos de texto (JSON), responsavel por DUAS
 * garantias fundamentais do sistema:
 *
 *  1. Escrita ATOMICA: toda gravacao acontece em um arquivo temporario e
 *     so e "publicada" com uma chamada a rename(). Como o rename() e uma
 *     operacao atomica no nivel do sistema de arquivos (tanto em Linux
 *     quanto no Windows/NTFS), o arquivo final nunca fica visivel em um
 *     estado parcialmente escrito, mesmo que o processo seja interrompido
 *     no meio da gravacao (queda de energia, kill -9, etc.).
 *
 *  2. Criptografia: todo conteudo de dados de negocio e gravado cifrado
 *     com AES-256-GCM (delegado ao modulo core/crypto.ts).
 */

/** Garante que o diretorio de destino existe, criando-o (inclusive pais) se necessario. */
export function garantirDiretorio(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Escreve um objeto de forma atomica e cifrada em `caminho`.
 * Fluxo: serializa em JSON -> cifra -> grava em arquivo temporario ->
 * fsync (forca a escrita para o disco fisico) -> rename para o nome final.
 */
export function escreverSeguro(caminho: string, chave: Buffer, objeto: unknown): void {
  garantirDiretorio(path.dirname(caminho));
  const json = JSON.stringify(objeto, null, 2);
  const pacote = cifrar(chave, json);
  const conteudo = JSON.stringify(pacote);

  // Nome do arquivo temporario inclui PID do processo e bytes aleatorios,
  // evitando colisao caso dois processos (ou duas chamadas rapidas)
  // tentem escrever no mesmo destino simultaneamente.
  const tmp = path.join(
    path.dirname(caminho),
    `.${path.basename(caminho)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`
  );
  fs.writeFileSync(tmp, conteudo, { encoding: "utf8", flag: "w" });

  // fsync do arquivo temporario ANTES do rename: garante que os dados
  // realmente chegaram ao disco fisico, reduzindo a janela de perda em
  // caso de queda de energia logo apos a escrita.
  const fd = fs.openSync(tmp, "r+");
  fs.fsyncSync(fd);
  fs.closeSync(fd);

  // Publicacao atomica: o arquivo de destino passa a existir com o
  // conteudo completo de uma so vez, nunca parcialmente escrito.
  fs.renameSync(tmp, caminho);
}

/**
 * Le e decifra um objeto de `caminho`. Retorna `valorPadrao` (geralmente
 * um array vazio) se o arquivo ainda nao existir — situacao normal na
 * primeira vez que uma colecao e usada (ex.: antes do primeiro
 * "org criar").
 */
export function lerSeguro<T>(caminho: string, chave: Buffer, valorPadrao: T): T {
  if (!fs.existsSync(caminho)) {
    return valorPadrao;
  }
  const conteudo = fs.readFileSync(caminho, "utf8");
  const pacote = JSON.parse(conteudo) as PacoteCifrado;
  const json = decifrar(chave, pacote); // lanca erro se a chave estiver errada ou o arquivo tiver sido adulterado
  return JSON.parse(json) as T;
}

/**
 * Escreve texto puro (NAO cifrado) de forma atomica. Usado apenas para
 * metadados que nao sao dados de negocio sensiveis (ex.: o arquivo de
 * configuracao mestre, que guarda a propria chave de criptografia — cifrar
 * a chave com ela mesma nao faria sentido).
 */
export function escreverTextoAtomico(caminho: string, conteudo: string): void {
  garantirDiretorio(path.dirname(caminho));
  const tmp = path.join(
    path.dirname(caminho),
    `.${path.basename(caminho)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`
  );
  fs.writeFileSync(tmp, conteudo, { encoding: "utf8", flag: "w" });
  const fd = fs.openSync(tmp, "r+");
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmp, caminho);
}

// spiderman

/**
 * Acrescenta uma linha ao final de um arquivo (usado exclusivamente pelo
 * journal). Diferente das funcoes acima, aqui NAO ha rename atomico,
 * porque o objetivo e ir ACUMULANDO linhas ao longo do tempo (um log), e
 * nao substituir o conteudo inteiro do arquivo a cada gravacao. A
 * durabilidade e garantida da mesma forma, com fsync logo apos o append.
 */
export function apendarLinha(caminho: string, linha: string): void {
  garantirDiretorio(path.dirname(caminho));
  fs.appendFileSync(caminho, linha + "\n", { encoding: "utf8" });
  // fsync do arquivo de journal garante durabilidade da transacao ANTES
  // dela ser considerada "aplicada" ao estado corrente (padrao write-ahead log).
  const fd = fs.openSync(caminho, "r+");
  fs.fsyncSync(fd);
  fs.closeSync(fd);
}
