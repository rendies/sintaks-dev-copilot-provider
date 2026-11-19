import * as vscode from "vscode";

/** Shape of one entry returned by GET {base}/models. */
export interface GatewayModel {
  id: string;
  type?: string;
  context_window?: number;
  capabilities?: {
    supports_temperature?: boolean;
    supports_tools?: boolean;
    supports_reasoning_effort?: boolean;
    supports_response_format?: boolean;
    supports_vision?: boolean;
    [key: string]: boolean | undefined;
  };
  pricing_idr_per_1m?: {
    input_idr_per_1m?: number;
    output_idr_per_1m?: number;
  };
}

export interface ChatChunk {
  choices?: Array<{
    delta?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/** Extract the human-readable message from an OpenAI-style error body. */
export function gatewayErrorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message ?? parsed?.message;
    if (typeof message === "string" && message) {
      return message;
    }
  } catch {
    // fall through to status text
  }
  switch (status) {
    case 401:
      return "invalid or missing sintaks.dev API key";
    case 402:
      return "insufficient microcredit balance — top up at https://app.sintaks.dev";
    case 429:
      return "rate limit exceeded — retry shortly";
    case 503:
      return "model is temporarily unavailable";
    default:
      return `gateway returned HTTP ${status}`;
  }
}

/**
 * Minimal OpenAI-compatible client for the sintaks.dev gateway. Uses the
 * global fetch available in the VS Code extension host (Node 20+).
 */
export class SintaksClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "sintaks-vscode-provider",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /** GET /models — the public catalog. Filtered by the provider. */
  async listModels(token: vscode.CancellationToken): Promise<GatewayModel[]> {
    const abort = new AbortController();
    const sub = token.onCancellationRequested(() => abort.abort());
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: abort.signal,
      });
      if (!response.ok) {
        throw new vscode.LanguageModelError(gatewayErrorMessage(response.status, await response.text()));
      }
      const payload = (await response.json()) as { data?: GatewayModel[] };
      return Array.isArray(payload.data) ? payload.data : [];
    } finally {
      sub.dispose();
    }
  }

  /**
   * POST /chat/completions with stream=true. Invokes onChunk for each parsed
   * SSE data payload until the stream ends or the token is cancelled.
   */
  async streamChat(
    body: Record<string, unknown>,
    onChunk: (chunk: ChatChunk) => void,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const abort = new AbortController();
    const sub = token.onCancellationRequested(() => abort.abort());
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { ...this.headers(), Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        throw new vscode.LanguageModelError(gatewayErrorMessage(response.status, await response.text()));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith("data:")) {
            continue;
          }
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            return;
          }
          try {
            onChunk(JSON.parse(data) as ChatChunk);
          } catch {
            // Ignore unparseable keep-alive lines from the gateway.
          }
        }
      }
    } finally {
      sub.dispose();
    }
  }
}
