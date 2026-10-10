import { describe, expect, it } from 'vitest';
import { campaignStatus, overdueNow, statusGroup } from './campaign-status.js';

const NOW = 1_000_000;
const deal = (overrides: Partial<Parameters<typeof campaignStatus>[0]> = {}) =>
  campaignStatus({
    dealState: 'funding',
    fundingDeadline: NOW + 3600,
    overduePrincipal: 0n,
    now: NOW,
    ...overrides,
  });

describe('статус кампании для витрины', () => {
  it('сбор идёт, пока не прошёл дедлайн', () => {
    expect(deal()).toBe('FUNDING');
  });

  it('после дедлайна сбор считается законченным, даже если его не закрыли', () => {
    expect(deal({ fundingDeadline: NOW - 1 })).toBe('FUNDING_ENDED');
  });

  it('действующий заём без просрочки', () => {
    expect(deal({ dealState: 'active' })).toBe('ACTIVE');
  });

  it('просроченное тело важнее слова «действует»', () => {
    expect(deal({ dealState: 'active', overduePrincipal: 1n })).toBe('OVERDUE');
  });

  it('дефолт, погашение и несостоявшийся сбор', () => {
    expect(deal({ dealState: 'default' })).toBe('DEFAULT');
    expect(deal({ dealState: 'repaid' })).toBe('REPAID');
    expect(deal({ dealState: 'failed' })).toBe('FAILED');
  });

  it('незнакомое состояние не выдаётся за понятное', () => {
    expect(deal({ dealState: 'somethingNew' })).toBe('UNKNOWN');
  });
});

describe('раскладка по вкладкам', () => {
  it('сбор — это и идущий, и законченный сбор', () => {
    expect(statusGroup('FUNDING')).toBe('funding');
    expect(statusGroup('FUNDING_ENDED')).toBe('funding');
  });

  it('просрочка остаётся среди действующих', () => {
    expect(statusGroup('ACTIVE')).toBe('active');
    expect(statusGroup('OVERDUE')).toBe('active');
  });

  it('всё остальное — завершённые', () => {
    for (const status of ['DEFAULT', 'REPAID', 'FAILED', 'UNKNOWN'] as const) {
      expect(statusGroup(status)).toBe('finished');
    }
  });
});

describe('просрочка на текущий момент', () => {
  const loan = (dueTs: number) => ({
    state: 'active',
    nextPeriod: 0,
    periods: [
      {
        dueTs,
        principalAmount: 1_000n,
        interestAmount: 100n,
        principalPaid: 0n,
        interestPaid: 0n,
      },
    ],
    overduePrincipal: 0n,
    overdueScheduledInterest: 0n,
    extraInterest: 0n,
    penalty: 0n,
    defaultPrincipal: 0n,
    defaultInterest: 0n,
    interestCarry: 0n,
    penaltyCarry: 0n,
    lastAccrualTs: NOW - 3600,
    annualRateBps: 1_000,
    penaltyRateBps: 2_000,
  });

  it('наступивший платёж даёт просрочку, хотя в сделке ещё ноль', () => {
    const deal = loan(NOW - 60);
    expect(deal.overduePrincipal).toBe(0n);
    expect(overdueNow(deal, NOW)).toBe(1_000n);
    expect(
      campaignStatus({
        dealState: 'active',
        fundingDeadline: NOW - 7200,
        overduePrincipal: overdueNow(deal, NOW),
        now: NOW,
      }),
    ).toBe('OVERDUE');
  });

  it('до даты платежа просрочки нет', () => {
    expect(overdueNow(loan(NOW + 60), NOW)).toBe(0n);
  });
});
