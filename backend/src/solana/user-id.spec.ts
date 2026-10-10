import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bytesToUuid, uuidToBytes } from './user-id.js';

describe('user_id инвестора', () => {
  it('переводит UUID в 16 байт и обратно', () => {
    for (let i = 0; i < 100; i++) {
      const uuid = randomUUID();
      const bytes = uuidToBytes(uuid);
      expect(bytes).toHaveLength(16);
      expect(bytesToUuid(bytes)).toBe(uuid);
    }
  });

  it('раскладывает байты в том же порядке, что и запись UUID', () => {
    const bytes = uuidToBytes('00112233-4455-6677-8899-aabbccddeeff');
    expect([...bytes]).toEqual([
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb,
      0xcc, 0xdd, 0xee, 0xff,
    ]);
  });

  it('не различает регистр, но возвращает нижний', () => {
    const upper = '0FF1CE00-DEAD-4BEE-8CAF-FEEDFACE1234';
    expect(bytesToUuid(uuidToBytes(upper))).toBe(upper.toLowerCase());
  });

  it('отвергает то, что не является UUID', () => {
    expect(() => uuidToBytes('не-uuid')).toThrow();
    expect(() => uuidToBytes('00112233445566778899aabbccddeeff')).toThrow();
    expect(() => bytesToUuid(new Uint8Array(15))).toThrow();
  });
});
