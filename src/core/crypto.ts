import * as crypto from "crypto";

/**
 * Modulo de criptografia do greencode.
 *
 * Responsabilidades deste arquivo:
 * - Cifrar/decifrar dados em repouso (organizacoes, lotes, equipamentos,
 *   movimentacoes, credenciais) com AES-256-GCM.
 * - Gerar e verificar o hash de senhas com SHA-256 iterado + salt.
 * - Derivar chaves a partir de senhas (scrypt), usado para o esquema
 *   opcional de "chave envelopada" descrito em docs/SECURITY.md.
 *
 * Nenhuma outra parte do sistema deve chamar diretamente as funcoes de
 * `crypto` do Node: todo acesso a criptografia passa por aqui, o que
 * facilita auditar e trocar o algoritmo no futuro em um unico lugar.
 */

// spiderman

// Algoritmo simetrico usado para cifrar todos os arquivos de dados.
// GCM (Galois/Counter Mode) foi escolhido por ser um modo AUTENTICADO:
// alem de confidencialidade, ele detecta adulteracao do texto cifrado
// (ver a "auth tag" abaixo).
const ALGO = "aes-256-gcm";

// Tamanho recomendado do vetor de inicializacao (IV) para GCM, em bytes.
const IV_LEN = 12;

// Tamanho do salt aleatorio usado no hash de senha e na derivacao de chave.
const SALT_LEN = 16;

// Numero de rodadas de SHA-256 aplicadas ao hash de senha. Um valor alto
// aumenta o custo computacional de um ataque de forca bruta/dicionario,
// compensando o fato de o SHA-256 puro ser uma funcao de hash rapida
// (indesejavel para senhas, mas exigida pela especificacao do projeto).
const HASH_ROUNDS = 100_000;

/**
 * Estrutura de um dado cifrado com AES-256-GCM: alem do texto cifrado em
 * si, guarda o IV (necessario para decifrar) e a auth tag (necessaria
 * para verificar que os dados nao foram adulterados).
 */
export interface PacoteCifrado {
  iv: string; // vetor de inicializacao, em hexadecimal
  tag: string; // auth tag do GCM, em hexadecimal
  dados: string; // texto cifrado, em hexadecimal
}

/**
 * Cifra uma string com AES-256-GCM usando a chave fornecida.
 * Um novo IV aleatorio e gerado a CADA chamada, o que e obrigatorio em
 * GCM: reutilizar o mesmo par (chave, IV) para textos diferentes quebra a
 * confidencialidade do modo.
 */
export function cifrar(chave: Buffer, textoPlano: string): PacoteCifrado {
  if (chave.length !== 32) {
    // AES-256 exige exatamente 32 bytes (256 bits) de chave.
    throw new Error("Chave de criptografia invalida: esperado 32 bytes (AES-256).");
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, chave, iv);
  // update() processa o texto e final() fecha o cifrador, retornando o
  // restante dos dados cifrados (necessario mesmo quando update() ja
  // processou tudo, pois cifradores em modo de bloco trabalham por lotes).
  const enc = Buffer.concat([cipher.update(textoPlano, "utf8"), cipher.final()]);
  // getAuthTag() so pode ser chamado APOS final(): e o "selo" de
  // integridade que a funcao decifrar() vai conferir depois.
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("hex"), tag: tag.toString("hex"), dados: enc.toString("hex") };
}

/**
 * Decifra um pacote gerado por cifrar(). Lanca erro automaticamente se a
 * auth tag nao bater com o conteudo (ou seja, se o arquivo foi adulterado
 * ou corrompido, ou se a chave estiver incorreta).
 */
export function decifrar(chave: Buffer, pacote: PacoteCifrado): string {
  if (chave.length !== 32) {
    throw new Error("Chave de criptografia invalida: esperado 32 bytes (AES-256).");
  }
  const decipher = crypto.createDecipheriv(ALGO, chave, Buffer.from(pacote.iv, "hex"));
  // Informa ao decifrador qual auth tag ele deve validar. Se o conteudo
  // cifrado for diferente do original, final() abaixo lanca excecao.
  decipher.setAuthTag(Buffer.from(pacote.tag, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(pacote.dados, "hex")),
    decipher.final(), // e aqui que a verificacao de integridade realmente acontece
  ]);
  return dec.toString("utf8");
}

