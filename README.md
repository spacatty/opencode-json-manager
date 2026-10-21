# opencodejsonmanager

[![npm](https://img.shields.io/npm/v/opencodejsonmanager)](https://www.npmjs.com/package/opencodejsonmanager)
[![node](https://img.shields.io/node/v/opencodejsonmanager)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/opencodejsonmanager)](LICENSE)

A local web UI for your [OpenCode](https://opencode.ai) config. Paste an OpenAI-compatible endpoint, pick models from a list, and get correct `opencode.json` entries with context limits, pricing and capabilities already filled in.

```bash
npx opencodejsonmanager
```

That's it: it finds your config, starts a server on `127.0.0.1` and opens your browser. Works on macOS, Linux and Windows with Node.js 18+. No dependencies.

![Providers tab](https://raw.githubusercontent.com/spacatty/opencode-json-manager/main/docs/screenshot.jpg)

## Why

Adding a custom provider to OpenCode means hand-writing a `provider` block, looking up each model's ID, context window, output limit, pricing and whether it supports tools or images. This tool reads all of that from the endpoint's `/models` list and from [models.dev](https://models.dev) (the catalog OpenCode itself uses), and lets you review it before saving.

## Features

- **Add a provider from an endpoint.** Paste a base URL (OpenRouter, DeepInfra, Together, Groq, vLLM, LiteLLM, LM Studio, Ollama…) and an optional API key. It calls `/models` and shows every model in a filterable table.
- **Suggested settings per model.** Uses the endpoint's own metadata where available (OpenRouter returns context, pricing, tools, reasoning and vision) and fills gaps from models.dev. Each value shows where it came from. Embedding, image and TTS models are flagged so you don't add them by mistake.
- **Model editor.** Name, context and output limits, tool calling, reasoning, attachments, temperature, cost, plus raw JSON for anything else. A **Test** button sends a tiny request to check the model answers.
- **Default models.** Set `model` and `small_model` from the models you've added.
- **Every other setting.** The "All settings" tab is generated from the official schema at `opencode.ai/config.json`, so new OpenCode options show up without updating this tool.
- **Rules & agents.** Edit global and project `AGENTS.md`, markdown agents and commands (`~/.config/opencode/agents/`, `commands/`, and `.opencode/` in the project), and the project's `.gitignore` / `.ignore`.
- **Raw JSON.** Edit the whole file directly when you'd rather.
- **Safe writes.** Every save writes a `.bak` backup first and replaces the file atomically. It warns before rewriting a `.jsonc` file that has comments.

## Which file it edits

It detects these locations; switch between them in the top bar:

| Scope   | Path |
|---------|------|
| env     | `$OPENCODE_CONFIG` |
| global  | `~/.config/opencode/opencode.json(c)` (on Windows too: `%USERPROFILE%\.config\opencode\`) |
| project | `./opencode.json(c)`, `./.opencode/opencode.json(c)` |

By default it opens the first existing file that already contains providers. Run it from a project folder to see that project's config too.

## Options

```
npx opencodejsonmanager [options]

-c, --config <path>   Config file to edit (default: auto-detect)
-p, --port <port>     Port (default 4747, falls back to a free one)
    --no-open         Don't open the browser
```

## API keys and security

When adding a provider you choose how to store the key:

- as an `{env:VAR_NAME}` reference, which OpenCode reads from your environment (recommended),
- as a plain value in the config file,
- or not at all.

Keys are only sent to the endpoint you entered, never anywhere else, and never logged. The server listens on `127.0.0.1` only, checks the `Host` header, and requires a random per-session token, so other sites in your browser can't talk to it.

## Development

```bash
git clone https://github.com/spacatty/opencode-json-manager
cd opencode-json-manager
node bin/cli.js --config /tmp/test-opencode.json   # try it against a scratch file
```

| Command | What it does |
|---|---|
| `npm start` | Run the CLI |
| `npm test` | End-to-end smoke test (needs network: hits OpenRouter `/models` and opencode.ai) |
| `npm run check-schema` | Compare the live OpenCode schema with the bundled snapshot |
| `npm run update-schema` | Refresh the bundled snapshot in `schema/` |

The UI in `public/` is plain HTML/CSS/JS with no build step. See [AGENTS.md](AGENTS.md) for the code layout and the rules contributors (human or AI) should follow, in particular checking the OpenCode schema before changing what gets written.

## License

[MIT](LICENSE)
