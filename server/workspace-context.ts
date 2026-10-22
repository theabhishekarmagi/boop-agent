import { AsyncLocalStorage } from "node:async_hooks";

export const OPERATOR_OWNER = "boop:operator";
const workspace = new AsyncLocalStorage<string>();

export function currentOwner(): string {
  const owner = workspace.getStore();
  if (!owner) throw new Error("Workspace context is required");
  return owner;
}

export function isOperator(): boolean {
  return workspace.getStore() === OPERATOR_OWNER;
}

export function runInWorkspace<T>(owner: string, fn: () => T): T {
  if (!owner) throw new Error("Workspace owner is required");
  return workspace.run(owner, fn);
}

export function workspaceKey(id: string): string {
  return JSON.stringify([currentOwner(), id]);
}
