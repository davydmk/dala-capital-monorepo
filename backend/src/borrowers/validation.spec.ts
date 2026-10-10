import {
  decodeBase58,
  isValidBin,
  isValidSolanaAddress,
} from './validation.js';

describe('БИН', () => {
  it('принимает номера с верной контрольной цифрой', () => {
    // Публично известные БИН: Kaspi Bank, Halyk Bank, КазМунайГаз.
    for (const bin of ['971240001315', '940140000385', '020240000555']) {
      expect(isValidBin(bin), bin).toBe(true);
    }
  });

  it('отклоняет опечатку в любой позиции', () => {
    const valid = '971240001315';
    let rejected = 0;
    for (let i = 0; i < 11; i++) {
      const digit = Number(valid[i]);
      const broken = `${valid.slice(0, i)}${(digit + 1) % 10}${valid.slice(i + 1)}`;
      if (!isValidBin(broken)) rejected++;
    }
    // Контрольная цифра по модулю 11 ловит почти любую одиночную опечатку:
    // редкие совпадения возможны, когда счёт откатывается на второй набор весов.
    expect(rejected).toBeGreaterThanOrEqual(10);
  });

  it('отклоняет неверную длину, буквы и неверную контрольную цифру', () => {
    for (const bad of [
      '97124000131',
      '9712400013155',
      '97124000131a',
      '971240001316',
      '',
    ]) {
      expect(isValidBin(bad), bad).toBe(false);
    }
  });
});

describe('адрес Solana', () => {
  it('принимает настоящие адреса', () => {
    for (const address of [
      'JCLPbcLwdYJs1UJgL6LK1nhYRUcGk5ziFPx55nVL9akB',
      '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      '11111111111111111111111111111111',
    ]) {
      expect(isValidSolanaAddress(address), address).toBe(true);
    }
  });

  it('отклоняет мусор, чужие алфавиты и лишний байт', () => {
    for (const bad of [
      '',
      'не-адрес',
      '0OIl',
      'abc',
      '1JCLPbcLwdYJs1UJgL6LK1nhYRUcGk5ziFPx55nVL9akB',
    ]) {
      expect(isValidSolanaAddress(bad), bad).toBe(false);
    }
  });

  it('декодирует ведущие нули', () => {
    expect(decodeBase58('11111111111111111111111111111111')).toEqual(
      new Uint8Array(32),
    );
  });
});
