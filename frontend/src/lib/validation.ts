/**
 * Копия проверок бэкенда (backend/src/borrowers/validation.ts): нужна, чтобы
 * подсказать об ошибке до отправки формы. Последнее слово всё равно за сервером —
 * при правке меняйте оба файла.
 */
/**
 * БИН и ИИН Казахстана: 12 цифр, последняя — контрольная.
 * Считается по двум наборам весов: если первый даёт 10, берётся второй.
 */
export function isValidBin(value: string): boolean {
  if (!/^\d{12}$/.test(value)) return false;

  // split, а не spread: здесь только цифры, и линтер не жалуется на суррогатные пары.
  const digits = value.split('').map(Number);
  const weights1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const weights2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];

  const control = (weights: number[]) =>
    weights.reduce((sum, weight, index) => sum + weight * digits[index], 0) %
    11;

  let checksum = control(weights1);
  if (checksum === 10) checksum = control(weights2);
  // Если и второй набор даёт 10, номер невозможен: такие БИН не выдаются.
  if (checksum === 10) return false;

  return checksum === digits[11];
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Декодирует base58 в байты. Возвращает null, если строка содержит чужие символы. */
export function decodeBase58(value: string): Uint8Array | null {
  if (value.length === 0) return null;

  const bytes: number[] = [];
  for (const char of value.split('')) {
    let carry = BASE58.indexOf(char);
    if (carry < 0) return null;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Ведущие единицы в base58 — это ведущие нули в байтах.
  for (const char of value.split('')) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

/** Адрес Solana — 32 байта в base58. */
export function isValidSolanaAddress(value: string): boolean {
  const bytes = decodeBase58(value.trim());
  return bytes !== null && bytes.length === 32;
}
