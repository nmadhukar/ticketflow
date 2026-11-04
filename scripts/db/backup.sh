#!/usr/bin/env sh
# Backs up the whole TicketFlow database from the Docker Compose `postgres` service: every schema,
# so the assistant's saved conversations (schema `mastra`) come with the tickets. Also writes the
# database roles WITHOUT passwords (scripts/db/provision-assistant-db.mjs sets the assistant role's
# password again on restore).
#
#   scripts/db/backup.sh [output directory]      (default ./backups)
#
# Writes <dir>/ticketflow-<UTC time>.dump (pg_dump custom format) and <dir>/roles-<UTC time>.sql.
# Keep both somewhere other than this host. Restore: scripts/db/restore.sh.
set -eu

out_dir="${1:-./backups}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$out_dir"
umask 077

db_user="$(docker compose exec -T postgres printenv POSTGRES_USER)"
db_name="$(docker compose exec -T postgres printenv POSTGRES_DB)"

docker compose exec -T postgres pg_dump -U "$db_user" -d "$db_name" --format=custom \
  > "$out_dir/ticketflow-$stamp.dump"
docker compose exec -T postgres pg_dumpall -U "$db_user" --roles-only --no-role-passwords \
  > "$out_dir/roles-$stamp.sql"

echo "backup: $out_dir/ticketflow-$stamp.dump"
echo "backup: $out_dir/roles-$stamp.sql (no passwords)"
