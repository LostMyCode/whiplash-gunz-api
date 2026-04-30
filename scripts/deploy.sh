#!/bin/sh

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

STACK_NAME="${STACK_NAME:-whiplash-gunz-api}"
REGION="${REGION:-us-east-1}"
STAGE_NAME="${STAGE_NAME:-prod}"
MATCHSERVER_HOST="${MATCHSERVER_HOST:-}"
ADMIN_SERVER_PORT="${ADMIN_SERVER_PORT:-6034}"
ADMIN_SERVER_USE_HTTPS="${ADMIN_SERVER_USE_HTTPS:-false}"
GAME_SERVER_PORT="${GAME_SERVER_PORT:-6032}"
DISCORD_PUBLIC_KEY="${DISCORD_PUBLIC_KEY:-}"
ADMIN_SERVER_SECRET="${ADMIN_SERVER_SECRET:-}"
REGISTRATION_SECRET="${REGISTRATION_SECRET:-}"
TURNSTILE_SECRET_KEY="${TURNSTILE_SECRET_KEY:-}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
DISCORD_BOT_TOKEN="${DISCORD_BOT_TOKEN:-}"
DISCORD_RANKING_CHANNEL_ID="${DISCORD_RANKING_CHANNEL_ID:-}"
RANKING_BACKUP_BUCKET="${RANKING_BACKUP_BUCKET:-gunz-backups}"
RANKING_BACKUP_PREFIX="${RANKING_BACKUP_PREFIX:-gunzdb/}"
RANKING_TOP_N="${RANKING_TOP_N:-10}"

prompt_secret() {
  prompt="$1"
  value=""

  printf '%s' "$prompt" >&2
  stty -echo 2>/dev/null
  IFS= read -r value
  stty echo 2>/dev/null
  printf '\n'
  printf '%s' "$value"
}

prompt_input() {
  prompt="$1"
  value=""

  printf '%s' "$prompt" >&2
  IFS= read -r value
  printf '%s' "$value"
}

if [ -z "$DISCORD_PUBLIC_KEY" ]; then
  echo "DISCORD_PUBLIC_KEY is required."
  exit 1
fi

if [ -z "$ADMIN_SERVER_SECRET" ]; then
  ADMIN_SERVER_SECRET="$(prompt_secret "AdminServerSecret: ")"
fi

if [ -z "$ADMIN_SERVER_SECRET" ]; then
  echo "ADMIN_SERVER_SECRET is required."
  exit 1
fi

if [ -z "$TURNSTILE_SECRET_KEY" ]; then
  TURNSTILE_SECRET_KEY="$(prompt_secret "TurnstileSecretKey: ")"
fi

if [ -z "$TURNSTILE_SECRET_KEY" ]; then
  echo "TURNSTILE_SECRET_KEY is required."
  exit 1
fi

if [ -z "$DISCORD_BOT_TOKEN" ]; then
  DISCORD_BOT_TOKEN="$(prompt_secret "DiscordBotToken: ")"
fi

if [ -z "$DISCORD_BOT_TOKEN" ]; then
  echo "DISCORD_BOT_TOKEN is required."
  exit 1
fi

if [ -z "$DISCORD_RANKING_CHANNEL_ID" ]; then
  DISCORD_RANKING_CHANNEL_ID="$(prompt_input "DiscordRankingChannelId: ")"
fi

if [ -z "$DISCORD_RANKING_CHANNEL_ID" ]; then
  echo "DISCORD_RANKING_CHANNEL_ID is required."
  exit 1
fi

set -- \
  "MatchServerHost=${MATCHSERVER_HOST}" \
  "StageName=${STAGE_NAME}" \
  "DiscordPublicKey=${DISCORD_PUBLIC_KEY}" \
  "AdminServerPort=${ADMIN_SERVER_PORT}" \
  "AdminServerSecret=${ADMIN_SERVER_SECRET}" \
  "AdminServerUseHttps=${ADMIN_SERVER_USE_HTTPS}" \
  "GameServerPort=${GAME_SERVER_PORT}" \
  "RegistrationSecret=${REGISTRATION_SECRET}" \
  "TurnstileSecretKey=${TURNSTILE_SECRET_KEY}" \
  "GoogleClientId=${GOOGLE_CLIENT_ID}" \
  "DiscordBotToken=${DISCORD_BOT_TOKEN}" \
  "DiscordRankingChannelId=${DISCORD_RANKING_CHANNEL_ID}" \
  "GunzBackupBucket=${RANKING_BACKUP_BUCKET}" \
  "GunzBackupPrefix=${RANKING_BACKUP_PREFIX}" \
  "RankingTopN=${RANKING_TOP_N}"

cd "$ROOT_DIR"

sam build
sam deploy \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --capabilities CAPABILITY_IAM \
  --confirm-changeset \
  --resolve-s3 \
  --parameter-overrides "$@"
