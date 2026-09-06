#!/usr/bin/env bash
set -euo pipefail

if [[ -d /usr/lib/postgresql/17/bin ]]; then
  PATH="/usr/lib/postgresql/17/bin:$PATH"
fi

required=(SOURCE_DB_URL BACKUP_SUPABASE_URL BACKUP_SUPABASE_PUBLISHABLE_KEY BACKUP_GATEWAY_SECRET BACKUP_ENCRYPTION_KEY)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required secret: ${name}" >&2
    exit 1
  fi
done

project_slug="setka-pontaj"
source_project_ref="ufkeqoeyrhwvvvtiopyt"
local_date="$(TZ=Europe/Chisinau date +%F)"
created_at="$(date -u +%FT%TZ)"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

dump_file="$work_dir/database.dump"
manifest_file="$work_dir/manifest.json"
archive_file="$work_dir/${project_slug}-${local_date}.tar.gz"
encrypted_file="${archive_file}.enc"

echo "Creating PostgreSQL custom-format dump for ${source_project_ref}..."
pg_dump \
  --dbname="$SOURCE_DB_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --file="$dump_file"

pg_restore --list "$dump_file" > "$work_dir/restore-list.txt"
object_count="$(wc -l < "$work_dir/restore-list.txt" | tr -d ' ')"
dump_sha256="$(sha256sum "$dump_file" | cut -d' ' -f1)"
dump_bytes="$(wc -c < "$dump_file" | tr -d ' ')"

printf '%s\n' \
  '{' \
  '  "format": "setka-postgres-backup-v1",' \
  "  \"project_slug\": \"${project_slug}\"," \
  "  \"source_project_ref\": \"${source_project_ref}\"," \
  "  \"created_at\": \"${created_at}\"," \
  "  \"moldova_date\": \"${local_date}\"," \
  '  "postgres_dump_format": "custom",' \
  "  \"dump_sha256\": \"${dump_sha256}\"," \
  "  \"dump_bytes\": ${dump_bytes}," \
  "  \"restore_object_count\": ${object_count}" \
  '}' > "$manifest_file"

tar -C "$work_dir" -czf "$archive_file" database.dump manifest.json restore-list.txt
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 250000 \
  -in "$archive_file" \
  -out "$encrypted_file" \
  -pass env:BACKUP_ENCRYPTION_KEY

encrypted_sha256="$(sha256sum "$encrypted_file" | cut -d' ' -f1)"
encrypted_bytes="$(wc -c < "$encrypted_file" | tr -d ' ')"
gateway_url="${BACKUP_SUPABASE_URL}/functions/v1/backup-upload-gateway"

printf '{"source_project_ref":"%s","created_at":"%s","encrypted_sha256":"%s","encrypted_bytes":%s}\n' \
  "$source_project_ref" "$created_at" "$encrypted_sha256" "$encrypted_bytes" > "$work_dir/upload.json"

sign_payload="$(jq -n \
  --arg source_project_ref "$source_project_ref" \
  --arg backup_date "$local_date" \
  --arg encrypted_sha256 "$encrypted_sha256" \
  --argjson encrypted_bytes "$encrypted_bytes" \
  '{action:"sign",source_project_ref:$source_project_ref,backup_date:$backup_date,encrypted_sha256:$encrypted_sha256,encrypted_bytes:$encrypted_bytes}')"
sign_response="$(curl --silent --show-error --write-out $'\n%{http_code}' \
  -X POST "$gateway_url" \
  -H "Content-Type: application/json" \
  -H "x-backup-secret: ${BACKUP_GATEWAY_SECRET}" \
  --data "$sign_payload")"
sign_status="${sign_response##*$'\n'}"
sign_body="${sign_response%$'\n'*}"

# The gateway keeps one verified backup per Moldova date. Several scheduled
# attempts run each evening so a delayed GitHub cron still produces a backup;
# whichever attempt arrives second is a no-op rather than a failure.
if [[ "$sign_status" == "409" ]]; then
  echo "A verified backup already exists for ${local_date}; nothing to do."
  exit 0
fi
if [[ "$sign_status" != "200" ]]; then
  echo "Gateway rejected the sign request (HTTP ${sign_status}): ${sign_body}" >&2
  exit 1
fi

backup_bucket="$(jq -er '.bucket' <<< "$sign_body")"
backup_path="$(jq -er '.backup.path' <<< "$sign_body")"
backup_token="$(jq -er '.backup.token' <<< "$sign_body")"
metadata_path="$(jq -er '.metadata.path' <<< "$sign_body")"
metadata_token="$(jq -er '.metadata.token' <<< "$sign_body")"

echo "Uploading encrypted backup to ${backup_path}..."
BACKUP_BUCKET="$backup_bucket" node scripts/upload-signed-backup.mjs \
  "$encrypted_file" "$work_dir/upload.json" \
  "$backup_path" "$backup_token" "$metadata_path" "$metadata_token"

confirm_payload="$(jq -n \
  --arg source_project_ref "$source_project_ref" \
  --arg backup_date "$local_date" \
  '{action:"confirm",source_project_ref:$source_project_ref,backup_date:$backup_date}')"
confirm_response="$(curl --fail-with-body --silent --show-error \
  -X POST "$gateway_url" \
  -H "Content-Type: application/json" \
  -H "x-backup-secret: ${BACKUP_GATEWAY_SECRET}" \
  --data "$confirm_payload")"
jq -e '.verified == true' <<< "$confirm_response" >/dev/null

echo "Backup uploaded, checksum-verified, and retained independently: ${backup_path}"
echo "Encrypted SHA-256: ${encrypted_sha256}"
