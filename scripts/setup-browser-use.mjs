import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const root = resolve(import.meta.dirname, "..");
const environment = resolve(root, "data/browser-use/venv");
const python = resolve(environment, "bin/python");
mkdirSync(resolve(root, "data/browser-use"), { recursive: true, mode: 0o700 });
function run(args) {
  const result = spawnSync("uv", args, { cwd: root, stdio: "inherit", shell: false });
  if (result.error) throw new Error("uv is required for Browser Use setup. Install uv, then rerun npm run setup:browser.");
  if (result.status !== 0) throw new Error("Browser Use setup failed. See the uv diagnostic above.");
}
try {
  if (!existsSync(python)) run(["venv", "--python", "3.12", environment]);
  run(["pip", "install", "--python", python, "-r", "server/browser-use-requirements.txt"]);
  console.log("Browser Use is installed in the isolated local environment. No cloud-browser key is required.");
} catch (error) { console.error(error.message); process.exitCode = 1; }
