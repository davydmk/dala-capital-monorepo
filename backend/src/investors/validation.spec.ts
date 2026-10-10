import {
  IdDocType,
  InvestorDocumentKind,
  InvestorType,
  KycStatus,
  SourceOfFunds,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  checkInvestor,
  fullYears,
  type InvestorForCheck,
} from './validation.js';

const NOW = new Date('2026-09-22T12:00:00.000Z');

/** Полностью заполненная анкета физлица: тесты ломают в ней по одному полю. */
function individual(
  overrides: Partial<InvestorForCheck> = {},
): InvestorForCheck {
  return {
    id: 'i-1',
    userId: 'u-1',
    type: InvestorType.INDIVIDUAL,
    status: KycStatus.DRAFT,
    step: 5,
    provider: 'MANUAL',
    applicantId: null,
    levelName: null,
    reviewAnswer: null,
    reviewRejectType: null,
    rejectLabels: [],
    moderationComment: null,
    clientComment: null,
    reviewedAt: null,
    submittedAt: null,
    firstName: 'Ivan',
    lastName: 'Petrov',
    middleName: null,
    dob: new Date('1990-05-01T00:00:00.000Z'),
    placeOfBirth: 'Almaty',
    countryOfBirth: 'KAZ',
    nationality: 'KAZ',
    country: 'ARE',
    addressLine: 'Marina 1',
    city: 'Dubai',
    postCode: null,
    phone: '+971500000000',
    position: null,
    idDocType: IdDocType.PASSPORT,
    idDocNumber: 'N12345678',
    idDocCountry: 'KAZ',
    idDocValidUntil: new Date('2030-01-01T00:00:00.000Z'),
    companyName: null,
    registrationNumber: null,
    incorporatedOn: null,
    companyCountry: null,
    legalAddress: null,
    website: null,
    sourceOfFunds: SourceOfFunds.SALARY,
    sourceOfFundsNote: null,
    isPep: false,
    pepDetails: null,
    termsAcceptedAt: NOW,
    riskAcceptedAt: NOW,
    withdrawalAddress: 'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq',
    withdrawalCheckedAt: NOW,
    withdrawalCheckResult: 'ok',
    pendingWithdrawalAddress: null,
    pendingRequestedAt: null,
    onchainAccount: null,
    onchainSignature: null,
    onchainCreatedAt: null,
    whitelistStatus: false,
    whitelistBlockedUntil: null,
    createdAt: NOW,
    updatedAt: NOW,
    documents: [
      { kind: InvestorDocumentKind.IDENTITY },
      { kind: InvestorDocumentKind.SELFIE },
    ],
    beneficiaries: [],
    ...overrides,
  };
}

function company(overrides: Partial<InvestorForCheck> = {}): InvestorForCheck {
  return individual({
    type: InvestorType.COMPANY,
    position: 'Director',
    companyName: 'Dala Holdings Ltd',
    registrationNumber: 'AE-123456',
    incorporatedOn: new Date('2019-03-10T00:00:00.000Z'),
    companyCountry: 'ARE',
    legalAddress: 'DIFC, Dubai',
    documents: [
      { kind: InvestorDocumentKind.IDENTITY },
      { kind: InvestorDocumentKind.SELFIE },
      { kind: InvestorDocumentKind.COMPANY_REGISTRY },
      { kind: InvestorDocumentKind.COMPANY_CHARTER },
      { kind: InvestorDocumentKind.DIRECTOR_APPOINTMENT },
      { kind: InvestorDocumentKind.OWNERSHIP_STRUCTURE },
    ],
    beneficiaries: [{ fullName: 'Ivan Petrov', shareBps: 10_000 }],
    ...overrides,
  });
}

const failed = (investor: InvestorForCheck) =>
  checkInvestor(investor, { now: NOW })
    .filter((check) => !check.ok)
    .map((check) => check.key);

