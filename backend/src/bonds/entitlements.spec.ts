import { describe, expect, it } from 'vitest';
import {
  couponPerUnit,
  entitlements,
  redemptionPerUnit,
  registerHash,
  tallyVotes,
  unitsForInvestment,
  type BondTerms,
  type HolderRow,
} from './entitlements.js';

const USD = 1_000_000n;

/**
 * Пример прямо из условия трека KASE: номинал $1 000, купон 10% годовых,
 * два купона в год, срок два года. Держатель 10 бумаг получает $500 купона
 * и $10 000 тела в дату зрелости.
 */
const KASE: BondTerms = {
  faceValue: 1_000n * USD,
  couponRateBps: 1_000,
  couponsPerYear: 2,
  maturityTs: 1_900_000_000,
};

const holder = (name: string, units: bigint): HolderRow => ({
  holder: name,
  tokenAccount: `${name}-token`,
  units,
});

describe('расчёт купона', () => {
  it('совпадает с примером из условия трека', () => {
    // 10 × $1 000 × 10% ÷ 2 = $500
    const perUnit = couponPerUnit(KASE);
    expect(perUnit).toBe(50n * USD);
    expect(perUnit * 10n).toBe(500n * USD);
  });

  it('частота делит купон, а не ставку за период', () => {
    expect(couponPerUnit({ ...KASE, couponsPerYear: 1 })).toBe(100n * USD);
    expect(couponPerUnit({ ...KASE, couponsPerYear: 4 })).toBe(25n * USD);
  });

  it('копейки от деления не выдаются из воздуха', () => {
    // 3 ÷ 2 = 1,5 → держателю достаётся 1, остаток остаётся у эмитента.
    const terms = { ...KASE, faceValue: 3n, couponRateBps: 10_000 };
    expect(couponPerUnit(terms)).toBe(1n);
  });

  it('без купона считается ноль, а не падает', () => {
    expect(couponPerUnit({ ...KASE, couponsPerYear: 0 })).toBe(0n);
  });
});

describe('погашение', () => {
  it('тело плюс последний купон — как в примере трека', () => {
    expect(redemptionPerUnit(KASE) * 10n).toBe(10_500n * USD);
    expect(redemptionPerUnit(KASE, false) * 10n).toBe(10_000n * USD);
  });
});

describe('права по реестру', () => {
  const rows = [holder('alice', 10n), holder('bob', 4n), holder('carol', 0n)];

  it('раскладывает сумму на бумагу по держателям', () => {
    const result = entitlements(rows, couponPerUnit(KASE));
    expect(result.holders).toBe(2);
    expect(result.units).toBe(14n);
    expect(result.total).toBe(700n * USD);
    expect(result.rows[0].amount).toBe(500n * USD);
    expect(result.rows[1].amount).toBe(200n * USD);
  });

  it('держатели с нулём бумаг в реестр не попадают', () => {
    expect(entitlements(rows, 1n).rows.map((row) => row.holder)).toEqual([
      'alice',
      'bob',
    ]);
  });

  it('итог равен сумме строк — на этом сходится финансирование выплаты', () => {
    const result = entitlements(rows, couponPerUnit(KASE));
    expect(result.total).toBe(
      result.rows.reduce((sum, row) => sum + row.amount, 0n),
    );
  });
});

describe('хеш реестра', () => {
  const rows = entitlements([holder('bob', 4n), holder('alice', 10n)], 7n).rows;

  it('не зависит от порядка строк: запись каноническая', () => {
    const reversed = [...rows].reverse();
    expect(registerHash(100, rows).toString('hex')).toBe(
      registerHash(100, reversed).toString('hex'),
    );
  });

  it('меняется от любой правки реестра', () => {
    const base = registerHash(100, rows).toString('hex');
    const changed = entitlements([holder('bob', 5n), holder('alice', 10n)], 7n);
    expect(registerHash(100, changed.rows).toString('hex')).not.toBe(base);
    // И от даты фиксации тоже: реестр на другую дату — другой реестр.
    expect(registerHash(101, rows).toString('hex')).not.toBe(base);
  });

  it('помещается в тридцать два байта — ровно столько в контракте', () => {
    expect(registerHash(100, rows)).toHaveLength(32);
  });

  /**
   * В снимок рядом с весом пишется личность держателя, и отпечаток от этого
   * меняться не должен: он фиксирует распределение прав, а имя — атрибут
   * анкеты. Иначе сверка старых реестров перестала бы сходиться.
   */
  it('не меняется от имени и страны в строке', () => {
    const named = rows.map((row) => ({
      ...row,
      investorId: 'b7f7e4a0-0000-4000-8000-000000000001',
      type: 'INDIVIDUAL',
      title: 'Omar Haddad',
      country: 'ARE',
    }));
    expect(registerHash(100, named).toString('hex')).toBe(
      registerHash(100, rows).toString('hex'),
    );
  });
});

describe('голосование', () => {
  const votes = (forUnits: bigint, againstUnits: bigint) =>
    [
      { choice: 'FOR' as const, weight: forUnits },
      { choice: 'AGAINST' as const, weight: againstUnits },
    ].filter((vote) => vote.weight > 0n);

  it('считает вес в бумагах и явку от выпуска', () => {
    const tally = tallyVotes(votes(6n, 2n), 10n, 5_000);
    expect(tally.forUnits).toBe(6n);
    expect(tally.againstUnits).toBe(2n);
    expect(tally.turnoutBps).toBe(8_000);
    expect(tally.quorumReached).toBe(true);
    expect(tally.passed).toBe(true);
  });

  it('без кворума решение не проходит, даже если все за', () => {
    const tally = tallyVotes(votes(3n, 0n), 100n, 5_000);
    expect(tally.turnoutBps).toBe(300);
    expect(tally.quorumReached).toBe(false);
    expect(tally.passed).toBe(false);
  });

  it('при равенстве голосов решение не принято', () => {
    expect(tallyVotes(votes(5n, 5n), 10n, 5_000).passed).toBe(false);
  });

  it('пустое голосование не делит на ноль', () => {
    const tally = tallyVotes([], 0n, 5_000);
    expect(tally.turnoutBps).toBe(0);
    expect(tally.passed).toBe(false);
  });
});

describe('бумаги за взнос', () => {
  it('остаток от деления бумагой не оформляется', () => {
    // Вложил 3,5 номинала — получил три бумаги, остаток остаётся долей.
    expect(unitsForInvestment(3_500n * USD, 1_000n * USD)).toBe(3n);
  });

  it('взнос меньше номинала бумаг не даёт', () => {
    expect(unitsForInvestment(999n * USD, 1_000n * USD)).toBe(0n);
  });

  it('нулевой номинал не ломает расчёт', () => {
    expect(unitsForInvestment(100n, 0n)).toBe(0n);
  });
});
