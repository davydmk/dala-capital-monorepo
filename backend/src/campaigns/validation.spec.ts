import { describe, expect, it } from 'vitest';
import { checkCampaign, isValidIsin } from './validation.js';

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

  it('у облигации комиссия за досрочное погашение запрещена', () => {
    const failed = check(
      withBorrower({ prepaymentFeeBps: 100 }),
      'prepaymentFee',
    );
    expect(failed?.ok).toBe(false);
    expect(failed?.hint).toContain('досрочного погашения нет');
  });

  it('у кредита метаданные бумаги не спрашивают', () => {
    const campaign = withBorrower({
      scheduleKind: 'ANNUITY',
      bondName: null,
      bondSymbol: null,
    });
    expect(check(campaign, 'bondMetadata')).toBeUndefined();
    expect(check(campaign, 'prepaymentFee')).toBeUndefined();
    expect(
      checkCampaign(campaign, { mintAllowed: true, now }).every(
        (item) => item.ok,
      ),
    ).toBe(true);
  });
});

describe('ISIN по ISO 6166', () => {
  it('принимает коды с верной контрольной цифрой', () => {
    // Примеры из стандарта: Apple, Treasury и BAE Systems.
    expect(isValidIsin('US0378331005')).toBe(true);
    expect(isValidIsin('US9128285M81')).toBe(true);
    expect(isValidIsin('GB0002634946')).toBe(true);
  });

  it('ловит опечатку в любой позиции', () => {
    expect(isValidIsin('US0378331006')).toBe(false);
    expect(isValidIsin('US0378331105')).toBe(false);
  });

  it('требует две буквы страны и двенадцать знаков', () => {
    expect(isValidIsin('0S0378331005')).toBe(false);
    expect(isValidIsin('US037833100')).toBe(false);
    expect(isValidIsin('US03783310050')).toBe(false);
  });
});
