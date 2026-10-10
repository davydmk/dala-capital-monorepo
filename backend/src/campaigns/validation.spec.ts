import { describe, expect, it } from 'vitest';
import { checkCampaign } from './validation.js';

const HOUR = 60 * 60;
const now = new Date('2026-10-04T12:00:00Z');
const at = (hours: number) => new Date(now.getTime() + hours * HOUR * 1000);

/** Кампания, готовая к публикации: тесты ломают в ней по одному условию. */
const CAMPAIGN = {
  walletId: 'wallet-1',
  mint: 'Mint111111111111111111111111111111111111111',
  softCap: 10_000_000n,
  hardCap: 100_000_000n,
  minTicket: 1_000_000n,
  maxTicket: 0n,
  annualRateBps: 1_200,
  periodsPerYear: 2,
  periodCount: 2,
  scheduleKind: 'COUPON',
  bondFaceValue: 1_000_000n,
  bondName: 'Dala Bond Астана Трейд',
  bondSymbol: 'DALA7',
  fundingStart: now,
  fundingDeadline: at(1),
  firstDueAt: at(2),
} as unknown as Parameters<typeof checkCampaign>[0];

const withBorrower = (extra: Record<string, unknown> = {}) =>
  ({
    ...CAMPAIGN,
    ...extra,
    borrower: {
      status: 'APPROVED',
      wallets: [{ id: 'wallet-1', address: 'Wallet1111' }],
    },
  }) as unknown as Parameters<typeof checkCampaign>[0];

const check = (campaign: Parameters<typeof checkCampaign>[0], key: string) =>
  checkCampaign(campaign, { mintAllowed: true, now }).find(
    (item) => item.key === key,
  );

describe('проверки перед публикацией', () => {
  it('у готовой купонной кампании проходят все', () => {
    const checks = checkCampaign(withBorrower(), {
      mintAllowed: true,
      now,
    });
    expect(checks.every((item) => item.ok)).toBe(true);
  });

  it('облигацию без названия и тикера не публикуют', () => {
    const failed = check(withBorrower({ bondName: null }), 'bondMetadata');
    expect(failed?.ok).toBe(false);
    expect(failed?.hint).toContain('метаданные минта');
  });

  it('пробелы за название не считаются', () => {
    expect(check(withBorrower({ bondSymbol: '   ' }), 'bondMetadata')?.ok).toBe(
      false,
    );
  });

  it('у кредита метаданные бумаги не спрашивают', () => {
    const campaign = withBorrower({
      scheduleKind: 'ANNUITY',
      bondName: null,
      bondSymbol: null,
    });
    expect(check(campaign, 'bondMetadata')).toBeUndefined();
    expect(
      checkCampaign(campaign, { mintAllowed: true, now }).every(
        (item) => item.ok,
      ),
    ).toBe(true);
  });
});
