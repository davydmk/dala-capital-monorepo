#!/usr/bin/env bash
# Миграции базы. Отдельным шагом, а не при старте: схема меняется осознанно,
# и видеть её применение нужно глазами.
set -euo pipefail
cd "$(dirname "$0")"

docker compose --profile tools run --rm migrate
