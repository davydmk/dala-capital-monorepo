// Prisma 7 не читает .env сам — подключаем его явно.
import 'node:process';
import { loadEnvFile } from 'node:process';
import { defineConfig } from 'prisma/config';

try {
  loadEnvFile('.env');
} catch {
  // .env может отсутствовать: в проде переменные приходят из окружения.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: process.env.DATABASE_URL! },
  migrations: { path: 'prisma/migrations' },
});
