import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Поднятие Nest и закрытие пула Postgres не укладываются в 10 секунд по умолчанию.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
