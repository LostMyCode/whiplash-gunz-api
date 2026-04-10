# OGZ API Lambda

Lambda bridging Discord interactions and the OGZ MatchServer Admin HTTP API.

## Requirements

- AWS SAM CLI
- Node.js 20+

## Deploy

```bash
cd lambda
sam build
sam deploy \
  --parameter-overrides \
    MatchServerHost=<IP> \
    MatchServerSecret=<SECRET> \
    DiscordPublicKey=<HEX_KEY>
```

## Adding a New Command

1. Create `src/handlers/<commandName>.js` and export `handle<CommandName>(interaction)`
2. Add `'command-name': handler` to `COMMAND_HANDLERS` in `src/handlers/index.js`
3. Register the Slash Command in the Discord Developer Portal

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_PUBLIC_KEY` | yes | Discord Application Public Key (hex) |
| `MATCHSERVER_HOST` | yes | MatchServer IP / hostname |
| `MATCHSERVER_PORT` | | Admin HTTP port (default: 6034) |
| `MATCHSERVER_SECRET` | yes | MatchServer Bearer token |
| `MATCHSERVER_USE_HTTPS` | | Set to `true` to use HTTPS (default: false) |
