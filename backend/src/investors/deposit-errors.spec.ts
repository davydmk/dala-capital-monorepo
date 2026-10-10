import { describe, expect, it } from 'vitest';
import {
  creditable,
  errorCode,
  explainFailure,
  formatAmount,
  whyBlocked,
} from './deposit-errors.js';

/** Кампания в сборе: тесты ломают в ней по одному условию. */
const DEAL = {
  dealState: 'funding',
  fundingStart: 1_000,
  fundingDeadline: 100_000,
  hardCap: 100_000_000_000n,
  totalRaised: 0n,
  minTicket: 10_000_000n,
  maxTicket: 0n,
  pending: 50_000_000n,
  principal: 0n,
  now: 50_000,
};

describe('сколько контракт зачислит', () => {
  it('всё, что лежит, когда места хватает', () => {
    expect(creditable(DEAL)).toBe(50_000_000n);
  });

  it('обрезает по остатку до максимума сбора', () => {
    expect(
      creditable({ ...DEAL, hardCap: 60_000_000n, totalRaised: 40_000_000n }),
    ).toBe(20_000_000n);
  });

  it('обрезает по максимальному взносу', () => {
    expect(
      creditable({
        ...DEAL,
        maxTicket: 30_000_000n,
        principal: 25_000_000n,
      }),
    ).toBe(5_000_000n);
  });

  it('нулевой максимальный взнос означает «без ограничения»', () => {
    expect(creditable({ ...DEAL, maxTicket: 0n, principal: 999n })).toBe(
      50_000_000n,
    );
  });

  it('не уходит в минус, когда места не осталось', () => {
    expect(creditable({ ...DEAL, hardCap: 10n, totalRaised: 100n })).toBe(0n);
  });
});

describe('что мешает зачислить', () => {
  it('ничего, когда кампания собирает и денег хватает', () => {
    expect(whyBlocked(DEAL)).toBeNull();
  });

  it('пустой адрес — это не помеха, а ожидание', () => {
    expect(whyBlocked({ ...DEAL, pending: 0n })).toBeNull();
  });

  it('сбор ещё не начался', () => {
    expect(whyBlocked({ ...DEAL, now: 500 })?.code).toBe('FundingNotStarted');
  });

  it('дедлайн прошёл', () => {
    const block = whyBlocked({ ...DEAL, now: 100_001 });
    expect(block?.code).toBe('FundingClosed');
    expect(block?.action).toBe('withdraw');
  });

  it('кампания уже не в сборе', () => {
    expect(whyBlocked({ ...DEAL, dealState: 'active' })?.code).toBe(
      'InvalidDealState',
    );
  });

  it('первый взнос меньше минимального', () => {
    const block = whyBlocked({ ...DEAL, pending: 9_000_000n });
    expect(block?.code).toBe('BelowMinTicket');
    expect(block?.action).toBe('wait');
  });

  it('минимум проверяется только на первом взносе', () => {
    expect(
      whyBlocked({ ...DEAL, pending: 9_000_000n, principal: 20_000_000n }),
    ).toBeNull();
  });

  it('места в сборе не осталось', () => {
    const block = whyBlocked({
      ...DEAL,
      hardCap: 40_000_000n,
      totalRaised: 40_000_000n,
      principal: 40_000_000n,
    });
    expect(block?.code).toBe('NoCapacity');
    expect(block?.action).toBe('withdraw');
  });
});

describe('ошибка контракта', () => {
  it('достаёт код из того, что бросил Anchor', () => {
    expect(errorCode({ error: { errorCode: { code: 'NoCapacity' } } })).toBe(
      'NoCapacity',
    );
    expect(errorCode({ errorCode: { code: 'BelowMinTicket' } })).toBe(
      'BelowMinTicket',
    );
    expect(errorCode(new Error('сеть недоступна'))).toBeNull();
  });

  it('переводит знакомый код в понятную причину', () => {
    const block = explainFailure({ errorCode: { code: 'WhitelistDisabled' } });
    expect(block.reason).toContain('Вывод закрыт');
    expect(block.action).toBe('none');
  });

  it('незнакомый код не выдаёт за понятную причину', () => {
    const block = explainFailure({ errorCode: { code: 'СовсемНовый' } });
    expect(block.code).toBe('СовсемНовый');
    expect(block.reason).toContain('не прошла');
  });

  it('обычная ошибка сети тоже не роняет разбор', () => {
    expect(explainFailure(new Error('timeout')).code).toBe('Unknown');
  });
});

describe('суммы в объяснениях', () => {
  it('микроединицы читаются как на экране', () => {
    expect(formatAmount(25_500_000n, 6)).toBe('25,50');
    expect(formatAmount(26_000_000n, 6)).toBe('26,00');
  });

  it('целая часть не теряется на больших суммах', () => {
    expect(formatAmount(1_234_567_890n, 6)).toBe('1234,56');
  });

  it('у токена с другим числом знаков делит по нему', () => {
    expect(formatAmount(1_500n, 3)).toBe('1,50');
    // У токена без дробной части запятой быть не должно.
    expect(formatAmount(7n, 0)).toBe('7');
  });
});
