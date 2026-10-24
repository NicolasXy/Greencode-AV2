import { ErroValidacao, ESTADOS_FISICOS, EstadoFisico } from "../types";

/**
 * Implementacao das regras de validacao de negocio do dominio: CNPJ,
 * datas de lote e transicoes de estado de equipamento.
 *
 * Estas funcoes sao o "motor" das regras; a camada de classes em
 * src/validation/ (Validador<T> e subclasses) apenas envolve estas
 * funcoes em um formato orientado a objetos, para atender ao requisito de
 * "classes abstratas de validacao" sem duplicar a logica aqui testada.
 */

/**
 * Valida um CNPJ (aceita com ou sem mascara), incluindo o calculo dos
 * dois digitos verificadores conforme o algoritmo oficial da Receita
 * Federal (modulo 11). Retorna o CNPJ normalizado (somente digitos) em
 * caso de sucesso, ou lanca ErroValidacao com uma mensagem especifica do
 * problema encontrado.
 */
export function validarCNPJ(cnpjEntrada: string): string {
  // Remove qualquer caractere que nao seja digito (pontos, barra, hifen).
  const cnpj = (cnpjEntrada || "").replace(/\D/g, "");

  if (cnpj.length !== 14) {
    throw new ErroValidacao("CNPJ deve conter 14 digitos.");
  }
  // Sequencias como "11111111111111" passam no calculo do digito
  // verificador mas nunca sao CNPJs reais validos: sao rejeitadas aqui
  // antes mesmo do calculo, evitando um falso-positivo.
  if (/^(\d)\1{13}$/.test(cnpj)) {
    throw new ErroValidacao("CNPJ invalido (sequencia repetida).");
  }

  // Calcula um digito verificador aplicando a soma ponderada (pesos
  // decrescentes) sobre os digitos da base, seguida do calculo do resto
  // da divisao por 11 — exatamente o algoritmo publicado pela Receita.
  const calcularDigito = (base: string, pesos: number[]): number => {
    const soma = base
      .split("")
      .reduce((acc, digito, idx) => acc + parseInt(digito, 10) * pesos[idx], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  // Pesos fixos definidos pelo algoritmo oficial: o primeiro digito
  // verificador usa 12 pesos (sobre os 12 primeiros digitos do CNPJ); o
  // segundo usa 13 pesos (os mesmos 12 digitos mais o primeiro digito
  // verificador ja calculado).
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const base12 = cnpj.substring(0, 12);
  const dv1 = calcularDigito(base12, pesos1);
  const dv2 = calcularDigito(base12 + dv1, pesos2);

  const dvInformado = cnpj.substring(12, 14);
  const dvCalculado = `${dv1}${dv2}`;

  if (dvInformado !== dvCalculado) {
    throw new ErroValidacao("CNPJ invalido: digitos verificadores nao conferem.");
  }

  return cnpj;
}

/** Formata um CNPJ ja validado (14 digitos) para o padrao visual XX.XXX.XXX/XXXX-XX. */
export function formatarCNPJ(cnpj: string): string {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

// spiderman

/**
 * Valida a data de entrada de um lote: a especificacao exige que ela nao
 * seja futura, nem anterior a mais de 90 dias em relacao ao momento da
 * validacao (parametro `agora`, que por padrao e o instante atual — usar
 * um parametro em vez de `new Date()` direto no corpo facilita testes que
 * precisem simular datas diferentes).
 */
export function validarDataEntradaLote(dataISO: string, agora: Date = new Date()): void {
  const data = new Date(dataISO + "T00:00:00");
  if (isNaN(data.getTime())) {
    throw new ErroValidacao("Data de entrada invalida. Use o formato AAAA-MM-DD.");
  }
  // Compara apenas a parte de data (ignorando hora), truncando "agora"
  // para meia-noite do mesmo dia, para que o teste de "data futura" nao
  // dependa do horario exato em que o comando foi executado.
  const hoje = new Date(agora.toISOString().substring(0, 10) + "T00:00:00");
  if (data.getTime() > hoje.getTime()) {
    throw new ErroValidacao("Data de entrada nao pode ser futura.");
  }
  const limiteDias = 90;
  const diffDias = (hoje.getTime() - data.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDias > limiteDias) {
    throw new ErroValidacao(`Data de entrada nao pode ser anterior a ${limiteDias} dias.`);
  }
}

/**
 * Regra de negocio: um equipamento so pode ser movimentado para o status
 * "desmonte" depois de passar por uma triagem completa. Recebe apenas o
 * booleano ja calculado (em vez do objeto Equipamento inteiro) para
 * manter esta funcao pequena, pura e facil de testar isoladamente.
 */
export function validarTransicaoParaDesmonte(triagemCompleta: boolean): void {
  if (!triagemCompleta) {
    throw new ErroValidacao(
      "Equipamento so pode ser movimentado para 'desmonte' apos passar por triagem completa."
    );
  }
}

/**
 * Verifica se a mudanca de estado fisico representa uma queda de 2 ou
 * mais categorias na escala ESTADOS_FISICOS (ex.: de "novo" para
 * "regular" sao 3 categorias de queda) e, nesse caso, exige que uma
 * justificativa textual nao vazia tenha sido informada.
 */
export function exigeJustificativaParaEstado(
  estadoAnterior: EstadoFisico,
  estadoNovo: EstadoFisico,
  justificativa: string | undefined
): void {
  // O indice de cada estado no array ESTADOS_FISICOS representa sua
  // "categoria" de conservacao (0 = novo, ate 5 = sucata). A diferenca de
  // indices e, portanto, o numero de categorias que o equipamento caiu.
  const idxAnterior = ESTADOS_FISICOS.indexOf(estadoAnterior);
  const idxNovo = ESTADOS_FISICOS.indexOf(estadoNovo);
  const queda = idxNovo - idxAnterior;
  if (queda >= 2 && (!justificativa || justificativa.trim().length === 0)) {
    throw new ErroValidacao(
      `Alteracao de estado fisico de '${estadoAnterior}' para '${estadoNovo}' rebaixa 2 ou mais ` +
        `categorias e exige justificativa textual (--justificativa "...").`
    );
  }
}

/** Converte e valida uma string livre (vinda da CLI) para um dos valores validos de EstadoFisico. */
export function validarEstadoFisico(valor: string): EstadoFisico {
  if (!ESTADOS_FISICOS.includes(valor as EstadoFisico)) {
    throw new ErroValidacao(
      `Estado fisico invalido. Valores aceitos: ${ESTADOS_FISICOS.join(", ")}.`
    );
  }
  return valor as EstadoFisico;
}
