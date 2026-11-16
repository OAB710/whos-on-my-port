// Kill safety net. Pure, no 'vscode' import.
import type { BlockReason } from '../types';

export function stripExe(name: string): string {
  return name.toLowerCase().replace(/\.exe$/, '');
}

const SYSTEM = new Set([
  'system', 'idle', 'registry', 'secure system', 'memory compression', 'smss', 'csrss', 'wininit',
  'winlogon', 'services', 'lsass', 'lsaiso', 'svchost', 'dwm', 'spoolsv', 'fontdrvhost', 'explorer',
  'sihost', 'ctfmon', 'searchhost', 'startmenuexperiencehost', 'runtimebroker', 'msmpeng',
]);

const EDITOR = new Set(['code', 'code - insiders', 'cursor', 'windsurf', 'vscodium', 'codium', 'code - oss']);

const DOCKER = new Set([
  'com.docker.backend', 'com.docker.proxy', 'com.docker.build', 'com.docker.service',
  'docker desktop', 'vpnkit', 'dockerd', 'docker-proxy',
]);

const WSL = new Set(['wslrelay', 'wslhost', 'wsl', 'wslservice', 'vmmem', 'vmmemwsl', 'vmcompute']);

export function blockReason(pid: number, name: string, editorPids: ReadonlySet<number>): BlockReason | undefined {
  if (pid === 0 || pid === 4) return 'system';
  if (editorPids.has(pid)) return 'editor';
  const n = stripExe(name);
  if (EDITOR.has(n)) return 'editor';
  if (DOCKER.has(n)) return 'docker';
  if (WSL.has(n)) return 'wsl';
  if (SYSTEM.has(n)) return 'system';
  return undefined;
}

export const DEFAULT_DEV_PROCESSES: readonly string[] = [
  'node', 'bun', 'deno', 'npm', 'npx', 'yarn', 'pnpm',
  'python', 'python3', 'pythonw', 'py', 'uvicorn', 'gunicorn', 'flask',
  'java', 'javaw', 'kotlin', 'gradle', 'mvn',
  'go', 'dlv', 'air',
  'dotnet', 'iisexpress',
  'ruby', 'rails', 'puma',
  'php', 'php-cgi', 'httpd', 'apache', 'nginx', 'caddy',
  'mysqld', 'mariadbd', 'postgres', 'mongod', 'redis-server', 'memurai',
  'elasticsearch', 'rabbitmq-server', 'erl', 'beam.smp',
  'cargo', 'hugo', 'ngrok', 'cloudflared', 'esbuild',
  'docker', 'com.docker.backend', 'wslrelay',
];

export function buildDevSet(custom: readonly string[]): Set<string> {
  return new Set([...DEFAULT_DEV_PROCESSES, ...custom.map(stripExe)].map((s) => s.toLowerCase()));
}

export function isLoopback(addr: string): boolean {
  return addr.startsWith('127.') || addr === '::1' || addr.toLowerCase() === 'localhost';
}
