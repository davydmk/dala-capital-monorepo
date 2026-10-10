/**
 * Заводит тестовых держателей облигаций с заполненными анкетами.
 *
 *   pnpm tsx scripts/seed-investors.ts
 *
 * Нужен, чтобы проверять реестр держателей и голосование: на одном инвесторе
 * они вырождаются — реестр из одной строки, голос без веса. Скрипт создаёт
 * трёх, печатает логины с паролями и кладёт анкеты в PENDING: допуск в
 * контракте админ открывает кнопкой, это действие в сети.
 *
 * Повторный запуск безопасен: инвесторы ищутся по почте и обновляются, ключи
 * и документы не дублируются.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  IdDocType,
  InvestorDocumentKind,
  InvestorType,
  KycStatus,
  PrismaClient,
  Role,
  SourceOfFunds,
  UserStatus,
} from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { Keypair } from '@solana/web3.js';

try {
  loadEnvFile('.env');
} catch {
  // В проде переменные приходят из окружения.
}

/** Держатели сценария: веса в реестре должны различаться в разы. */
const HOLDERS = [
  {
    email: 'holder1@dala.capital',
    password: 'dala-holder-1-2026',
    name: 'Omar Haddad',
    firstName: 'Omar',
    lastName: 'Haddad',
    country: 'ARE',
    nationality: 'ARE',
    city: 'Dubai',
    addressLine: 'Marasi Drive 12, Business Bay',
    phone: '+971 50 123 4567',
    sourceOfFunds: SourceOfFunds.BUSINESS,
    role: 'крупный держатель, 40 бумаг',
  },
  {
    email: 'holder2@dala.capital',
    password: 'dala-holder-2-2026',
    name: 'Mei Lin Tan',
    firstName: 'Mei Lin',
    lastName: 'Tan',
    country: 'SGP',
    nationality: 'SGP',
    city: 'Singapore',
    addressLine: '8 Marina Boulevard, Tower 1',
    phone: '+65 8123 4567',
    sourceOfFunds: SourceOfFunds.INVESTMENTS,
    role: 'средний держатель, 30 бумаг',
  },
  {
    email: 'holder3@dala.capital',
    password: 'dala-holder-3-2026',
    name: 'Lukas Meier',
    firstName: 'Lukas',
    lastName: 'Meier',
    country: 'CHE',
    nationality: 'CHE',
    city: 'Zug',
    addressLine: 'Bahnhofstrasse 21',
    phone: '+41 79 123 45 67',
    sourceOfFunds: SourceOfFunds.SAVINGS,
    role: 'некруглый взнос, 25 бумаг и остаток',
  },
] as const;

/** Минимальный валидный PNG 1×1: документы должны открываться, а не ломаться. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const REQUIRED_DOCS = [
  { kind: InvestorDocumentKind.IDENTITY, fileName: 'passport.png' },
  { kind: InvestorDocumentKind.SELFIE, fileName: 'selfie.png' },
];

const uploads = path.resolve(process.env.UPLOADS_DIR ?? './uploads');
const secrets = path.resolve('.secrets/devnet');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const now = new Date();
/** Совершеннолетие с запасом и документ, который не истёк. */
const dob = new Date(Date.UTC(1986, 4, 17));
const docValidUntil = new Date(Date.UTC(now.getUTCFullYear() + 6, 0, 1));

const rows: {
  email: string;
  password: string;
  address: string;
  role: string;
}[] = [];
const keys: Record<string, number[]> = {};

