// "Check / Find Free Port…": type a port to see whether it is free, who holds it, or whether
// Windows reserved it — and get the nearest free port. QuickPick only, no popups.
import * as vscode from 'vscode';
import { COMMON_DEV_PORTS, nearestFreePort, parsePortInput, portStatus } from '../core/freePort';
import type { Killer } from '../core/killer';
import type { PortService } from '../core/portService';
import { formatRange } from '../core/reservedPorts';
import type { PortEntry, PortRange } from '../types';
import { reservedRanges, showReservedPortsDocument } from './reservedPorts';

const t = vscode.l10n.t;

type Action =
  | { kind: 'copy'; port: number }
  | { kind: 'kill'; entry: PortEntry }
  | { kind: 'reserved'; port: number }
  | { kind: 'none' };

type Item = vscode.QuickPickItem & { action: Action };

function holderText(e: PortEntry | undefined): string {
  if (!e) return t('in use');
  const name = (e.proc?.name ?? t('unknown')).replace(/\.exe$/i, '');
  return [name, `PID ${e.pid}`, e.projectName].filter(Boolean).join(' · ');
}

export async function findFreePort(service: PortService, killer: Killer, arg?: number | string): Promise<void> {
  const qp = vscode.window.createQuickPick<Item>();
  qp.title = t('Check / Find Free Port');
  qp.placeholder = t('Type a port number to check it, or pick a suggestion');
  qp.value = arg !== undefined ? String(arg) : '';
  qp.busy = true;

  let busy = new Set<number>();
  let reserved: PortRange[] = [];
  let entries: readonly PortEntry[] = service.state.entries;

  const item = (label: string, description: string | undefined, action: Action, detail?: string): Item => ({
    label,
    description,
    detail,
    action,
    alwaysShow: true, // results depend on the typed number, not on fuzzy label matching
  });

  const next = (from: number) => nearestFreePort(from, busy, reserved);

  const render = () => {
    const port = parsePortInput(qp.value);
    const items: Item[] = [];

    if (port !== undefined) {
      const s = portStatus(port, busy, reserved);
      if (s.kind === 'free') {
        items.push(item(`$(pass-filled) :${port} ${t('is free')}`, t('Enter = copy'), { kind: 'copy', port }));
      } else {
        if (s.kind === 'busy') {
          const holder = entries.find((e) => e.port === port);
          items.push(item(`$(circle-filled) :${port} ${t('is in use')}`, holderText(holder), { kind: 'none' }));
          if (holder && !holder.blocked) {
            items.push(item(`$(debug-stop) ${t('Stop {0}', holderText(holder))}`, undefined, { kind: 'kill', entry: holder }));
          }
        } else if (s.kind === 'reserved') {
          items.push(
            item(`$(lock) :${port} ${t('is reserved by Windows')}`, t('range {0}', formatRange(s.range)), { kind: 'reserved', port },
              t('Hyper-V / WSL keep this range; servers get EACCES here. Enter = how to fix')),
          );
        }
        const free = next(port);
        if (free !== undefined) {
          items.push(item(`$(arrow-right) ${t('Use :{0} instead', free)}`, t('nearest free port · Enter = copy'), { kind: 'copy', port: free }));
        }
      }
    } else {
      if (qp.value.trim()) items.push(item(`$(warning) ${t('Enter a number between 1 and 65535')}`, undefined, { kind: 'none' }));
      items.push({ label: t('Common dev ports'), kind: vscode.QuickPickItemKind.Separator, action: { kind: 'none' } });
      for (const p of COMMON_DEV_PORTS) {
        const s = portStatus(p, busy, reserved);
        if (s.kind === 'free') {
          items.push(item(`$(pass-filled) :${p}`, t('free · Enter = copy'), { kind: 'copy', port: p }));
        } else {
          const free = next(p);
          const why = s.kind === 'busy' ? holderText(entries.find((e) => e.port === p)) : t('reserved by Windows');
          items.push(
            item(`$(circle-filled) :${p}`, free !== undefined ? `${why} · ${t('next free :{0}', free)}` : why,
              free !== undefined ? { kind: 'copy', port: free } : { kind: 'none' }),
          );
        }
      }
    }
    qp.items = items;
  };

  const subs: vscode.Disposable[] = [qp.onDidChangeValue(render)];
  const closed = new Promise<void>((resolve) => subs.push(qp.onDidHide(() => resolve())));
  subs.push(
    qp.onDidAccept(async () => {
      const a = qp.selectedItems[0]?.action;
      if (!a || a.kind === 'none') return;
      qp.hide();
      if (a.kind === 'copy') {
        await vscode.env.clipboard.writeText(String(a.port));
        vscode.window.setStatusBarMessage(`$(check) ${t('Port {0} is free — copied', a.port)}`, 3000);
      } else if (a.kind === 'kill') {
        await killer.kill(a.entry);
      } else if (a.kind === 'reserved') {
        await showReservedPortsDocument(service, a.port);
      }
    }),
  );

  render();
  qp.show();

  // Cheap data first (netstat + cached reserved ranges), process details from a full scan after.
  try {
    const [sockets, ranges] = await Promise.all([service.provider.listeningSockets(), reservedRanges(service)]);
    busy = new Set(sockets.map((s) => s.port));
    reserved = ranges;
    render();
    entries = (await service.scan()).entries;
    render();
  } catch {
    /* keep whatever we have */
  } finally {
    qp.busy = false;
  }

  await closed;
  subs.forEach((d) => d.dispose());
  qp.dispose();
}
