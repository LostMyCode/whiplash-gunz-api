# Contributing to Whiplash GunZ API

Thanks for your interest in contributing! This document explains how to report issues, propose changes, and get a pull request merged.

## Ground rules

- Be respectful and constructive. We're all here to keep a 20-year-old game alive.
- **Never post secrets** (bot tokens, bearer tokens, Turnstile keys, AWS credentials, `sam deploy` parameter values) in issues, PRs, commit messages, or logs — including in screenshots and CloudWatch excerpts.
- Security vulnerabilities go through [SECURITY.md](SECURITY.md), **not** the public issue tracker.
- All code comments, log messages, and documentation must be written in **English**.

## Filing issues

Before opening an issue, search existing ones. When you open a new issue, include:

- **What you did** — the exact request (with secrets redacted), the function involved (`DiscordFunction`, `RegisterFunction`, `RegisterGoogleFunction`, `RankingPublisherFunction`).
- **What happened vs. what you expected** — HTTP status, response body, relevant CloudWatch log lines (redact tokens and IPs).
- **Environment** — SAM CLI version, Node version, region, whether you run a stock or modified MatchServer.

Feature requests are welcome — describe the use case, not just the solution.

## Development setup

There is no root `package.json`. Each Lambda under `src/` is a self-contained package:

```bash
cd src/register && npm install   # or src/ranking
npx tsc --noEmit                 # strict typecheck, per function
sam build                        # builds all four functions
```

`src/index.js` (Discord) is plain JavaScript with no build step — keep it dependency-free.

To exercise the registration path end-to-end you need a MatchServer built from [whiplash-gunz](https://github.com/LostMyCode/whiplash-gunz) listening on its WebSocket port (6032 by default).

## Pull requests

1. Fork and create a topic branch from `main`.
2. Keep PRs focused — one logical change per PR.
3. Follow the existing commit message style (Conventional Commits): `feat: …`, `fix: …`, `docs: …`, `refactor: …`.
4. Before pushing:
   - `npx tsc --noEmit` passes in every TS function directory you touched.
   - `sam build` succeeds.
   - If you added an environment variable or dependency, update **both** the function code and the matching `Environment` / `Metadata.BuildProperties` block in `template.yaml`, plus the README configuration tables.
5. Describe **why** the change is needed, not just what it does. Link the issue it fixes.

### Things to know before touching specific areas

- **`src/register/matchserver.ts`** — this file implements the GunZ MCommand binary protocol and its cipher. It must stay byte-for-byte compatible with the C++ implementation in whiplash-gunz (`MMatchUtil.cpp`, `MPacketCrypter.cpp`, `MCommandBuilder.cpp`). Read the header comment first. Any change to the wire format, key schedule, or cipher **requires a matching change in the whiplash-gunz repository** and a coordinated deployment — call this out prominently in your PR.
- **`src/ranking/`** — deliberately uses pure-JS/WASM dependencies (`sql.js`, `fzstd`). PRs that reintroduce native SQLite/zstd bindings, Lambda layers, or container images will be declined.
- **New Discord commands** — add `src/handlers/<name>.js`, register it in `src/handlers/index.js`, and document the command registration in `scripts/register-discord-commands.sh` (with placeholder credentials only).
- **Secrets** — all secrets are `NoEcho` SAM parameters supplied at deploy time. Never add a default value containing a real credential to `template.yaml`, `samconfig.toml`, or any script.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
