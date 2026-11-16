// Classifies listeners into Current / Other / Orphan / System. Pure, no 'vscode' import.
import type { PortEntry, PortGroup, ProcInfo, ScanResult, WindowInfo } from '../types';
import { launcherOf } from './launchCommand';
import { baseName, findMentionedFolder, guessProjectPath, normalizePath } from './pathUtils';
import { blockReason, isLoopback, stripExe } from './safety';

export interface ClassifyContext {
  /** Folders of this window (any casing / separators). */
  currentFolders: string[];
  currentTerminalPids: ReadonlySet<number>;
  /** Working directory of each terminal of this window (from shell integration). */
  currentTerminalCwds?: ReadonlyMap<number, string>;
  otherWindows: WindowInfo[];
  /** Folders of every workspace ever registered (orphan detection). */
  knownFolders: string[];
  devNames: ReadonlySet<string>;
  /** PID of the extension host (its ancestors are the editor itself). */
  selfPid: number;
}

export interface Ancestry {
  chain: ProcInfo[];
  /** Parent is gone or its PID was reused by a younger process. */
  broken: boolean;
}

/** Walks up ParentProcessId, guarding against PID reuse and cycles. */
export function ancestry(pid: number, procs: ReadonlyMap<number, ProcInfo>): Ancestry {
  const chain: ProcInfo[] = [];
  const seen = new Set<number>([pid]);
  let cur = procs.get(pid);
  while (cur && chain.length < 64) {
    const ppid = cur.ppid;
    if (ppid === 0 || ppid === 4) return { chain, broken: false };
    const parent = procs.get(ppid);
    if (!parent || seen.has(ppid)) return { chain, broken: true };
    // A parent created after its child means the PID was recycled.
    if (parent.created && cur.created && parent.created > cur.created) return { chain, broken: true };
    chain.push(parent);
    seen.add(ppid);
    cur = parent;
  }
  return { chain, broken: false };
}

const SHELLS = new Set([
  'pwsh', 'powershell', 'cmd', 'bash', 'sh', 'zsh', 'fish', 'nu', 'wsl', 'conhost', 'openconsole', 'winpty-agent', 'tmux', 'git-bash',
]);
const EDITOR_NAMES = new Set(['code', 'code - insiders', 'cursor', 'windsurf', 'vscodium', 'codium', 'code - oss', 'antigravity']);
/** Executables living inside an extensions folder are extension tooling. */
const EXTENSION_PATH_RE = /\\\.(?:vscode|vscode-insiders|cursor|windsurf|vscode-oss|antigravity)[^\\]*\\extensions\\|\\resources\\app\\extensions\\/;

/**
 * How the editor started this process, if it did: via a terminal shell
 * (Code.exe → pwsh → node) or directly by an extension (Code.exe → agy.exe).
 */
export function editorSpawn(proc: ProcInfo | undefined, chain: ProcInfo[]): 'terminal' | 'extension' | undefined {
  if (!proc) return undefined;
  const lineage = [proc, ...chain];
  for (let i = 1; i < lineage.length; i++) {
    if (EDITOR_NAMES.has(stripExe(lineage[i].name))) {
      return SHELLS.has(stripExe(lineage[i - 1].name)) ? 'terminal' : 'extension';
    }
  }
  return undefined;
}

/** Longest folder that contains `cwd` (all normalized). */
function folderForCwd(cwd: string, folders: string[]): string | undefined {
  let best: string | undefined;
  for (const f of folders) {
    if ((cwd === f || cwd.startsWith(f + '\\')) && (!best || f.length > best.length)) best = f;
  }
  return best;
}

function haystackOf(p?: ProcInfo): string {
  if (!p) return '';
  return normalizePath(`${p.commandLine ?? ''} ${p.exePath ?? ''}`);
}

