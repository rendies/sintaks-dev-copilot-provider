import * as vscode from "vscode";
import { SintaksClient, type ChatChunk, type GatewayModel } from "./client";
import { convertMessages, convertModelOptions, convertTools, mapToolChoice } from "./convert";

const API_KEY_SECRET = "sintaks.apiKey";
const DEFAULT_MAX_OUTPUT_TOKENS = 16384;

export class SintaksChatModelProvider implements vscode.LanguageModelChatProvider {
  private modelCache: vscode.LanguageModelChatInformation[] | undefined;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  private baseUrl(): string {
    const configured = vscode.workspace.getConfiguration("sintaks").get<string>("baseUrl", "");
    return (configured || "https://api.sintaks.dev/v1").replace(/\/+$/, "");
  }

  private async client(): Promise<SintaksClient> {
    return new SintaksClient(this.baseUrl(), await this.secrets.get(API_KEY_SECRET));
  }

  private async requireApiKey(silent: boolean): Promise<boolean> {
    if (await this.secrets.get(API_KEY_SECRET)) {
      return true;
    }
    if (silent) {
      return false;
    }
    return this.promptApiKey();
  }

  private async promptApiKey(): Promise<boolean> {
    const key = await vscode.window.showInputBox({
      title: "sintaks.dev API Key",
      prompt: "Paste an API key from https://app.sintaks.dev — it stays in VS Code Secret Storage.",
      password: true,
      ignoreFocusOut: true,
      placeHolder: "sk-…",
    });
    if (!key?.trim()) {
      return false;
    }
    await this.secrets.store(API_KEY_SECRET, key.trim());
    this.modelCache = undefined;
    return true;
  }

  /** Implementation of the "Manage Provider" gear command. */
  async manage(): Promise<void> {
    const pick = await vscode.window.showQuickPick(
      [
        { label: "Set API Key", action: "set" },
        { label: "Clear API Key", action: "clear" },
        { label: "Refresh Model List", action: "refresh" },
        { label: "Open Dashboard", action: "dashboard" },
      ] as Array<vscode.QuickPickItem & { action: string }>,
      { title: "Manage sintaks.dev" },
    );
    if (!pick) {
      return;
    }
    switch (pick.action) {
      case "set":
        await this.promptApiKey();
        break;
      case "clear":
        await this.secrets.delete(API_KEY_SECRET);
        this.modelCache = undefined;
        break;
      case "refresh":
        this.modelCache = undefined;
        break;
      case "dashboard":
        void vscode.env.openExternal(vscode.Uri.parse("https://app.sintaks.dev"));
        break;
    }
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    if (this.modelCache) {
      return this.modelCache;
    }
    if (!(await this.requireApiKey(options.silent))) {
      return [];
    }
    const models = await (await this.client()).listModels(token);
    this.modelCache = models
      .filter((model) => !model.type || model.type === "chat")
      .map(toChatInformation);
    return this.modelCache;
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    if (!(await this.requireApiKey(false))) {
      throw new vscode.LanguageModelError("A sintaks.dev API key is required — run “sintaks.dev: Manage Provider” to set one.");
    }

    const tools = convertTools(options.tools);
    const body: Record<string, unknown> = {
      model: model.id,
      messages: convertMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
      ...convertModelOptions(options.modelOptions as Record<string, unknown> | undefined),
    };
    if (tools) {
      body.tools = tools;
      const toolChoice = mapToolChoice(options.toolMode, true);
      if (toolChoice) {
        body.tool_choice = toolChoice;
      }
    }

    const pendingCalls = new Map<number, { id: string; name: string; args: string }>();
    const onChunk = (chunk: ChatChunk): void => {
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (!delta) {
        return;
      }
      if (typeof delta.content === "string" && delta.content) {
        progress.report(new vscode.LanguageModelTextPart(delta.content));
      }
      for (const call of delta.tool_calls ?? []) {
        const index = call.index ?? 0;
        const pending = pendingCalls.get(index) ?? { id: "", name: "", args: "" };
        if (call.id) {
          pending.id = call.id;
        }
        if (call.function?.name) {
          pending.name = call.function.name;
        }
        if (call.function?.arguments) {
          pending.args += call.function.arguments;
        }
        pendingCalls.set(index, pending);
      }
    };

    await (await this.client()).streamChat(body, onChunk, token);

    for (const call of pendingCalls.values()) {
      let input: object = {};
      try {
        input = call.args ? JSON.parse(call.args) : {};
      } catch {
        // Forward a malformed argument string verbatim instead of dropping the call.
        input = { __raw: call.args };
      }
      progress.report(new vscode.LanguageModelToolCallPart(call.id, call.name, input));
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    const value =
      typeof text === "string"
        ? text
        : text.content
            .map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : ""))
            .join("");
    return Math.max(1, Math.ceil(value.length / 4));
  }
}

function toChatInformation(model: GatewayModel): vscode.LanguageModelChatInformation {
  const contextWindow = model.context_window && model.context_window > 0 ? model.context_window : 128000;
  const maxOutputTokens = Math.min(DEFAULT_MAX_OUTPUT_TOKENS, contextWindow);
  const caps = model.capabilities ?? {};
  const family = model.id.includes("/") ? model.id.slice(0, model.id.indexOf("/")) : "sintaks";

  const pricing = model.pricing_idr_per_1m;
  const detail = pricing?.input_idr_per_1m
    ? `Rp${pricing.input_idr_per_1m.toLocaleString("id-ID")} / 1M input`
    : undefined;

  return {
    id: model.id,
    name: model.id,
    family,
    version: "1.0.0",
    maxInputTokens: Math.max(1000, contextWindow - maxOutputTokens),
    maxOutputTokens,
    tooltip: `${model.id} · ${contextWindow.toLocaleString()} tokens`,
    detail,
    capabilities: {
      imageInput: caps.supports_vision === true,
      toolCalling: caps.supports_tools !== false,
    },
  };
}
