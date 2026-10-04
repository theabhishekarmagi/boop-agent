/**
 * ChatGPT plan streams can omit output from the terminal envelope, although
 * complete items were delivered in output_item.done. The Agents SDK consumes
 * the envelope, so supply those items without changing deltas or error events.
 */
export function retainStreamedOutput(response: Response): Response {
  const contentType = response.headers.get("content-type");
  // Some plan responses also omit Content-Type. Calls into this adapter are
  // explicitly streaming requests; preserve JSON HTTP errors unchanged.
  if (!response.ok || !response.body || (contentType && !contentType.includes("text/event-stream"))) return response;
  const items = new Map<number, unknown>();
  let pending = "";
  let terminalSeen = false;
  function normalize(frame: string): string {
    const lines = frame.split(/\r?\n/);
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    let event;
    try { event = JSON.parse(data); } catch { return frame; }
    if (["response.completed", "response.failed", "response.incomplete", "error"].includes(event.type)) terminalSeen = true;
    if (event.type === "response.output_item.done" && Number.isInteger(event.output_index) && event.item) {
      items.set(event.output_index, event.item);
    }
    if (event.type === "response.completed" && event.response &&
        (!event.response.output || event.response.output.length === 0) && items.size) {
      event.response.output = [...items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
      return [...lines.filter((line) => !line.startsWith("data:")), `data: ${JSON.stringify(event)}`].join("\n");
    }
    return frame;
  }
  const stream = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream<string, string>({
    transform(chunk, controller) {
      pending += chunk;
      let separator;
      while ((separator = /\r?\n\r?\n/.exec(pending))) {
        controller.enqueue(normalize(pending.slice(0, separator.index)) + "\n\n");
        pending = pending.slice(separator.index + separator[0].length);
      }
    },
    flush(controller) {
      if (pending) controller.enqueue(normalize(pending));
      if (!terminalSeen) throw new Error("OpenAI stream ended before a terminal response event.");
    },
  })).pipeThrough(new TextEncoderStream());
  const headers = new Headers(response.headers);
  headers.set("content-type", "text/event-stream");
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(stream, { status: response.status, statusText: response.statusText, headers });
}
