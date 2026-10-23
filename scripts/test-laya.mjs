import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const python = resolve(root, 'data/laya/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(python)) {
  console.error('Set up the isolated environment first; see experiments/laya/README.md.');
  process.exitCode = 1;
} else {
  const child = spawn(python, [resolve(root, 'scripts/benchmark-laya.py'), ...process.argv.slice(2)], {
    cwd: root, stdio: 'inherit', env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });
}
