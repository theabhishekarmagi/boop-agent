import { tool, type CallModelInputFilter } from "@openai/agents";
import { z } from "zod";

function textOutput(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map(textOutput);
    return parts.every(part => part !== undefined) ? parts.join("\n") : undefined;
  }
  if (value && typeof value === "object" && "type" in value && "text" in value &&
    (value.type === "text" || value.type === "input_text") && typeof value.text === "string") return value.text;
  return undefined;
}

// Per-run storage: never shared between agents or workspaces. Full results remain
// available without re-executing (and possibly duplicating) an external action.
export function createAgentContext() {
  const results = new Map<string, string>();
  const read = tool({
    name: "read_tool_result", strict: true,
    description: "Read a page of a shortened result from this run. query is a SHORT EXACT LITERAL SUBSTRING, not a natural-language question or instruction. Use query=null to read at offset. A missing match returns the page at offset with a warning. Never repeat external actions just to recover results.",
    parameters: z.object({ call_id: z.string(), offset: z.number().int().min(0), query: z.string().nullable().describe("Exact literal substring, e.g. a message ID or sender. Not a question. Use null for paging.") }),
    execute: async ({ call_id, offset, query }) => {
      const original = results.get(call_id);
      if (original === undefined) return "Unknown result: only results from this agent run are available.";
      const match = query ? original.toLowerCase().indexOf(query.toLowerCase(), offset) : offset;
      const start = match < 0 ? offset : match;
      const end = Math.min(start + 8000, original.length);
      return JSON.stringify({ call_id, offset: start, next_offset: end < original.length ? end : null,
        total_chars: original.length, ...(match < 0 ? { warning: "No exact literal match. Returning the page at offset instead; query is not a semantic search. Use a shorter exact substring or query=null." } : {}), content: original.slice(start, end) });
    },
  });
  const filter: CallModelInputFilter = ({ modelData }) => {
    const outputs = modelData.input.filter(item => item.type === "function_call_result" &&
      textOutput(item.output) !== undefined);
    // Keep call/result pairs and reasoning intact; shorten only textual payloads.
    // Recent results get more space, while older results stay retrievable by ID.
    const oldCount = Math.max(0, outputs.length - 3);
    const oldLimit = Math.min(1200, Math.floor(16000 / Math.max(1, oldCount)));
    outputs.forEach((item, index) => {
      if (item.type !== "function_call_result") return;
      const text = textOutput(item.output);
      if (text === undefined) return;
      if (!results.has(item.callId)) results.set(item.callId, text);
      const original = results.get(item.callId)!;
      const limit = index < oldCount ? oldLimit : 16000;
      if (original.length <= limit) return;
      const preview = original.slice(0, limit);
      const shortened = `${preview}\n\n[SHORTENED tool result; not complete evidence. Full ${original.length} characters available via read_tool_result(call_id=${JSON.stringify(item.callId)}, offset=${limit}, query=null). Search with query or page as needed before making completeness claims.]`;
      item.output = typeof item.output === "string" ? shortened : Array.isArray(item.output)
        ? [{ type: "input_text", text: shortened }] : { ...item.output, type: "text", text: shortened };
    });
    return modelData;
  };
  return { read, filter };
}

export const EFFICIENT_TOOLS = `
Tool efficiency (all integrations and research):
- Use the narrowest server-side filters and fields that answer the task. Discover tools once, then reuse their schemas.
- For an overview, start with a small metadata/summary batch. Fetch full records only when needed; do not download an entire account by default.
- If the user explicitly requests an exhaustive task, paginate until complete. For partial results, state the coverage honestly; never present a sample as exhaustive.
- Prefer direct/batched tools to remote workbench programs. Use workbench only for computation or workflows that need it; bound each batch and print only relevant results.
- A timeout is not proof that an external action failed. Check its execution/status before retrying; never blindly repeat a send/create/update.
- For timed-out read-only work, narrow the query or reduce the batch instead of repeating the same unbounded program.
- Shortened results are previews, not full evidence. Use read_tool_result to retrieve needed details without repeating the provider request. Keep concise notes of IDs, facts, coverage, and next cursor as you work.
- Stop fetching once the requested outcome is established; avoid redundant discovery, repeated reads, and unrelated work.
`;
