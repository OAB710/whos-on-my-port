// "Show Ports Reserved by Windows": an untitled Markdown document that lists the excluded
// port ranges and explains the fixes. Nothing here runs a fix command.
import * as vscode from 'vscode';
import type { PortService } from '../core/portService';
import { formatRange, isReserved } from '../core/reservedPorts';
import type { PortRange } from '../types';

const t = vscode.l10n.t;

/** Reserved ranges from the provider, or [] when unsupported / failing. */
export async function reservedRanges(service: PortService): Promise<PortRange[]> {
  try {
    return (await service.provider.reservedPortRanges?.()) ?? [];
  } catch {
    return [];
  }
}

/** The reserved range containing `port`, fetched lazily (cached by the provider). */
export async function reservedRangeOf(service: PortService, port: number): Promise<PortRange | undefined> {
  return isReserved(port, await reservedRanges(service));
}

export function reservedMessage(port: number, r: PortRange): string {
  return t('Port {0} is reserved by Windows (Hyper-V/WSL range {1})', port, formatRange(r));
}

export function buildReservedPortsMarkdown(ranges: PortRange[], focusPort?: number): string {
  const lines: string[] = [`# ${t('Ports reserved by Windows')}`, ''];
  const hit = focusPort !== undefined ? isReserved(focusPort, ranges) : undefined;
  if (focusPort !== undefined && hit) lines.push(`> **${reservedMessage(focusPort, hit)}**`, '');

  lines.push(
    t('Windows reserves blocks of TCP ports for Hyper-V, WSL 2, Docker Desktop and WinNAT. A program that tries to listen on a port inside such a block fails with **EACCES** / **WinError 10013** ("An attempt was made to access a socket in a way forbidden by its access permissions"), even though no process is using the port.'),
    '',
    `## ${t('Reserved TCP ranges right now')}`,
    '',
  );
  if (ranges.length === 0) {
    lines.push(t('No reserved ranges were reported.'), '');
  } else {
    lines.push(`| ${t('Start')} | ${t('End')} | ${t('Ports')} | ${t('Administered')} |`, '| ---: | ---: | ---: | :---: |');
    for (const r of ranges) {
      const mark = r === hit ? ' ⬅' : '';
      lines.push(`| ${r.start} | ${r.end}${mark} | ${r.end - r.start + 1} | ${r.administered ? '*' : ''} |`);
    }
    lines.push('', t('"Administered" (*) ranges were added on purpose (for example by the second fix below) and survive reboots.'), '');
  }
  lines.push(
    t('Source: `netsh interface ipv4 show excludedportrange protocol=tcp` (and ipv6).'),
    '',
    `## ${t('How to fix')}`,
    '',
    t('Run these yourself in a terminal opened **as Administrator**. This extension never runs them for you.'),
    '',
    `### 1. ${t('Restart WinNAT (quick, frees the dynamic reservations)')}`,
    '',
    '```powershell',
    'net stop winnat',
    'net start winnat',
    '```',
    '',
    t('Docker Desktop / WSL may need to be restarted afterwards. Windows can pick new ranges again later.'),
    '',
    `### 2. ${t('Reserve your dev port permanently')}`,
    '',
    t('Add an exclusion for your own port so Hyper-V can never take it (WinNAT must be stopped while you add it):'),
    '',
    '```powershell',
    'net stop winnat',
    `netsh int ipv4 add excludedportrange protocol=tcp startport=${focusPort ?? 3000} numberofports=1`,
    'net start winnat',
    '```',
    '',
    `### 3. ${t('Move the dynamic port range out of the way')}`,
    '',
    t('Hyper-V reserves ports from the dynamic range. Moving it to the IANA default keeps the usual dev ports (3000, 5000, 8000, 8080…) free. A reboot is recommended.'),
    '',
    '```powershell',
    'netsh int ipv4 set dynamic tcp start=49152 num=16384',
    'netsh int ipv6 set dynamic tcp start=49152 num=16384',
    '```',
    '',
    t('Or simply use a port outside every range listed above.'),
    '',
  );
  return lines.join('\n');
}

export async function showReservedPortsDocument(service: PortService, focusPort?: number): Promise<void> {
  const ranges = await reservedRanges(service);
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: buildReservedPortsMarkdown(ranges, focusPort) });
  await vscode.window.showTextDocument(doc, { preview: true });
}
