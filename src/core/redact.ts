// Removes secrets from a command line before it is stored in Port History
// (no 'vscode' import; unit-tested). Redacted values become "***".

export const REDACTED = '***';

/** Env-var names that look secret. */
const SECRET_NAME = /key|token|secret|password|passwd|pwd|auth/i;
/** CLI flag names that look secret (`-p` / `--port` are NOT secret). */
const SECRET_FLAG = /token|password|passwd|secret|key/i;
/** …unless the flag points at a file (`--key-file ./dev.pem`). */
const FILE_FLAG = /file|path|dir/i;

const QUOTED = `"(?:[^"\\\\]|\\\\.)*"|'[^']*'`;

function mask(value: string): string {
  if (!value) return value;
  const q = value[0];
  if ((q === '"' || q === "'") && value.length >= 2 && value.endsWith(q)) return `${q}${REDACTED}${q}`;
  return REDACTED;
}

export function redactCommand(command: string): string {
  let s = command;

  // PowerShell: $env:API_TOKEN = "x"
  s = s.replace(new RegExp(`(\\$env:([A-Za-z_][\\w]*)\\s*=\\s*)(${QUOTED}|[^\\s;|&]+)`, 'gi'), (m, pre: string, name: string, value: string) =>
    SECRET_NAME.test(name) ? pre + mask(value) : m,
  );

  // cmd.exe: set "PASSWORD=x" / set PASSWORD=x&&npm start
  s = s.replace(/(\bset\s+")([A-Za-z_]\w*)=([^"]*)"/gi, (m, pre: string, name: string) =>
    SECRET_NAME.test(name) ? `${pre}${name}=${REDACTED}"` : m,
  );
  s = s.replace(/(\bset\s+)([A-Za-z_]\w*)=([^&"\r\n]*?)(\s*(?:&|$))/gi, (m, pre: string, name: string, value: string, tail: string) =>
    SECRET_NAME.test(name) && value ? `${pre}${name}=${REDACTED}${tail}` : m,
  );

  // POSIX / cross-env / export: API_KEY=abc npm run dev
  s = s.replace(new RegExp(`(^|[\\s;&|(])([A-Za-z_][\\w]*)=(${QUOTED}|[^\\s;&|]*)`, 'g'), (m, pre: string, name: string, value: string) =>
    SECRET_NAME.test(name) && value && value !== REDACTED ? `${pre}${name}=${mask(value)}` : m,
  );

  // CLI flags: --token x, --password=x, --api-key "x"
  s = s.replace(new RegExp(`(^|\\s)(--?[A-Za-z][\\w-]*)(=|\\s+)(?!-)(${QUOTED}|[^\\s"']+)`, 'g'), (m, pre: string, flag: string, sep: string, value: string) =>
    SECRET_FLAG.test(flag) && !FILE_FLAG.test(flag) && value !== REDACTED ? `${pre}${flag}${sep}${mask(value)}` : m,
  );

  // Token-looking strings anywhere.
  s = s
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED)
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED)
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED)
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED)
    // Credentials inside URLs: postgres://user:pass@host
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${REDACTED}@`);
  return s;
}

export function isRedacted(command: string): boolean {
  return command.includes(REDACTED);
}
