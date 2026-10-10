/**
 * Расчёт прав держателей облигации.
 *
 * Это та часть, которую трек KASE называет entitlement logic: по реестру на
 * дату фиксации посчитать, сколько причитается каждому. Формулы отделены от
 * сети и от базы, чтобы их можно было проверить числами из условия задачи:
 * 10 бумаг × $1 000 × 10% ÷ 2 = $500 купона и $10 000 тела в дату зрелости.
 */

import { createHash } from 'node:crypto';

const BPS = 10_000n;

/** Условия выпуска — те же, что записаны в метаданные минта. */
export interface BondTerms {
  /** Номинал одной бумаги в минимальных единицах расчётного токена. */
  faceValue: bigint;
  couponRateBps: number;
  /** Сколько купонов в году: от этого зависит размер одного купона. */
  couponsPerYear: number;
  maturityTs: number;
}

/** Строка реестра: сколько бумаг держал этот адрес на дату фиксации. */
export interface HolderRow {
  /** Кошелёк держателя — владелец токен-счёта. */
  holder: string;
  /** Токен-счёт с бумагами. */
  tokenAccount: string;
  units: bigint;
}

/** Та же строка, но с посчитанным правом. */
export interface EntitlementRow extends HolderRow {
  amount: bigint;
}

export interface Entitlements {
  rows: EntitlementRow[];
  holders: number;
  units: bigint;
  total: bigint;
}

/**
 * Купон на одну бумагу: номинал × ставка / периодичность.
 *
 * Деление вниз — как и везде в деньгах: лишнюю копейку нельзя выдать из
 * воздуха, поэтому остаток остаётся у эмитента, а не размазывается.
 */
export function couponPerUnit(terms: BondTerms): bigint {
  const periods = BigInt(terms.couponsPerYear);
  if (periods === 0n) return 0n;
  return (terms.faceValue * BigInt(terms.couponRateBps)) / BPS / periods;
}

/**
 * Погашение одной бумаги: номинал и, если в эту же дату платится последний
 * купон, он сверху. Так и сказано в условии трека: «$10 000 principal plus
 * any final coupon due».
 */
export function redemptionPerUnit(
  terms: BondTerms,
  withFinalCoupon = true,
): bigint {
  return terms.faceValue + (withFinalCoupon ? couponPerUnit(terms) : 0n);
}

/** Раскладывает сумму на бумагу по реестру держателей. */
export function entitlements(
  rows: HolderRow[],
  amountPerUnit: bigint,
): Entitlements {
  const active = rows.filter((row) => row.units > 0n);
  const withAmount = active.map((row) => ({
    ...row,
    amount: row.units * amountPerUnit,
  }));
  return {
    rows: withAmount,
    holders: withAmount.length,
    units: withAmount.reduce((sum, row) => sum + row.units, 0n),
    total: withAmount.reduce((sum, row) => sum + row.amount, 0n),
  };
}

/**
 * Хеш реестра. В сеть уходит он, а список публикуется — любой пересчитает и
 * сверит. Запись каноническая: строки отсортированы по адресу держателя,
 * разделители однозначные, никаких пробелов и порядка полей «как получилось».
 */
export function registerHash(recordTs: number, rows: EntitlementRow[]): Buffer {
  const canonical = [...rows]
    .sort((a, b) => (a.holder < b.holder ? -1 : a.holder > b.holder ? 1 : 0))
    .map(
      (row) => `${row.holder}:${row.tokenAccount}:${row.units}:${row.amount}`,
    )
    .join('\n');
  return createHash('sha256').update(`${recordTs}\n${canonical}`).digest();
}

/** Итог голосования: вес в бумагах, кворум считается от всего выпуска. */
export interface VoteTally {
  /** Бумаг «за» и «против». */
  forUnits: bigint;
  againstUnits: bigint;
  /** Сколько бумаг вообще проголосовало и какую долю выпуска это составляет. */
  turnoutBps: number;
  quorumReached: boolean;
  /** Решение принято, только если кворум собран и «за» больше «против». */
  passed: boolean;
}

/**
 * Считает голосование. Вес — бумаги на дату фиксации, а не текущий баланс:
 * иначе держатель мог бы проголосовать, вернуть взнос и остаться с голосом.
 */
export function tallyVotes(
  votes: { choice: 'FOR' | 'AGAINST'; weight: bigint }[],
  snapshotUnits: bigint,
  quorumBps: number,
): VoteTally {
  const forUnits = votes
    .filter((vote) => vote.choice === 'FOR')
    .reduce((sum, vote) => sum + vote.weight, 0n);
  const againstUnits = votes
    .filter((vote) => vote.choice === 'AGAINST')
    .reduce((sum, vote) => sum + vote.weight, 0n);

  const turnout = forUnits + againstUnits;
  const turnoutBps =
    snapshotUnits > 0n ? Number((turnout * BPS) / snapshotUnits) : 0;
  const quorumReached = turnoutBps >= quorumBps;
  return {
    forUnits,
    againstUnits,
    turnoutBps,
    quorumReached,
    passed: quorumReached && forUnits > againstUnits,
  };
}

/**
 * Сколько бумаг причитается за взнос. Остаток от деления бумагой не
 * оформляется: он остаётся долей в контракте и выплачивается обычным порядком.
 */
export function unitsForInvestment(amount: bigint, faceValue: bigint): bigint {
  return faceValue > 0n ? amount / faceValue : 0n;
}
