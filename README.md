# sintaks.dev Copilot Provider

Use [sintaks.dev](https://sintaks.dev) AI gateway models inside GitHub Copilot Chat in VS Code — 300+ OpenAI-compatible models (OpenAI, Anthropic, Google, Alibaba, and more) billed per request in IDR with QRIS top-ups. No credit card required.

## Features

- Registers a `sintaks` model vendor in the Copilot Chat model picker
- Discovers models live from `GET https://api.sintaks.dev/v1/models` (chat models only, with context window and capability metadata)
- Streaming chat completions via `POST /v1/chat/completions`
- Function/tool calling, vision input (for `supports_vision` models), and `reasoning_effort` passthrough
- API key stored in VS Code Secret Storage — never written to settings files
- Readable gateway errors (invalid key, insufficient credits, rate limits)

## Setup

1. Install the extension (`.vsix` or from the Marketplace once published).
2. Open Copilot Chat → model picker → **Manage Models…** → pick **sintaks.dev**.
3. When prompted, paste an API key from [app.sintaks.dev](https://app.sintaks.dev).
   You can also run **sintaks.dev: Manage Provider** from the Command Palette to
   set/clear the key, refresh the model list, or open the dashboard.
4. Pick any `sintaks` model in the model picker and chat.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `sintaks.baseUrl` | `https://api.sintaks.dev/v1` | Gateway base URL (OpenAI-compatible `/v1` root). Point at a local gateway for development. |

## Development

```sh
pnpm install
pnpm run compile     # bundle to dist/extension.js
pnpm run typecheck   # strict tsc check
pnpm run watch       # rebuild on change
```

Press `F5` in VS Code to launch an Extension Development Host with the provider loaded.

Package a `.vsix` for sideloading:

```sh
pnpm run vsce
```

## Requirements

- VS Code `^1.104.0` (stable `languageModelChatProviders` contribution point)
- GitHub Copilot Chat installed
- A sintaks.dev account with microcredit balance for non-free models
