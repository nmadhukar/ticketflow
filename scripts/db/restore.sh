#!/usr/bin/env sh
# Restores a scripts/db/backup.sh dump into the Docker Compose `postgres` service's database,
# REPLACING what is there (pg_restore --clean). Stop the app and agents services first.
#
#   scripts/db/restore.sh <file.dump> --yes
#
# Before it: run the assistant provisioning (it creates the assistant role, which owns the
# `mastra` schema in the dump), e.g.
#   docker compose run --rm -e MASTRA_DB_PASSWORD=... app node scripts/db/provision-assistant-db.mjs
# After it: start the services; the app's migrations and schema check run as on every start.
set -eu

dump="${1:-}"
if [ -z "$dump" ] || [ ! -f "$dump" ] || [ "${2:-}" != "--yes" ]; then
  echo "usage: scripts/db/restore.sh <file.dump> --yes   (replaces the current database)" >&2
  exit 2
fi

db_user="$(docker compose exec -T postgres printenv POSTGRES_USER)"
db_name="$(docker compose exec -T postgres printenv POSTGRES_DB)"

docker compose exec -T postgres pg_restore -U "$db_user" -d "$db_name" --clean --if-exists --exit-on-error < "$dump"
echo "restore: $dump restored into $db_name"
