# Whiplash GunZ API

AWS Lambda functions for the Whiplash GunZ game server, managed with AWS SAM.

## Functions

| Function | Route | Description |
|---|---|---|
| `DiscordFunction` | `POST /discord/interactions` | Discord slash command handler |
| `RegisterFunction` | `POST /register` | Password-based account registration |
| `RegisterGoogleFunction` | `POST /register/google` | Google OAuth login / registration |

## Requirements

- AWS SAM CLI
- Node.js 22+

## Build & Deploy

```bash
sam build
sam deploy \
  --parameter-overrides \
    MatchServerHost=<IP> \
    AdminServerSecret=<ADMIN_SECRET> \
    DiscordPublicKey=<HEX_KEY> \
    RegistrationSecret=<REG_SECRET> \
    GoogleClientId=<GOOGLE_CLIENT_ID>
```

## Adding a new Discord command

1. Create `src/handlers/<commandName>.js` exporting an async `handle<Name>(interaction)` function
2. Register it in `src/handlers/index.js` under `COMMAND_HANDLERS`
3. Register the slash command in the Discord Developer Portal

## Environment Variables

### Discord Lambda (`DiscordFunction`)

| Variable | Required | Description |
|---|---|---|
| `DISCORD_PUBLIC_KEY` | yes | Discord Application Public Key (hex) |
| `MATCHSERVER_HOST` | yes | MatchServer IP / hostname |
| `MATCHSERVER_PORT` | | Admin HTTP port (default: 6034) |
| `MATCHSERVER_SECRET` | yes | Bearer token for Admin API |
| `MATCHSERVER_USE_HTTPS` | | `true` to use HTTPS (default: false) |

### Register Lambdas (`RegisterFunction`, `RegisterGoogleFunction`)

| Variable | Required | Description |
|---|---|---|
| `MATCHSERVER_HOST` | yes | MatchServer IP / hostname |
| `MATCHSERVER_PORT` | | Game TCP port (default: 6000) |
| `REGISTRATION_SECRET` | | Secret token sent with account creation |
| `GOOGLE_CLIENT_ID` | yes (Google only) | Google OAuth 2.0 client ID |
