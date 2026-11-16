// "Test on phone": LAN URL + QR code for servers reachable from the network.
import * as os from 'node:os';
import * as vscode from 'vscode';
import { lanUrls, type LanUrl } from '../core/lanUrl';
import { qrSvg } from '../core/qrSvg';
import type { PortEntry } from '../types';

const t = vscode.l10n.t;

export function entryLanUrls(e: PortEntry): LanUrl[] {
  if (!e.lanExposed) return [];
  try {
    return lanUrls(e.port, e.addresses, os.networkInterfaces());
  } catch {
    return [];
  }
}

/** One URL, or a QuickPick when the machine has several LAN addresses. */
async function pickLanUrl(e: PortEntry, title: string): Promise<LanUrl | undefined> {
  const urls = entryLanUrls(e);
  if (urls.length === 0) {
    vscode.window.setStatusBarMessage(`$(warning) ${t('No LAN address found for :{0}.', e.port)}`, 4000);
    return undefined;
  }
  if (urls.length === 1) return urls[0];
  const picked = await vscode.window.showQuickPick(
    urls.map((u) => ({
      label: u.url,
      description: u.iface,
      detail: u.virtual ? t('Virtual adapter (WSL / Hyper-V / VM) — usually not reachable from a phone') : undefined,
      u,
    })),
    { title, placeHolder: t('Pick the address your phone can reach (same Wi-Fi)') },
  );
  return picked?.u;
}

export async function copyLanUrl(e: PortEntry): Promise<void> {
  const u = await pickLanUrl(e, t('Copy LAN URL'));
  if (!u) return;
  await vscode.env.clipboard.writeText(u.url);
  vscode.window.setStatusBarMessage(`$(check) ${t('Copied {0}', u.url)}`, 2500);
}

export async function showQrCode(e: PortEntry, storage: vscode.Uri): Promise<void> {
  const u = await pickLanUrl(e, t('Show QR Code for Phone'));
  if (!u) return;
  const dir = vscode.Uri.joinPath(storage, 'qr');
  const file = vscode.Uri.joinPath(dir, `${e.port}.svg`);
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(file, Buffer.from(qrSvg(u.url, u.url), 'utf8'));
  // Prefer the built-in image preview; fall back to whatever editor handles .svg.
  try {
    await vscode.commands.executeCommand('vscode.openWith', file, 'imagePreview.previewEditor');
  } catch {
    await vscode.commands.executeCommand('vscode.open', file);
  }
  vscode.window.setStatusBarMessage(`$(device-mobile) ${t('Scan to open {0} on your phone (same network; the firewall must allow it)', u.url)}`, 5000);
}
