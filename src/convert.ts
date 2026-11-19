import * as vscode from "vscode";

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: string;
  content?: string | Array<Record<string, unknown>> | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

function serializeToolResultContent(content: readonly unknown[]): string {
  const parts: string[] = [];
  for (const part of content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      parts.push(part.value);
    } else if (part instanceof vscode.LanguageModelDataPart) {
      parts.push(`[${part.mimeType} data omitted]`);
    }
  }
  return parts.join("") || "";
}

function dataPartToImageUrl(part: vscode.LanguageModelDataPart): Record<string, unknown> | undefined {
  if (!part.mimeType.startsWith("image/")) {
    return undefined;
  }
  const base64 = Buffer.from(part.data).toString("base64");
  return { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${base64}` } };
}

/**
 * Convert VS Code chat request messages to the OpenAI chat.completions shape.
 * One request message can expand into multiple OpenAI messages when it
 * contains tool results, which are their own "tool" role messages upstream.
 */
export function convertMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];

  for (const message of messages) {
    const textParts: string[] = [];
    const contentParts: Array<Record<string, unknown>> = [];
    const toolCalls: OpenAIToolCall[] = [];

    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        textParts.push(part.value);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({
          id: part.callId,
          type: "function",
          function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) },
        });
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        out.push({
          role: "tool",
          tool_call_id: part.callId,
          content: serializeToolResultContent(part.content),
        });
      } else if (part instanceof vscode.LanguageModelDataPart) {
        const imageUrl = dataPartToImageUrl(part);
        if (imageUrl) {
          contentParts.push(imageUrl);
        }
      }
    }

    const role =
      message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
    const text = textParts.join("");

    if (role === "assistant") {
      const outMessage: OpenAIMessage = { role, content: text || null };
      if (toolCalls.length > 0) {
        outMessage.tool_calls = toolCalls;
      }
      if (message.name) {
        outMessage.name = message.name;
      }
      out.push(outMessage);
    } else {
      // Images require the multi-part content shape; text-only stays a string.
      if (contentParts.length > 0) {
        const merged: Array<Record<string, unknown>> = text
          ? [{ type: "text", text }, ...contentParts]
          : contentParts;
        out.push({ role, content: merged });
      } else {
        out.push({ role, content: text, name: message.name });
      }
    }
  }

  return out;
}

/** Convert VS Code tool declarations to OpenAI function tools. */
export function convertTools(
  tools: readonly vscode.LanguageModelChatTool[] | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : { type: "object", properties: {} },
    },
  }));
}

/** Map the requested tool mode to OpenAI's tool_choice. */
export function mapToolChoice(
  toolMode: vscode.LanguageModelChatToolMode | undefined,
  hasTools: boolean,
): "required" | "auto" | undefined {
  if (!hasTools) {
    return undefined;
  }
  return toolMode === vscode.LanguageModelChatToolMode.Required ? "required" : "auto";
}

/** Model-option keys forwarded verbatim to the gateway when present. */
const FORWARDED_MODEL_OPTIONS = new Set([
  "temperature",
  "top_p",
  "max_tokens",
  "stop",
  "seed",
  "frequency_penalty",
  "presence_penalty",
  "reasoning_effort",
]);

export function convertModelOptions(modelOptions: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!modelOptions) {
    return out;
  }
  for (const key of Object.keys(modelOptions)) {
    if (FORWARDED_MODEL_OPTIONS.has(key)) {
      out[key] = modelOptions[key];
    }
  }
  return out;
}