for (const holder of HOLDERS) {
  const passwordHash = await hash(holder.password);
  const user = await prisma.user.upsert({
    where: { email: holder.email },
    update: {
      passwordHash,
      role: Role.INVESTOR,
      // PENDING: кабинет открыт, операции — после одобрения.
      status: UserStatus.PENDING,
    },
    create: {
      email: holder.email,
      name: holder.name,
      passwordHash,
      role: Role.INVESTOR,
      status: UserStatus.PENDING,
    },
  });

  // Адрес вывода не прописывается в контракт, поэтому ключ нужен только
  // затем, чтобы адрес был настоящим и его токен-счёт был виден в сети.
  const existing = await prisma.investor.findUnique({
    where: { userId: user.id },
    select: { id: true, withdrawalAddress: true },
  });
  const wallet = Keypair.generate();
  const address = existing?.withdrawalAddress ?? wallet.publicKey.toBase58();
  if (!existing?.withdrawalAddress) {
    keys[address] = [...wallet.secretKey];
  }

  const profile = {
    type: InvestorType.INDIVIDUAL,
    status: KycStatus.PENDING,
    step: 5,
    submittedAt: now,
    reviewedAt: null,
    moderationComment: null,
    clientComment: null,

    firstName: holder.firstName,
    lastName: holder.lastName,
    dob,
    placeOfBirth: holder.city,
    countryOfBirth: holder.country,
    nationality: holder.nationality,
    country: holder.country,
    addressLine: holder.addressLine,
    city: holder.city,
    postCode: '00000',
    phone: holder.phone,

    idDocType: IdDocType.PASSPORT,
    idDocNumber: `SEED-${randomBytes(3).toString('hex').toUpperCase()}`,
    idDocCountry: holder.country,
    idDocValidUntil: docValidUntil,

    sourceOfFunds: holder.sourceOfFunds,
    sourceOfFundsNote: 'Тестовая анкета, создана скриптом seed-investors',
    isPep: false,
    pepDetails: null,
    termsAcceptedAt: now,
    riskAcceptedAt: now,

    withdrawalAddress: address,
    withdrawalCheckedAt: now,
    withdrawalCheckResult: 'ok',
  };

  const investor = await prisma.investor.upsert({
    where: { userId: user.id },
    update: profile,
    create: { userId: user.id, ...profile },
  });

  // Файлы кладём на диск по-настоящему: иначе документ в карточке админа
  // откроется ошибкой, а это ложная находка при ручной проверке.
  const directory = path.join(uploads, 'investors', investor.id);
  await mkdir(directory, { recursive: true });
  for (const doc of REQUIRED_DOCS) {
    const storageKey = path.posix.join(
      'investors',
      investor.id,
      `seed-${doc.kind.toLowerCase()}.png`,
    );
    await writeFile(path.join(uploads, storageKey), PNG_1X1);
    const already = await prisma.investorDocument.findFirst({
      where: { investorId: investor.id, kind: doc.kind },
      select: { id: true },
    });
    if (already) continue;
    await prisma.investorDocument.create({
      data: {
        investorId: investor.id,
        kind: doc.kind,
        fileName: doc.fileName,
        storageKey,
        mimeType: 'image/png',
        sizeBytes: PNG_1X1.length,
      },
    });
  }

  rows.push({
    email: holder.email,
    password: holder.password,
    address,
    role: holder.role,
  });
}

if (Object.keys(keys).length > 0) {
  await mkdir(secrets, { recursive: true });
  const file = path.join(secrets, 'holders.json');
  let saved: Record<string, number[]> = {};
  try {
    const { readFile } = await import('node:fs/promises');
    saved = JSON.parse(await readFile(file, 'utf8')) as typeof saved;
  } catch {
    // Файла ещё нет — это первый запуск.
  }
  await writeFile(file, JSON.stringify({ ...saved, ...keys }, null, 2));
  console.log(`Ключи держателей: ${file}`);
}

console.log('\nДержатели готовы. Анкеты поданы, ждут одобрения админом.\n');
for (const row of rows) {
  console.log(`  ${row.email}`);
  console.log(`    пароль:        ${row.password}`);
  console.log(`    адрес вывода:  ${row.address}`);
  console.log(`    роль:          ${row.role}\n`);
}
console.log(
  'Дальше: админ → «Инвесторы» → одобрить анкету и нажать\n' +
    '«Создать аккаунт и допустить» — это заводит инвестора в контракте.\n',
);

await prisma.$disconnect();
