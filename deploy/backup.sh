#!/usr/bin/env bash
# Дамп базы и копия загруженных документов. Хранение — 14 дней.
# Ставится в cron: 0 3 * * * /srv/dala/app/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

DEST=/srv/dala/backups
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$DEST"

docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$DEST/db-$STAMP.dump"

tar -czf "$DEST/uploads-$STAMP.tar.gz" -C /srv/dala uploads

# Старое удаляем сами: диск на машине один и небольшой.
find "$DEST" -type f -mtime +14 -delete
ls -lh "$DEST" | tail -5
