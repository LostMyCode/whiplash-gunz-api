# OGZ API Lambda

Discord interactions と OGZ MatchServer Admin HTTP API の橋渡し Lambda。

## 必要環境

- AWS SAM CLI
- Node.js 20+

## デプロイ

```bash
cd lambda
sam build
sam deploy \
  --parameter-overrides \
    MatchServerHost=<IP> \
    MatchServerSecret=<SECRET> \
    DiscordPublicKey=<HEX_KEY>
```

## 新しいコマンドの追加

1. `src/handlers/<commandName>.js` を作成して `handle<CommandName>(interaction)` をエクスポート
2. `src/handlers/index.js` の `COMMAND_HANDLERS` に `'command-name': handler` を追加
3. Discord Developer Portal で Slash Command を登録

## 環境変数

| 変数名 | 必須 | 説明 |
|---|---|---|
| `DISCORD_PUBLIC_KEY` | yes | Discord Application Public Key (hex) |
| `MATCHSERVER_HOST` | yes | MatchServer の IP / ホスト名 |
| `MATCHSERVER_PORT` | | Admin HTTP ポート (デフォルト: 6034) |
| `MATCHSERVER_SECRET` | yes | MatchServer Bearer トークン |
| `MATCHSERVER_USE_HTTPS` | | `true` にすると HTTPS 使用 (デフォルト: false) |
