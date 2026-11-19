import * as vscode from "vscode";
import { SintaksChatModelProvider } from "./provider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SintaksChatModelProvider(context.secrets);
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider("sintaks", provider),
    vscode.commands.registerCommand("sintaks.manage", () => provider.manage()),
  );
}

export function deactivate(): void {}
