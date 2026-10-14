import { mkdir, chmod, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { BufferJSON, initAuthCreds, proto, type AuthenticationState, type SignalDataTypeMap } from "@whiskeysockets/baileys";

export async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, "utf8"), BufferJSON.reviver); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Cannot read WhatsApp state; restore it before reconnecting.");
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(`${path}.tmp`, JSON.stringify(value, BufferJSON.replacer), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
  await chmod(path, 0o600);
}

// One process must own this account's Signal keys. Recover a lock only when its
// recorded process is no longer alive; never open a second socket on live state.
export async function lockWhatsAppDirectory(directory: string): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, "owner.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(path, String(process.pid), { flag: "wx", mode: 0o600 });
      return async () => { await unlink(path).catch(() => {}); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(await readFile(path, "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid WhatsApp lock; inspect owner.lock manually.");
      try { process.kill(pid, 0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") { await unlink(path); continue; }
        throw error;
      }
      throw new Error("Another process already owns the WhatsApp session. Stop it before starting Boop again.");
    }
  }
  throw new Error("Could not acquire WhatsApp session lock.");
}

type KeyData = { [T in keyof SignalDataTypeMap]?: Record<string, SignalDataTypeMap[T]> };

// Atomic, serialized local persistence of both credentials and all Signal key
// categories, including v7 LID mappings. Intended for one persistent host.
export async function loadWhatsAppAuth(directory: string) {
  const path = join(directory, "auth.json");
  const stored = await readJson<{ creds: AuthenticationState["creds"]; keys: KeyData }>(path);
  const creds = stored?.creds ?? initAuthCreds();
  const keys: KeyData = stored?.keys ?? {};
  let writes: Promise<void> = Promise.resolve();
  const save = () => {
    writes = writes.then(() => writeJson(path, { creds, keys }));
    return writes;
  };
  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        await writes;
        const result: Record<string, SignalDataTypeMap[typeof type]> = {};
        for (const id of ids) {
          let value = keys[type]?.[id];
          if (type === "app-state-sync-key" && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value as proto.Message.IAppStateSyncKeyData) as unknown as SignalDataTypeMap[typeof type];
          }
          if (value) result[id] = value;
        }
        return result;
      },
      set: async (updates) => {
        for (const type of Object.keys(updates) as (keyof SignalDataTypeMap)[]) {
          const bucket = (keys[type] ??= {}) as Record<string, unknown>;
          for (const [id, value] of Object.entries(updates[type] ?? {})) {
            if (value == null) delete bucket[id];
            else bucket[id] = value;
          }
        }
        await save();
      },
    },
  };
  return { state, saveCreds: save, flush: () => writes };
}
