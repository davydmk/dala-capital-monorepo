# Образ бэкенда. Две стадии: в первой собираем, во вторую кладём только то,
# что нужно для запуска. Prisma требует отдельного внимания — движок ставится
# под платформу при `generate`, поэтому генерируем в той же базе, где запускаем.
FROM node:24-slim AS build
WORKDIR /app

# Версия pnpm закреплена: та же, что на машине разработчика. Иначе corepack
# притащит свежую, а она читает настройки из других мест.
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate

# Сначала манифесты: слой с зависимостями переживает правки кода.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN pnpm build

# Урезание зависимостей — отдельным слоем. В самом сборочном оставляем всё:
# оттуда же гоняются миграции, а CLI Prisma живёт в зависимостях разработки.
FROM build AS pruned
RUN pnpm prune --prod

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Prisma и клиент Solana тянут за собой openssl; curl нужен проверке живости.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=pruned /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

# От root в контейнере работать незачем: наружу он ничего не делает, а
# каталог загрузок монтируется с нужными правами.
RUN useradd --system --uid 10001 dala \
  && mkdir -p /data/uploads \
  && chown -R dala:dala /data /app
USER dala

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/health || exit 1

CMD ["node", "dist/main.js"]
