// Pure path helpers (Windows semantics). No 'vscode' import.

/** Lower-case, backslashes, no trailing separator. */
export function normalizePath(p: string): string {
  let s = p.replace(/\//g, '\\').toLowerCase();
  while (s.length > 3 && s.endsWith('\\')) s = s.slice(0, -1);
  return s;
}

const BOUNDARY = new Set(['\\', '"', "'", ' ', '\t', ';', ',', undefined]);

/**
 * True when `folder` (normalized) appears in `haystack` (normalized) followed by a
 * path boundary, so "d:\app" does not match "d:\app2\server.js".
 */
export function mentionsFolder(haystack: string, folder: string): boolean {
  if (!folder) return false;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(folder, from);
    if (i < 0) return false;
    const next = haystack[i + folder.length];
    if (BOUNDARY.has(next)) return true;
    from = i + 1;
  }
}

/** Returns the longest folder from `folders` mentioned in `haystack`. */
export function findMentionedFolder(haystack: string, folders: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const f of folders) {
    if (mentionsFolder(haystack, f) && (!best || f.length > best.length)) best = f;
  }
  return best;
}

export function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

const SYSTEM_PATH_HINTS = [
  '\\program files',
  '\\windows\\',
  '\\appdata\\roaming\\npm',
  '\\appdata\\local\\programs\\',
  '\\appdata\\local\\microsoft\\',
  '\\nodejs\\',
  '\\.nvm\\',
  '\\nvm\\',
  '\\scoop\\',
  '\\chocolatey\\',
  '\\.bun\\',
  '\\.cargo\\',
  '\\go\\bin',
  '\\python3',
  '\\.pyenv\\',
  '\\miniconda',
  '\\anaconda',
  '\\.gradle\\',
  '\\.m2\\',
];

/** Splits a Windows command line into arguments, honouring double quotes. */
export function tokenizeCommandLine(cmd: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let has = false;
  for (const ch of cmd) {
    if (ch === '"') {
      quoted = !quoted;
      has = true;
    } else if (!quoted && (ch === ' ' || ch === '\t')) {
      if (has) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

const ABS_PATH_RE = /[a-z]:\\.*/i;

/**
 * Best-effort guess of the project folder a command line belongs to.
 * Returns the original-case folder path or undefined.
 */
export function guessProjectPath(commandLine: string | null): string | undefined {
  if (!commandLine) return undefined;
  const candidates: string[] = [];
  for (const tok of tokenizeCommandLine(commandLine.replace(/\//g, '\\'))) {
    // Also catches "--root=D:\x" style arguments.
    const m = ABS_PATH_RE.exec(tok);
    if (m) candidates.push(m[0]);
  }
  for (let cand of candidates) {
    cand = cand.trim().replace(/\\+$/, '');
    const lower = cand.toLowerCase();
    if (SYSTEM_PATH_HINTS.some((h) => lower.includes(h))) continue;

    const nm = lower.indexOf('\\node_modules\\');
    if (nm > 0) return cand.slice(0, nm);
    const last = baseName(cand);
    if (/\.[a-z0-9]{1,6}$/i.test(last)) {
      const dir = cand.slice(0, cand.length - last.length - 1);
      if (dir.length > 3) return dir;
      continue;
    }
    if (cand.length > 3) return cand;
  }
  return undefined;
}
