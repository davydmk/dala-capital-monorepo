#!/usr/bin/env bash
# Проверка живости раз в минуту. Падение должно быть видно нам, а не жюри.
# Ставится в cron: * * * * * /srv/dala/app/deploy/uptime.sh
set -uo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

LOG=/srv/dala/uptime.log
CODE=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 "https://$APP_DOMAIN/api/health" || echo 000)
if [ "$CODE" != "200" ]; then
  echo "$(date -Is) health=$CODE" >> "$LOG"
  # Перезапускаем только то, что действительно лежит: compose сам поднимет
  # упавшие контейнеры, а работающие не тронет.
  docker compose up -d >> "$LOG" 2>&1
fi