export function classify(scan: ScanResult, ctx: ClassifyContext): PortEntry[] {
  // Editor = extension host + all of its ancestors (Code.exe main process).
  const editorPids = new Set<number>([ctx.selfPid, ...ancestry(ctx.selfPid, scan.procs).chain.map((p) => p.pid)]);

  // Group bind addresses by (port, pid) so IPv4 + IPv6 become one row.
  const byKey = new Map<string, { port: number; pid: number; addresses: string[] }>();
  for (const s of scan.sockets) {
    const key = `${s.port}:${s.pid}`;
    const e = byKey.get(key) ?? { port: s.port, pid: s.pid, addresses: [] };
    if (!e.addresses.includes(s.address)) e.addresses.push(s.address);
    byKey.set(key, e);
  }

  // Folders arrive in original casing; match on normalized form, display the original.
  const display = new Map<string, string>();
  const norm = (f: string) => {
    const n = normalizePath(f);
    if (!display.has(n)) display.set(n, f);
    return n;
  };
  const current = ctx.currentFolders.map(norm);
  const known = ctx.knownFolders.map((f) => ({ n: norm(f) }));

  const otherTerminal = new Map<number, WindowInfo>();
  for (const w of ctx.otherWindows) for (const t of w.terminalPids) otherTerminal.set(t, w);
  const otherFolders = ctx.otherWindows.flatMap((w) => w.folders.map((f) => ({ f: norm(f), w })));

  const entries: PortEntry[] = [];
  for (const { port, pid, addresses } of byKey.values()) {
    const proc = scan.procs.get(pid);
    const { chain, broken } = ancestry(pid, scan.procs);
    const name = proc?.name ?? '';
    const isDev = ctx.devNames.has(stripExe(name));
    const hay = haystackOf(proc);

    const entry: PortEntry = {
      port,
      pid,
      addresses,
      proc,
      parent: chain[0],
      group: 'system',
      isDev,
      elevated: !!proc && proc.commandLine === null && pid !== 0 && pid !== 4,
      lanExposed: addresses.some((a) => !isLoopback(a)),
      blocked: proc ? blockReason(pid, name, editorPids) : 'exited',
      connections: scan.connections.get(`${port}:${pid}`) ?? 0,
    };

    let group: PortGroup | undefined;

    // What the user most likely ran to start this server (for Port History).
    if (proc) entry.launcherCommandLine = launcherOf([proc, ...chain])?.commandLine ?? undefined;

    // 1-2. Terminal ancestry (most reliable).
    const lineage = [pid, ...chain.map((c) => c.pid)];
    let termCwd: string | undefined;
    const myTerm = lineage.find((p) => ctx.currentTerminalPids.has(p));
    if (myTerm !== undefined) {
      group = 'current';
      entry.terminalPid = myTerm;
      const idx = lineage.indexOf(myTerm);
      if (idx > 0) entry.terminalChildPid = lineage[idx - 1];
      termCwd = ctx.currentTerminalCwds?.get(myTerm);
    }
    let otherTermPid: number | undefined;
    const otherTerm =
      myTerm === undefined
        ? lineage.map((p) => {
            const w = otherTerminal.get(p);
            if (w) otherTermPid = p;
            return w;
          }).find(Boolean)
        : undefined;
    if (otherTerm) {
      group = 'other';
      entry.windowLabel = otherTerm.label;
      termCwd = otherTermPid !== undefined ? otherTerm.terminalCwds?.[otherTermPid] : undefined;
    }

    // Started by the editor itself but not through a terminal shell
    // (language servers, AI agents, extension helpers...).
    // Exception: a dev server that clearly belongs to a project even though an
    // extension launched it (debugger, AI agents like Claude Code / Copilot).
    const spawn = editorSpawn(proc, chain);
    const inExtensionDir = EXTENSION_PATH_RE.test(hay);
    const projectDevServer =
      isDev && !inExtensionDir && (!!findMentionedFolder(hay, current) || !!guessProjectPath(proc?.commandLine ?? null));
    if (!group && !entry.blocked && (spawn === 'extension' || inExtensionDir) && !projectDevServer) group = 'extension';

    // 3-4. Path fallback.
    const curFolder = group === 'extension' ? undefined : findMentionedFolder(hay, current);
    if (!group && curFolder) group = 'current';
    if (!group) {
      const hit = findMentionedFolder(hay, otherFolders.map((o) => o.f));
      if (hit) {
        group = 'other';
        entry.windowLabel = otherFolders.find((o) => o.f === hit)?.w.label;
      }
    }

    // A terminal of a VS Code window that does not run this extension.
    if (!group && spawn === 'terminal') {
      group = 'other';
      entry.unregisteredWindow = true;
    }

    // 5. Orphan: dev process whose launcher is gone (not in any live terminal),
    //    belonging to a workspace we have seen. Overrides path-based grouping.
    const knownFolder = group === 'extension' ? undefined : findMentionedFolder(hay, known.map((k) => k.n));
    if (!entry.terminalPid && !otherTerm && isDev && broken && knownFolder) {
      group = 'orphan';
    }

    if (termCwd) entry.terminalCwd = termCwd;

    // 6-7.
    if (!group) group = isDev ? 'other' : 'system';
    entry.group = group;

    // Project name / path (prefer original casing). The terminal's working
    // directory resolves relative commands like "node server.js".
    const cwdFolder = termCwd ? folderForCwd(normalizePath(termCwd), [...current, ...known.map((k) => k.n)]) : undefined;
    const folderNorm = curFolder ?? cwdFolder ?? knownFolder;
    const folder = folderNorm ? display.get(folderNorm) ?? folderNorm : termCwd;
    // Guessing from arbitrary paths is only meaningful for dev processes.
    const guessed = folder ?? (isDev && !entry.blocked ? guessProjectPath(proc?.commandLine ?? null) : undefined);
    if (guessed) {
      entry.projectPath = guessed;
      entry.projectName = baseName(guessed);
    }
    if (!entry.projectName && entry.windowLabel) entry.projectName = entry.windowLabel;

    entries.push(entry);
  }

  return entries.sort((a, b) => a.port - b.port || a.pid - b.pid);
}
