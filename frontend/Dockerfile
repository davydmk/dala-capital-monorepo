# Образ фронта. Next кладёт в `standalone` только то, что нужно для запуска,
# вместе с минимальным сервером — иначе в образ пришлось бы тащить весь
# node_modules. Адрес бэкенда читается при старте, поэтому один образ годится
# и для стенда, и для любого домена.
FROM node:24-slim AS build
WORKDIR /app

# Версия pnpm закреплена: та же, что на машине разработчика. Иначе corepack
# притащит свежую, а она читает настройки из других мест и спотыкается о
# список разрешённых сборок.
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 dala

COPY --from=build --chown=dala:dala /app/.next/standalone ./
COPY --from=build --chown=dala:dala /app/.next/static ./.next/static
COPY --from=build --chown=dala:dala /app/public ./public

USER dala
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/login || exit 1

CMD ["node", "server.js"]
