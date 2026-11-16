// Rebuilds the command a user most likely typed to start a server, from the Windows process
// tree (used by Port History when a server we never saw start gets killed). Pure, no 'vscode'.
import type { ProcInfo } from '../types';
import { baseName, tokenizeCommandLine } from './pathUtils';
import { stripExe } from './safety';

const INTERACTIVE_SHELLS = new Set(['pwsh', 'powershell', 'bash', 'sh', 'zsh', 'fish', 'nu', 'wsl', 'cmd']);
const STOP_AT = new Set([
  'code', 'code - insiders', 'cursor', 'windsurf', 'vscodium', 'codium', 'code - oss', 'antigravity',
  'explorer', 'services', 'svchost', 'wininit', 'winlogon', 'windowsterminal', 'openconsole', 'conhost',
  'claude',
]);

/** A cmd.exe / powershell started with /c or -Command is a wrapper (npm scripts), not the user's shell. */
function isWrapperShell(p: ProcInfo): boolean {
  const cmd = (p.commandLine ?? '').toLowerCase();
  const name = stripExe(p.name);
  if (name === 'cmd') return /(^|\s)\/[a-z]*c\b/.test(cmd.replace(/^"[^"]*"|^\S+/, ''));
  if (name === 'powershell' || name === 'pwsh') return /\s-(c|command|file|encodedcommand)\b/.test(cmd);
  if (name === 'sh' || name === 'bash') return /\s-c\b/.test(cmd);
  return false;
}

/**
 * The process directly below the user's shell (or the top of a broken chain): for
 * `pwsh → node npm-cli.js run dev → cmd /c node server.js → node server.js` that is the npm process.
 * `lineage` = [process, parent, grandparent, …].
 */
export function launcherOf(lineage: readonly ProcInfo[]): ProcInfo | undefined {
  if (lineage.length === 0) return undefined;
  let top = lineage.length - 1;
  for (let i = 1; i < lineage.length; i++) {
    const p = lineage[i];
    const name = stripExe(p.name);
    if (STOP_AT.has(name) || (INTERACTIVE_SHELLS.has(name) && !isWrapperShell(p))) {
      top = i - 1;
      break;
    }
  }
  // A package manager in the chain (`npm run dev`, `pnpm dev`…) is what the user typed, even
  // when tools or wrappers sit above it (nodemon, task runners, agents): prefer the highest one.
  for (let i = top; i >= 0; i--) {
    if (isPackageManager(lineage[i])) return lineage[i];
  }
  // Never hand back a wrapper shell (`bash -c "…"`): step down to what it runs.
  while (top > 0 && isWrapperShell(lineage[top])) top--;
  return lineage[top];
}

const PM_SCRIPT = /[\\/](npm-cli|npx-cli|yarn|pnpm)\.c?js\b/i;
const PM_EXE = new Set(['npm', 'npx', 'yarn', 'pnpm']);

function isPackageManager(p: ProcInfo): boolean {
  const name = stripExe(p.name);
  if (PM_EXE.has(name)) return true;
  if (name === 'node') return PM_SCRIPT.test(p.commandLine ?? '');
  if (name === 'bun') return /\s(run|dev|start)\b/.test(p.commandLine ?? '');
  return false;
}

const quote = (s: string) => (/[\s"&|<>^]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

const JS_TOOLS: [RegExp, string][] = [
  [/[\\/]npm-cli\.js$/i, 'npm'],
  [/[\\/]npx-cli\.js$/i, 'npx'],
  [/[\\/]yarn\.c?js$/i, 'yarn'],
  [/[\\/]pnpm\.c?js$/i, 'pnpm'],
];

/** Runtimes whose install folder is irrelevant: `C:\Program Files\nodejs\node.exe` → `node`. */
const PLAIN_RUNTIMES = new Set(['node', 'bun', 'deno', 'npm', 'npx', 'yarn', 'pnpm', 'go', 'dotnet', 'php', 'ruby', 'java']);

/**
 * Turns a raw Windows command line into what a person would type:
 * `"C:\Program Files\nodejs\node.exe" "C:\…\npm-cli.js" run dev` → `npm run dev`,
 * `cmd.exe /d /s /c "vite --port 5173"` → `vite --port 5173`.
 * Python and other interpreters keep their full path when not a plain runtime (virtualenvs matter).
 */
export function friendlyCommand(commandLine: string): string {
  let tokens = tokenizeCommandLine(commandLine.trim());
  if (tokens.length === 0) return commandLine.trim();

  // Unwrap `cmd /d /s /c <command>`.
  if (stripExe(baseName(tokens[0])) === 'cmd') {
    const c = tokens.findIndex((t, i) => i > 0 && /^\/[a-z]*c$/i.test(t));
    if (c > 0 && c < tokens.length - 1) {
      const rest = tokens.slice(c + 1);
      return rest.length === 1 ? friendlyCommand(rest[0]) : friendlyCommand(rest.map(quote).join(' '));
    }
  }

  const exe = stripExe(baseName(tokens[0]));
  if (exe === 'node' && tokens.length > 1) {
    for (const [re, tool] of JS_TOOLS) {
      if (re.test(tokens[1])) {
        tokens = [tool, ...tokens.slice(2)];
        return tokens.map(quote).join(' ');
      }
    }
  }
  if (PLAIN_RUNTIMES.has(exe)) tokens = [exe, ...tokens.slice(1)];
  return tokens.map(quote).join(' ');
}
