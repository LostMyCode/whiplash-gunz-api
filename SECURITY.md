# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or Discord channels.**

Instead, use one of these private channels:

1. **GitHub private vulnerability reporting (preferred)** — go to the repository's **Security** tab → **Report a vulnerability**. This opens a private advisory visible only to maintainers.
2. **Direct message** — contact the maintainer ([@LostMyCode](https://x.com/LostMyCode)) via X/Twitter DM, or a private DM to a maintainer on the community Discord (do not post in public channels).

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (a proof-of-concept request is ideal — with any real tokens redacted).
- The affected component (`/register`, `/register/google`, `/discord/interactions`, ranking publisher, or the MCommand protocol client).

You can expect an acknowledgement within **72 hours** and a status update within **7 days**. Please give us a reasonable window to ship a fix before public disclosure — we will credit you in the advisory unless you prefer otherwise.

## Scope

In scope:

- Authentication/authorization bypasses on any endpoint (signature verification, Turnstile bypass, bearer-token handling).
- Injection or memory-safety issues reachable through the registration payloads or the MCommand encoding in `src/register/matchserver.ts`.
- Secret leakage (logs, error responses, DynamoDB records).
- Server-side request forgery or abuse of the MatchServer bridge.

Related but hosted elsewhere: vulnerabilities in the **MatchServer itself or the WASM client** belong to [whiplash-gunz](https://github.com/LostMyCode/whiplash-gunz)'s security policy. If you're unsure where a protocol-level issue belongs, report it here and we'll route it.

## Known design limitations (not vulnerabilities)

- The MCommand packet cipher (`MPacketCrypter`, seed-key XOR/bit-rotation) is the **original 2005-era GunZ obfuscation layer**, kept for wire compatibility. It is *not* modern cryptography and is not relied upon for confidentiality; sensitive flows add their own protections (BLAKE2b password hashing before transmission, Google ID token verification server-side, registration gated by a shared secret and CAPTCHA). Reports that the legacy cipher is weak are appreciated but considered known.
- The MatchServer Admin HTTP API is plain HTTP by design and must only be exposed on a private network. Deployments that expose it publicly are a configuration issue, not a code vulnerability — but reports of the stack *defaulting* to an unsafe configuration are in scope.

## Supported versions

Only the latest `main` branch is supported. There are no maintained release branches.
