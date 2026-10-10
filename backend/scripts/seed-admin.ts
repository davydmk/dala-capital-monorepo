/**
 * Создаёт или обновляет админа. Единственный способ завести первый аккаунт:
 * регистрация в API доступна только инвесторам.
 *
 *   pnpm seed:admin admin@dala.capital "длинный-пароль" "Имя"
 * Без аргументов берёт ADMIN_EMAIL и ADMIN_PASSWORD из .env.
 */
import { loadEnvFile } from 'node:process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role, UserStatus } from '@prisma/client';
import { hash } from '@node-rs/argon2';

try {
  loadEnvFile('.env');
} catch {
  // В проде переменные приходят из окружения.
}

const [emailArg, passwordArg, nameArg] = process.argv.slice(2);
const email = (emailArg ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
const password = passwordArg ?? process.env.ADMIN_PASSWORD ?? '';
const name = nameArg ?? 'Администратор';

if (!email || password.length < 10) {
  console.error('Укажите почту и пароль не короче 10 символов');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const passwordHash = await hash(password);
const user = await prisma.user.upsert({
  where: { email },
  update: { passwordHash, role: Role.ADMIN, status: UserStatus.ACTIVE },
  create: { email, name, passwordHash, role: Role.ADMIN, status: UserStatus.ACTIVE },
});

console.log(`Админ готов: ${user.email} (${user.id})`);
await prisma.$disconnect();
