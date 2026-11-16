// LAN URLs for "Test on phone". Pure, no 'vscode' import: interfaces are passed in
// (shape of os.networkInterfaces()).
export interface NetIf {
  address: string;
  /** 'IPv4' / 'IPv6' (Node 18.4+) or 4 / 6 (older Node). */
  family: string | number;
  internal: boolean;
}

export type NetIfMap = Record<string, NetIf[] | undefined>;

export interface LanAddress {
  address: string;
  /** Adapter name, e.g. "Wi-Fi", "Ethernet", "vEthernet (WSL)". */
  iface: string;
  /** Hyper-V / WSL / Docker / VM adapter: phones usually cannot reach it. */
  virtual: boolean;
}

const VIRTUAL_RE = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|vboxnet|Loopback Pseudo/i;
const WILDCARD = new Set(['0.0.0.0', '::', '*', '[::]']);

function isIPv4(i: NetIf): boolean {
  return i.family === 'IPv4' || i.family === 4;
}

function isUsableIPv4(addr: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(addr) && !addr.startsWith('127.') && !addr.startsWith('169.254.') && addr !== '0.0.0.0';
}

/** Non-internal IPv4 addresses, physical adapters first (stable order otherwise). */
export function lanAddresses(ifaces: NetIfMap): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const i of list ?? []) {
      if (i.internal || !isIPv4(i) || !isUsableIPv4(i.address)) continue;
      out.push({ address: i.address, iface: name, virtual: VIRTUAL_RE.test(name) });
    }
  }
  return out.map((a, idx) => ({ a, idx })).sort((x, y) => Number(x.a.virtual) - Number(y.a.virtual) || x.idx - y.idx).map((x) => x.a);
}

export interface LanUrl {
  url: string;
  address: string;
  /** Adapter name when known (wildcard binds). */
  iface?: string;
  virtual: boolean;
}

/**
 * URLs a phone on the same network could open for a listener bound to `bound`.
 * Specific non-loopback IPv4 binds are used as-is; wildcard binds (0.0.0.0 / ::) expand to
 * every LAN IPv4 of this machine. Loopback-only listeners yield nothing.
 */
export function lanUrls(port: number, bound: readonly string[], ifaces: NetIfMap): LanUrl[] {
  const seen = new Set<string>();
  const out: LanUrl[] = [];
  const add = (u: LanUrl) => {
    if (seen.has(u.address)) return;
    seen.add(u.address);
    out.push(u);
  };
  const known = lanAddresses(ifaces);
  for (const b of bound) {
    if (isUsableIPv4(b)) {
      const k = known.find((a) => a.address === b);
      add({ url: `http://${b}:${port}`, address: b, iface: k?.iface, virtual: k?.virtual ?? false });
    }
  }
  if (bound.some((b) => WILDCARD.has(b))) {
    for (const a of known) add({ url: `http://${a.address}:${port}`, address: a.address, iface: a.iface, virtual: a.virtual });
  }
  // Physical adapters first, even when a specific bind came first.
  return out.map((u, idx) => ({ u, idx })).sort((x, y) => Number(x.u.virtual) - Number(y.u.virtual) || x.idx - y.idx).map((x) => x.u);
}
