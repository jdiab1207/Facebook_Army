# Security notes

This project manages Facebook browser sessions and credentials on **your machine**. Treat the install directory as sensitive.

## Never commit

These paths are gitignored and must stay private:

| Path | Why |
|------|-----|
| `.env` | `MASTER_KEY`, `ADMIN_TOKEN` |
| `data/` | SQLite DB, API key hashes, screenshots, encrypted secrets |
| `profiles/` | Chromium profiles with Facebook cookies / sessions |

If any of the above are ever committed, rotate tokens, revoke API keys, and treat those Facebook sessions as compromised.

## Safe to publish

- Source under `apps/`, `packages/`, `scripts/`, `ops/`
- `.env.example` (placeholders only)
- Documentation and UI screenshots that do **not** show real account content

## Operational hygiene

1. Bind the API to `127.0.0.1` (default) or Tailscale — do not expose it publicly without auth.
2. Assign a sticky ISP proxy **before** first login for client accounts.
3. Use scoped `X-API-Key` values per client AI; revoke keys you no longer need.
4. Back up `.env`, `data/`, and `profiles/` offline — not to a public repo.
