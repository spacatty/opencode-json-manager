# AGENTS.md

Instructions for AI coding agents (OpenCode, Claude Code, Codex, etc.) working on this repo.

## What this is

`@spacatty/occ-manager` (command `occ-manager`) is a zero-dependency Node (>=18) CLI, run with `npx @spacatty/occ-manager`. It starts a local web UI that edits OpenCode config files (`opencode.json` / `opencode.jsonc`), mainly to add custom OpenAI-compatible providers and their models.

- `bin/cli.js`: arg parsing, port fallback, cross-platform browser opening
- `src/server.js`: `node:http` server bound to 127.0.0.1, token + Host-header checks
- `src/config.js`: config file discovery (XDG path on all OSes, `OPENCODE_CONFIG`, project files), read/write with `.bak`
- `src/files.js`: lists, reads and writes the other files OpenCode reads (global/project `AGENTS.md`, `agents/`, `commands/`, `modes/`, `.gitignore`/`.ignore`). Only listed paths (or new `.md` files in those folders) can be touched; delete renames to `.bak`
- `src/discover.js`: lists `/models` from an endpoint, enriches with models.dev, builds suggested model entries
- `src/jsonc.js`: comment/trailing-comma tolerant parser
- `public/`: vanilla JS UI, no build step
- `schema/opencode-config.schema.json`: bundled snapshot of `https://opencode.ai/config.json` (offline fallback)

## ALWAYS check the OpenCode schema first

OpenCode's config format changes often (for example, the `provider` block was marked deprecated in favour of a V2 `providers` block). **Before any change, and at the start of every session, run:**

```bash
npm run check-schema
```

- Exit code 0: the snapshot matches the live schema. Carry on.
- Exit code 1: the schema changed. Read the report, then:
  1. If any **WATCHED** definition changed (`provider`, `providers`, `model`, `small_model`, `ProviderConfig`, `Config.ProviderEncoded`, `Config.ModelEncoded`), update the code that writes those shapes:
     - `src/discover.js` → `buildSuggestion()` (which model fields are generated)
     - `public/app.js` → `modelEditor()`, `viewProviderEditor()`, `addSelected()`, `validate()`
     - `scripts/check-schema.js` → `WATCHED` list, if definitions were renamed
  2. If OpenCode now says the legacy `provider` block is removed or no longer read, switch the Providers tab to write the new format (and keep reading the old one).
  3. Run `npm run update-schema` to refresh the bundled snapshot.
  4. Run `npm test` and mention the schema changes in your summary/commit message.
- Exit code 2: network error. Say so and don't update the snapshot.

The "All settings" tab renders from the live schema at runtime, so new top-level options show up automatically. Only the hand-built Providers / Default models tabs need manual updates.

Also check the OpenCode docs for provider config (https://opencode.ai/docs/providers/ and https://opencode.ai/docs/config/) when changing what gets written, and check models.dev (`https://models.dev/api.json`) if the field names used in `buildSuggestion()` look stale.

## Rules

- No runtime dependencies. Use Node built-ins and global `fetch` only.
- Must work on macOS, Linux and Windows: use `path`/`os`, never hard-code `/` or `~` in file paths, and keep `openBrowser()` platform branches intact.
- Never log or transmit API keys. Keys only go to the endpoint the user typed.
- Keep the server bound to `127.0.0.1` with the token and Host checks.
- Writes must keep making a `.bak` and write atomically (tmp file + rename).
- Verify with `npm test` (needs network; hits OpenRouter's public `/models` and opencode.ai) and by running `node bin/cli.js --config <temp file>` to try the UI. Never test against the user's real config without asking.
