#!/bin/sh
# Daily backup (NFR-006): database dump and receipt volume copy, kept for 30 days.
# Run from the repo root on the VPS, for example from cron at 02:00.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/usahaku}"
STAMP="$(date +%Y-%m-%d)"
mkdir -p "$BACKUP_DIR"

docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"
docker compose exec -T api tar -C /data/uploads -czf - . > "$BACKUP_DIR/receipts-$STAMP.tar.gz"

find "$BACKUP_DIR" -type f -mtime +30 -delete
