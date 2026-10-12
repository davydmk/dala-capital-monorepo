import { describe, expect, it } from 'vitest';
import { investorTitle } from './title.js';

const fields = (overrides: Partial<Parameters<typeof investorTitle>[0]>) => ({
  type: 'INDIVIDUAL',
  companyName: null,
  firstName: null,
  lastName: null,
  ...overrides,
});

describe('как назвать держателя в документе', () => {
  it('человека — по имени и фамилии', () => {
    expect(
      investorTitle(fields({ firstName: 'Omar', lastName: 'Haddad' })),
    ).toBe('Omar Haddad');
  });

  it('компанию — по названию, даже если имена заполнены', () => {
    expect(
      investorTitle(
        fields({
          type: 'COMPANY',
          companyName: 'Astana Holding',
          firstName: 'Omar',
        }),
      ),
    ).toBe('Astana Holding');
  });

  it('половина имени — тоже имя', () => {
    expect(investorTitle(fields({ lastName: 'Meier' }))).toBe('Meier');
  });

  /** Пустая анкета не должна притворяться держателем без имени в выписке. */
  it('без имени так и говорит', () => {
    expect(investorTitle(fields({}))).toBe('Без имени');
    expect(investorTitle(fields({ type: 'COMPANY' }))).toBe('Компания');
  });
});
