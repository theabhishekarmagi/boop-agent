import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { boopUserId, getComposio, listConnectedToolkits, requireGoogleWorkspaceAuthConfig } from "./composio.js";

const documentPayload = z.object({
  title: z.string().trim().min(1).max(250),
  markdown_text: z.string().trim().min(1).max(500_000),
  connectionId: z.string().optional(),
});

export function isGoogleDocDraft(kind: string): boolean {
  return kind === "gdocs.create" || kind === "googledocs.create";
}

/** Normalize older drafts too; never turn a preview/outline into an empty Doc. */
export function parseGoogleDocPayload(raw: string) {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Document draft has no full content. Prepare it again.");
  const data = value as Record<string, unknown>;
  const candidate = {
    title: data.title,
    markdown_text: data.markdown_text ?? data.content ?? data.text ?? data.body,
    connectionId: data.connectionId ?? data.connectedAccountId,
  };
  const parsed = documentPayload.safeParse(candidate);
  if (!parsed.success) throw new Error("Document draft needs a title and its full text. Prepare it again.");
  return parsed.data;
}

type DocResult = { error: string | null; logId?: string; data: unknown };
type DocAccount = { slug: string; connectionId: string; status: string };

export async function createApprovedGoogleDoc(
  draftId: string, conversationId: string, rawPayload: string,
  deps: {
    accounts: () => Promise<DocAccount[]>;
    execute: (connectionId: string, title: string, markdown: string) => Promise<DocResult>;
    claim: (draftId: string, conversationId: string) => Promise<unknown>;
    finish: (draftId: string, status: "sent" | "uncertain", note: string) => Promise<unknown>;
  } = {
    accounts: listConnectedToolkits,
    execute: async (connectionId, title, markdown) => {
      const composio = getComposio();
      if (!composio) throw new Error("Composio is unavailable.");
      const session = await composio.create(boopUserId(), {
        toolkits: ["googlesuper"], manageConnections: false,
        connectedAccounts: { googlesuper: connectionId },
        authConfigs: { googlesuper: await requireGoogleWorkspaceAuthConfig() },
      });
      return await session.execute("GOOGLESUPER_CREATE_DOCUMENT_MARKDOWN", { title, markdown_text: markdown });
    },
    claim: (id, conversation) => convex.mutation(api.drafts.claimGoogleDocCreation, { draftId: id, conversationId: conversation }),
    finish: (id, status, note) => convex.mutation(api.drafts.finishGoogleDocCreation, { draftId: id, status, note }),
  },
): Promise<{ status: "sent" | "uncertain"; url?: string; note: string }> {
  const payload = parseGoogleDocPayload(rawPayload);
  const matches = (await deps.accounts()).filter(account => account.status === "ACTIVE" && account.slug === "googlesuper" &&
    (!payload.connectionId || account.connectionId === payload.connectionId));
  if (matches.length !== 1) throw new Error(matches.length ? "Choose which connected Google Workspace account should own the document." : "Connect Google Workspace to create this document.");

  // Atomic claim precedes the only external create call. A lost response may
  // mean the Doc exists, so this draft is never automatically retried.
  await deps.claim(draftId, conversationId);
  let result: DocResult;
  try {
    result = await deps.execute(matches[0]!.connectionId, payload.title, payload.markdown_text);
  } catch {
    const note = "Google Docs creation has an unknown outcome. Check your Drive before preparing another document.";
    try { await deps.finish(draftId, "uncertain", note); } catch { /* The claimed draft still cannot be reused. */ }
    return { status: "uncertain", note };
  }
  const data = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {};
  const details = data.data && typeof data.data === "object" ? data.data as Record<string, unknown> : data;
  const documentId = typeof details.documentId === "string" ? details.documentId : typeof details.document_id === "string" ? details.document_id : "";
  // session.execute() reports `error`, not the `successful` field returned by
  // the older tools.execute() API. Require both a clean execution and an ID.
  if (result.error !== null || !/^[A-Za-z0-9_-]{20,}$/.test(documentId)) {
    const note = `Google Docs did not return a confirmed document ID${result.logId ? ` (Composio log ${result.logId})` : ""}. Check Drive before trying again.`;
    try { await deps.finish(draftId, "uncertain", note); } catch { /* The claimed draft still cannot be reused. */ }
    return { status: "uncertain", note };
  }
  const url = `https://docs.google.com/document/d/${documentId}/edit`;
  try {
    await deps.finish(draftId, "sent", url);
    return { status: "sent", url, note: `Google Doc created: ${url}` };
  } catch {
    return { status: "sent", url, note: `Google Doc created: ${url}. Boop could not save the status; do not retry this draft.` };
  }
}
