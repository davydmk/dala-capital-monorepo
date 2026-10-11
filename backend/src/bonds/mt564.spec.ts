import { describe, expect, it } from 'vitest';
import { buildNotice, noticeAvailable, noticeFileName } from './mt564.js';

const USDC = 1_000_000n;

/** Купон по выпуску №7: объявлен, реестр снят, исполнения ещё не было. */
const COUPON = {
  onchainId: '7',
  index: 0,
  kind: 'coupon',
  status: 'snapshot',
  recordTs: Math.floor(Date.UTC(2026, 9, 4) / 1000),
  paymentTs: Math.floor(Date.UTC(2026, 9, 11) / 1000),
  amountPerUnit: 60_000n,
  units: 95n,
  registerHash: '077f6fd5aa',
  settlement: null as string | null,
  isin: 'KZ0000000007',
  title: 'Облигация КАСЕ',
  mint: 'Mint1111111111111111111111111111111111111111',
  decimals: 6,
};

describe('уведомление о корпоративном действии', () => {
  it('раскладывает купон по полям стандарта', () => {
    const text = buildNotice(COUPON);

    expect(text).toContain(':20C::CORP//DALA-7-0');
    expect(text).toContain(':23G:NEWM');
    expect(text).toContain(':22F::CAEV//INTR');
    expect(text).toContain(':22F::CAMV//MAND');
    expect(text).toContain(':35B:ISIN KZ0000000007');
    // Бумаг в реестре на дату фиксации.
    expect(text).toContain(':93B::ELIG//UNIT/95,');
    expect(text).toContain(':98A::RDTE//20261004');
    expect(text).toContain(':98A::PAYD//20261011');
    expect(text).toContain(':92F::INTR//USD0,06');
    // Отпечаток списка: в стандарте поля под него нет, кладём в примечание.
    expect(text).toContain('REGISTER HASH 077f6fd5aa');
    // Валюта в поле — USD, но чем платят на самом деле, сказано рядом.
    expect(text).toContain(`SETTLEMENT TOKEN USDC MINT ${COUPON.mint}`);
  });

  it('блоки открываются и закрываются парами', () => {
    const text = buildNotice(COUPON);
    for (const block of ['GENL', 'USECU', 'ACCTINTN', 'CADETL', 'CAOPTN']) {
      expect(text).toContain(`:16R:${block}`);
      expect(text).toContain(`:16S:${block}`);
    }
  });

  it('после исполнения это уже MT566 со ссылкой на расчёт', () => {
    const text = buildNotice({
      ...COUPON,
      status: 'settled',
      settlement: '5KtPn1LGuxhFiwjxErkxTb7XxtLVYUBgsd9cJw52mTHU',
    });

    expect(text).toContain(':23G:CONF');
    expect(text).toContain(':20C::RELA//');
    expect(text).toContain(
      'SETTLEMENT TX 5KtPn1LGuxhFiwjxErkxTb7XxtLVYUBgsd9cJw52mTHU',
    );
    expect(noticeFileName({ ...COUPON, status: 'settled' })).toBe(
      'MT566-DALA-7-0.txt',
    );
  });

  it('у погашения свой код события, у голосования — добровольность', () => {
    expect(buildNotice({ ...COUPON, kind: 'redemption' })).toContain(
      ':22F::CAEV//REDM',
    );

    const vote = buildNotice({
      ...COUPON,
      kind: 'vote',
      amountPerUnit: 5n * USDC,
    });
    expect(vote).toContain(':22F::CAEV//BMET');
    expect(vote).toContain(':22F::CAMV//VOLU');
    // У голосования это бюджет взыскания целиком, а не выплата на бумагу.
    expect(vote).toContain(':92F::CASH//USD5,');
  });

  it('у реестра без выплаты кода события нет, и выгрузки тоже', () => {
    expect(noticeAvailable('record')).toBe(false);
    expect(() => buildNotice({ ...COUPON, kind: 'record' })).toThrow();
  });

  it('без ISIN в поле идёт название выпуска', () => {
    expect(buildNotice({ ...COUPON, isin: '' })).toContain(
      ':35B:/XX/Облигация КАСЕ',
    );
  });
});
