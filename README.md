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
    TurnstileSecretKey=<TURNSTILE_SECRET> \
    GoogleClientId=<GOOGLE_CLIENT_ID>
```

This stack also creates a DynamoDB table named `whiplash-gunz-accounts` for successful account registrations.

## Adding a new Discord command

1. Create `src/handlers/<commandName>.js` exporting an async `handle<Name>(interaction)` function
2. Register it in `src/handlers/index.js` under `COMMAND_HANDLERS`
3. Register the slash command in the Discord Developer Portal

## Environment Variables

`POST /register` expects `username`, `password`, `email`, and `turnstileToken` in the JSON body.

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
| `TURNSTILE_SECRET_KEY` | yes | Cloudflare Turnstile secret key for `/register` CAPTCHA verification |
| `GOOGLE_CLIENT_ID` | yes (Google only) | Google OAuth 2.0 client ID |
| `REGISTERED_ACCOUNTS_TABLE_NAME` | injected by SAM | DynamoDB table for successful account registrations |

### Registered Accounts

`POST /register` and successful `POST /register/google` responses write a best-effort DynamoDB record after the MatchServer accepts the account. If the key already exists, the write is treated as a no-op.

Record fields:

| Field | Description |
|---|---|
| `accountKey` | Partition key. Matches the MatchServer `UserID` value |
| `username` | Registered username or generated Google account key |
| `authProvider` | `password` or `google` |
| `email` | Registered e-mail address |
| `sourceIp` | Client IP from API Gateway HTTP API `sourceIp` or forwarded headers |
| `userAgent` | Browser or client user agent if available |
| `route` | Request path, such as `/register` or `/register/google` |
| `stage` | API Gateway stage name |
| `requestId` | API Gateway request id |
| `createdAt` | ISO-8601 UTC timestamp of the successful registration |
| `updatedAt` | Last time the mirror record was written |
| `matchserverMessage` | Registration success message returned by MatchServer |

The table is a simple per-account mirror keyed by the MatchServer user ID. For Google accounts, `accountKey` is the server-generated `g_<hash(sub)>` value, so the mirror stays aligned with the server's own identity model. SAM injects `REGISTERED_ACCOUNTS_TABLE_NAME` into both registration Lambdas. Only those Lambdas get `dynamodb:PutItem` permission.
