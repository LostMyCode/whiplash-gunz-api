#!/bin/sh
set -eu

# Replace these values before running.
APPLICATION_ID=""
BOT_TOKEN=""
GUILD_ID=""

# Use "guild" for fast server-local updates, or "global" for all servers.
COMMAND_SCOPE="guild"

API_BASE="https://discord.com/api/v10"

COMMANDS_JSON='[
  {
    "name": "claim",
    "description": "Claim a daily bounty code",
    "type": 1,
    "options": [
      {
        "name": "code",
        "description": "Claim code, e.g. WHIP-A1B2C3D4E5F6",
        "type": 3,
        "required": true
      }
    ]
  }
]'

if [ "$APPLICATION_ID" = "PUT_APPLICATION_ID_HERE" ]; then
  echo "Set APPLICATION_ID in this script before running."
  exit 1
fi

if [ "$BOT_TOKEN" = "PUT_BOT_TOKEN_HERE" ]; then
  echo "Set BOT_TOKEN in this script before running."
  exit 1
fi

case "$COMMAND_SCOPE" in
  guild)
    if [ "$GUILD_ID" = "PUT_GUILD_ID_HERE" ]; then
      echo "Set GUILD_ID in this script before registering guild commands."
      exit 1
    fi
    URL="${API_BASE}/applications/${APPLICATION_ID}/guilds/${GUILD_ID}/commands"
    ;;
  global)
    URL="${API_BASE}/applications/${APPLICATION_ID}/commands"
    ;;
  *)
    echo "COMMAND_SCOPE must be either 'guild' or 'global'."
    exit 1
    ;;
esac

echo "Registering Discord ${COMMAND_SCOPE} application commands..."

curl --fail-with-body -X PUT "$URL" \
  -H "Authorization: Bot ${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$COMMANDS_JSON"

echo
echo "Discord commands registered."
