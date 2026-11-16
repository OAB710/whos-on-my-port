// Picks a technology icon for a process (runtime + framework sniffing). Pure, no 'vscode' import.
import { stripExe } from './safety';

/** Icon keys = file names in media/runtime (without .svg). */
export const ICONS_WITH_LIGHT = new Set(['bun', 'deno', 'next', 'remix', 'expo', 'turborepo']);

// Order matters: more specific first (vitest before vite, nuxt before vue...).
const JS_FRAMEWORKS: [RegExp, string][] = [
  [/[\\/]vitest[\\/]|\bvitest\b/, 'vitest'],
  [/[\\/]next[\\/]dist|[\\/]\.bin[\\/]next\b|\bnext(\.js)? (dev|start)\b/, 'next'],
  [/[\\/]nuxi?[\\/]|\bnuxi?\b (dev|start)/, 'nuxt'],
  [/@remix-run|remix-serve|\bremix (dev|vite)/, 'remix'],
  [/[\\/]astro[\\/]|\bastro (dev|preview)/, 'astro'],
  [/[\\/]gatsby[\\/]|\bgatsby (develop|serve)/, 'gatsby'],
  [/storybook/, 'storybook'],
  [/@angular[\\/]cli|[\\/]ng(\.js)? serve|\bng serve\b/, 'angular'],
  [/@nestjs[\\/]cli|\bnest(\.js)? start\b/, 'nest'],
  [/[\\/]expo[\\/]|\bexpo start\b/, 'expo'],
  [/[\\/]nx[\\/]|\bnx (serve|run)\b/, 'nx'],
  [/[\\/]turbo[\\/]|\bturbo (dev|run)\b/, 'turborepo'],
  [/[\\/]vite[\\/]|\bvite(\.js)?\b/, 'vite'],
  [/react-scripts/, 'react'],
  [/@vue[\\/]cli-service|vue-cli-service/, 'vue'],
  [/@sveltejs[\\/]kit|svelte-kit/, 'svelte'],
  [/webpack/, 'webpack'],
  [/[\\/]parcel[\\/]|\bparcel (serve|watch)?\b/, 'parcel'],
  [/esbuild/, 'esbuild'],
];

const BY_NAME: Record<string, string> = {
  node: 'nodejs', npm: 'nodejs', npx: 'nodejs', yarn: 'nodejs', pnpm: 'nodejs',
  bun: 'bun', deno: 'deno',
  python: 'python', python3: 'python', pythonw: 'python', py: 'python', uvicorn: 'python', gunicorn: 'python', flask: 'python',
  java: 'java', javaw: 'java', kotlin: 'kotlin', gradle: 'gradle', mvn: 'maven',
  go: 'go', dlv: 'go', air: 'go',
  dotnet: 'csharp', iisexpress: 'csharp',
  ruby: 'ruby', rails: 'ruby', puma: 'ruby',
  php: 'php', 'php-cgi': 'php',
  httpd: 'http', apache: 'http', hugo: 'http', ngrok: 'http', cloudflared: 'http',
  nginx: 'nginx', caddy: 'caddy',
  mysqld: 'database', mariadbd: 'database', postgres: 'database', mongod: 'database',
  'redis-server': 'database', memurai: 'database', elasticsearch: 'database', 'rabbitmq-server': 'database',
  erl: 'erlang', 'beam.smp': 'elixir',
  cargo: 'rust', esbuild: 'esbuild',
  docker: 'docker', 'com.docker.backend': 'docker', 'com.docker.proxy': 'docker', vpnkit: 'docker',
  wslrelay: 'console', wslhost: 'console',
  code: 'vscode', 'code - insiders': 'vscode', cursor: 'vscode', windsurf: 'vscode', codium: 'vscode', vscodium: 'vscode',
};

export function iconKey(name: string, commandLine: string | null): string | undefined {
  const n = stripExe(name);
  const cmd = (commandLine ?? '').toLowerCase();
  const base = BY_NAME[n];

  if (base === 'nodejs' || base === 'bun' || base === 'deno') {
    for (const [re, key] of JS_FRAMEWORKS) if (re.test(cmd)) return key;
  }
  if (base === 'python') {
    if (/manage\.py\s+runserver|django/.test(cmd)) return 'django';
    if (/jupyter/.test(cmd)) return 'jupyter';
  }
  if (base === 'php' && /\bartisan\b/.test(cmd)) return 'laravel';
  if (base === 'java') {
    if (/gradle/.test(cmd)) return 'gradle';
    if (/plexus-classworlds|[\\/]maven[\\/]/.test(cmd)) return 'maven';
  }
  return base;
}

/** Windows FILETIME (100ns since 1601) → Unix ms. */
export function filetimeToMs(ft: number): number {
  return ft / 10_000 - 11_644_473_600_000;
}

/** Compact uptime: 45s, 12m, 3h, 2d. */
export function formatUptime(createdFiletime: number, now = Date.now()): string | undefined {
  if (!createdFiletime) return undefined;
  const secs = Math.max(0, Math.floor((now - filetimeToMs(createdFiletime)) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

/** Memory as "39 MB" / "1.4 GB". */
export function formatMb(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
