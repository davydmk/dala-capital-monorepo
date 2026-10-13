#!/usr/bin/env bash
# Миграции базы. Отдельным шагом, а не при старте: схема меняется осознанно,
# и видеть её применение нужно глазами.
set -euo pipefail
cd "$(dirname "$0")"

docker compose run --rm --no-deps --entrypoint "" backend \
  npx prisma migrate deploy
