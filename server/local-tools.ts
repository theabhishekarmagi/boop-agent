import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, readdir, realpath, mkdir } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { tool, type Tool } from "@openai/agents";
import { z } from "zod";

const execAsync = promisify(exec);
async function projectPath(path: string, create = false): Promise<string> {
  const root = await realpath(process.cwd());
  const target = resolve(root, path);
  let physical: string;
  try { physical = await realpath(target); }
  catch (err) {
    if (!create || (err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // Find the closest existing parent to catch symlink escapes for new files.
    let parent = dirname(target);
    while (true) {
      try { physical = resolve(await realpath(parent), relative(parent, target)); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" || parent === dirname(parent)) throw error; parent = dirname(parent); }
    }
  }
  const rel = relative(root, physical);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("File tools operate inside the Boop project.");
  return physical;
}
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    if (["node_modules", ".git", "dist", ".cache"].includes(entry.name) || entry.isSymbolicLink()) continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path)); else if (entry.isFile()) result.push(path);
  }
  return result;
}
function globRegex(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      i++; if (pattern[i + 1] === "/") { i++; out += "(?:.*/)?"; } else out += ".*";
    } else if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else out += ch.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`${out}$`);
}
/** Local capability equivalents previously supplied implicitly by the Claude SDK. */
export function localTools(signal?: AbortSignal): Tool[] {
  return [
    tool({ name: "Read", description: "Read a UTF-8 project file with optional 1-based line offset and line limit.", parameters: z.object({ file_path: z.string(), offset: z.number().int().positive().nullable(), limit: z.number().int().positive().nullable() }),
      execute: async ({ file_path, offset, limit }) => {
        const text = await readFile(await projectPath(file_path), "utf8");
        const start = (offset ?? 1) - 1;
        return text.split("\n").slice(start, start + (limit ?? 400)).map((line, i) => `${start + i + 1}: ${line}`).join("\n").slice(0, 60_000);
      } }),
    tool({ name: "Write", description: "Create or replace a UTF-8 project file.", parameters: z.object({ file_path: z.string(), content: z.string() }),
      execute: async ({ file_path, content }) => { signal?.throwIfAborted(); const path = await projectPath(file_path, true); await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); return `Saved ${file_path}`; } }),
    tool({ name: "Edit", description: "Replace an exact string in a project file. Without replace_all, the match must be unique.", parameters: z.object({ file_path: z.string(), old_string: z.string().min(1), new_string: z.string(), replace_all: z.boolean() }),
      execute: async ({ file_path, old_string, new_string, replace_all }) => {
        signal?.throwIfAborted(); const path = await projectPath(file_path); const text = await readFile(path, "utf8");
        const count = text.split(old_string).length - 1;
        if (!count || (!replace_all && count !== 1)) throw new Error("Edit target is missing or ambiguous; read the file first.");
        await writeFile(path, replace_all ? text.split(old_string).join(new_string) : text.replace(old_string, new_string)); return `Edited ${file_path}`;
      } }),
    tool({ name: "Glob", description: "Find project paths using *, **, and ? patterns; skips dependencies and Git internals.", parameters: z.object({ pattern: z.string(), path: z.string().nullable() }),
      execute: async ({ pattern, path }) => { const root = await projectPath(path ?? "."); const match = globRegex(pattern); return (await files(root)).map((p) => relative(root, p)).filter((p) => match.test(p)).slice(0, 500).join("\n"); } }),
    tool({ name: "Grep", description: "Search UTF-8 project files with a regular expression. Returns path, line number, and matches.", parameters: z.object({ pattern: z.string(), path: z.string().nullable() }),
      execute: async ({ pattern, path }) => {
        const root = await projectPath(path ?? "."); const match = new RegExp(pattern); const hits: string[] = [];
        for (const file of await files(root)) {
          signal?.throwIfAborted(); const text = await readFile(file, "utf8"); if (text.includes("\0") || text.length > 2_000_000) continue;
          for (const [line, content] of text.split("\n").entries()) if (match.test(content)) hits.push(`${relative(root, file)}:${line + 1}:${content}`);
          if (hits.length >= 300) break;
        }
        return hits.slice(0, 300).join("\n").slice(0, 60_000);
      } }),
    tool({ name: "Bash", description: "Run a project skill's shell command in the Boop project. This has the host process's permissions. Use only commands needed for the user's task; ask before destructive operations or external sends.", parameters: z.object({ command: z.string(), timeout: z.number().int().min(1).max(600_000).nullable() }),
      execute: async ({ command, timeout }) => {
        signal?.throwIfAborted();
        try { const result = await execAsync(command, { cwd: process.cwd(), signal, timeout: timeout ?? 120_000, maxBuffer: 2_000_000 }); return (result.stdout + result.stderr).slice(0, 60_000); }
        catch (err) { if (signal?.aborted) throw signal.reason; const failure = err as Error & { stdout?: string; stderr?: string; code?: number }; return `Command failed (${failure.code ?? "error"}):\n${failure.stdout ?? ""}${failure.stderr ?? ""}`.slice(0, 60_000); }
      } }),
  ];
}
