/**
 * Инвестор в контракте опознаётся по user_id: 16 байт в сидах PDA
 * ["user", platform, user_id]. Это ровно те же 16 байт, из которых состоит
 * UUID пользователя в базе, поэтому отдельного идентификатора не заводим —
 * достаточно убрать дефисы и прочитать шестнадцатеричные пары.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidToBytes(uuid: string): Uint8Array {
  if (!UUID.test(uuid)) throw new Error(`Это не UUID: ${uuid}`);

  const hex = uuid.replaceAll('-', '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new Error(`Ожидалось 16 байт, пришло ${bytes.length}`);
  }

  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