describe('проверки анкеты инвестора', () => {
  it('полная анкета физлица проходит', () => {
    expect(failed(individual())).toEqual([]);
  });

  it('полная анкета компании проходит', () => {
    expect(failed(company())).toEqual([]);
  });

  it('требует имя и фамилию', () => {
    expect(failed(individual({ lastName: null }))).toContain('name');
    expect(failed(individual({ firstName: '   ' }))).toContain('name');
  });

  it('не принимает несовершеннолетних', () => {
    expect(
      failed(individual({ dob: new Date('2010-01-01T00:00:00.000Z') })),
    ).toContain('age');
    expect(failed(individual({ dob: null }))).toContain('age');
  });

  it('принимает ровно в день восемнадцатилетия', () => {
    expect(
      failed(individual({ dob: new Date('2008-09-22T00:00:00.000Z') })),
    ).not.toContain('age');
    expect(
      failed(individual({ dob: new Date('2008-09-23T00:00:00.000Z') })),
    ).toContain('age');
  });

  it('отвергает запрещённые юрисдикции', () => {
    const checks = checkInvestor(individual({ country: 'PRK' }), { now: NOW });
    const country = checks.find((check) => check.key === 'country');
    expect(country?.ok).toBe(false);
    expect(country?.hint).toContain('КНДР');
  });

  it('отвергает страну не из справочника', () => {
    expect(failed(individual({ nationality: 'XXX' }))).toContain('nationality');
  });

  it('не принимает просроченный документ', () => {
    const checks = checkInvestor(
      individual({ idDocValidUntil: new Date('2020-01-01T00:00:00.000Z') }),
      { now: NOW },
    );
    const document = checks.find((check) => check.key === 'document');
    expect(document?.ok).toBe(false);
    expect(document?.hint).toContain('истёк');
  });

  it('перечисляет недостающие документы', () => {
    const checks = checkInvestor(
      individual({ documents: [{ kind: InvestorDocumentKind.IDENTITY }] }),
      { now: NOW },
    );
    const documents = checks.find((check) => check.key === 'documents');
    expect(documents?.ok).toBe(false);
    expect(documents?.hint).toContain('селфи');
  });

  it('у компании требует свой набор документов и бенефициаров', () => {
    expect(failed(company({ beneficiaries: [] }))).toContain('beneficiaries');
    expect(
      failed(
        company({
          documents: [
            { kind: InvestorDocumentKind.IDENTITY },
            { kind: InvestorDocumentKind.SELFIE },
          ],
        }),
      ),
    ).toContain('documents');
  });

  it('ловит сумму долей больше ста процентов', () => {
    const checks = checkInvestor(
      company({
        beneficiaries: [
          { fullName: 'A', shareBps: 6000 },
          { fullName: 'B', shareBps: 5000 },
        ],
      }),
      { now: NOW },
    );
    const beneficiaries = checks.find((check) => check.key === 'beneficiaries');
    expect(beneficiaries?.ok).toBe(false);
    expect(beneficiaries?.hint).toContain('100%');
  });

  it('требует реквизиты компании и должность подписанта', () => {
    expect(failed(company({ registrationNumber: null }))).toContain('company');
    expect(failed(company({ position: null }))).toContain('position');
    expect(failed(company({ companyCountry: 'IRN' }))).toContain(
      'companyCountry',
    );
  });

  it('физлицу поля компании не нужны', () => {
    expect(failed(individual({ companyName: null }))).toEqual([]);
  });

  it('требует адрес вывода и отвергает непригодный', () => {
    expect(failed(individual({ withdrawalAddress: null }))).toContain(
      'withdrawalAddress',
    );
    expect(failed(individual({ withdrawalAddress: 'не-адрес' }))).toContain(
      'withdrawalAddress',
    );
    expect(failed(individual({ withdrawalCheckResult: 'rejected' }))).toContain(
      'withdrawalAddress',
    );
  });

  it('требует декларации', () => {
    expect(failed(individual({ sourceOfFunds: null }))).toContain(
      'sourceOfFunds',
    );
    expect(failed(individual({ isPep: null }))).toContain('pep');
    expect(failed(individual({ isPep: true }))).toContain('pep');
    expect(
      failed(individual({ isPep: true, pepDetails: 'депутат, KAZ' })),
    ).not.toContain('pep');
    expect(failed(individual({ riskAcceptedAt: null }))).toContain('terms');
  });
});

describe('полных лет', () => {
  it('считает по дате, а не по годам', () => {
    expect(fullYears(new Date('2000-01-01'), new Date('2026-01-01'))).toBe(26);
    expect(fullYears(new Date('2000-01-02'), new Date('2026-01-01'))).toBe(25);
  });
});
