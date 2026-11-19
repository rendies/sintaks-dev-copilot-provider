# sintaks.dev Copilot Provider

Use [sintaks.dev](https://sintaks.dev) AI gateway models inside VS Code chat — 300+ OpenAI-compatible models (OpenAI, Anthropic, Google, Alibaba, and more) billed per request in IDR with QRIS top-ups. No credit card required.

## Features

- Registers a `sintaks` model vendor in the VS Code model picker (Agents view / Copilot Chat)
- Discovers models live from `GET https://api.sintaks.dev/v1/models` (chat models only, with context window and capability metadata)
- Streaming chat completions via `POST /v1/chat/completions`
- Function/tool calling, vision input (for `supports_vision` models), and `reasoning_effort` passthrough
- API key stored in VS Code Secret Storage — never written to settings files
- Readable gateway errors (invalid key, insufficient credits, rate limits)

## Setup

1. Install the extension (`.vsix` or from the Marketplace).
2. Open the Command Palette (`Cmd/Ctrl+Shift+P`) and run **Chat: Manage Language Models**.
   (Or, from the chat model picker in the Agents view, click the gear icon → **Manage Language Models**.)
3. In the Language Models editor, enable **sintaks.dev** models.
4. When prompted, paste an API key from [app.sintaks.dev](https://app.sintaks.dev).
   You can also run **sintaks.dev: Manage Provider** from the Command Palette to
   set/clear the key, refresh the model list, or open the dashboard.
5. Pick any `sintaks` model in the model picker and chat.

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
- GitHub Copilot Chat (built into recent VS Code releases; install it from the Marketplace on older versions) and a GitHub Copilot account on an individual plan — models from third-party providers are only surfaced to individual Copilot plans
- A sintaks.dev account with microcredit balance for non-free models