/** Gera uma nova chave de dados aleatoria de 32 bytes (256 bits), usada como chave mestra do sistema. */
export function gerarChaveDados(): Buffer {
  return crypto.randomBytes(32);
}

/**
 * Deriva uma chave de 32 bytes a partir de uma senha, usando scrypt (uma
 * funcao de derivacao de chave resistente a hardware especializado, ao
 * contrario de um hash simples). Usada apenas no esquema opcional de
 * "chave envelopada" descrito em docs/SECURITY.md (nao usada no fluxo
 * padrao de provisionamento desta etapa, que guarda a chave mestra
 * diretamente em arquivo com permissoes restritas).
 */
export function derivarChaveDeSenha(senha: string, salt: Buffer): Buffer {
  // N, r, p sao os parametros de custo do scrypt (memoria e tempo de CPU
  // exigidos); os valores usados sao um equilibrio razoavel entre
  // seguranca e tempo de resposta aceitavel em uma CLI interativa.
  return crypto.scryptSync(senha, salt, 32, { N: 16384, r: 8, p: 1 });
}

/** Envelopa (cifra) a chave de dados com uma chave derivada da senha do administrador. */
export function envelopeChave(chaveDados: Buffer, senhaAdmin: string) {
  const salt = crypto.randomBytes(SALT_LEN);
  const kek = derivarChaveDeSenha(senhaAdmin, salt); // KEK = Key Encryption Key
  const pacote = cifrar(kek, chaveDados.toString("hex"));
  return { salt: salt.toString("hex"), pacote };
}

/** Reabre (decifra) a chave de dados a partir da senha do administrador e do envelope gerado por envelopeChave(). */
export function abrirEnvelopeChave(
  senhaAdmin: string,
  saltHex: string,
  pacote: PacoteCifrado
): Buffer {
  const kek = derivarChaveDeSenha(senhaAdmin, Buffer.from(saltHex, "hex"));
  const hexChave = decifrar(kek, pacote);
  return Buffer.from(hexChave, "hex");
}

/**
 * Gera um hash SHA-256 iterado de uma senha, com salt aleatorio novo a
 * cada chamada. Usado ao criar um usuario (provisionamento ou comando
 * "usuario criar"). O salt e o hash resultantes sao gravados na
 * credencial e usados depois por verificarSenha().
 */
export function gerarHashSenha(senha: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(SALT_LEN).toString("hex");
  const hash = hashIterado(senha, salt);
  return { salt, hash };
}

/**
 * Verifica se a senha informada no login corresponde ao hash/salt
 * previamente armazenados. Usa comparacao em TEMPO CONSTANTE
 * (timingSafeEqual) para que o tempo de resposta nao vaze informacao
 * sobre em qual posicao o hash calculado diverge do esperado (ataque de
 * timing).
 */
export function verificarSenha(senha: string, salt: string, hashEsperado: string): boolean {
  const hashCalculado = hashIterado(senha, salt);
  const a = Buffer.from(hashCalculado, "hex");
  const b = Buffer.from(hashEsperado, "hex");
  if (a.length !== b.length) return false; // timingSafeEqual exige buffers do mesmo tamanho
  return crypto.timingSafeEqual(a, b);
}

/**
 * Implementacao interna do hash de senha: aplica SHA-256 repetidamente
 * (HASH_ROUNDS vezes), realimentando o resultado de uma rodada como
 * entrada da proxima. Isso aumenta o custo computacional de testar cada
 * senha candidata em um ataque de forca bruta, compensando o fato de o
 * SHA-256 isolado ser rapido demais para uso direto em senhas.
 */
function hashIterado(senha: string, saltHex: string): string {
  let atual = Buffer.from(saltHex + ":" + senha, "utf8");
  for (let i = 0; i < HASH_ROUNDS; i++) {
    atual = crypto.createHash("sha256").update(atual).digest();
  }
  return atual.toString("hex");
}

/**
 * SHA-256 simples (uma unica rodada), usado apenas para CHECKSUMS de
 * integridade (ex.: entradas do journal) — nao deve ser usado para
 * senhas, pois nao tem as iteracoes de custo aplicadas em hashIterado().
 */
export function sha256Hex(dado: string): string {
  return crypto.createHash("sha256").update(dado, "utf8").digest("hex");
}
