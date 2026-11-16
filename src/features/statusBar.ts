import * as vscode from 'vscode';
import { cfg, type PortService } from '../core/portService';

const t = vscode.l10n.t;

export class PortStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('whosOnMyPort.status', vscode.StatusBarAlignment.Left, -100);
  private readonly sub: vscode.Disposable;

  constructor(service: PortService) {
    this.item.name = "Who's On My Port";
    this.item.command = 'whosOnMyPort.ports.focus';
    this.sub = service.onDidChange((s) => {
      const current = s.entries.filter((e) => e.group === 'current').length;
      const other = s.entries.filter((e) => e.group === 'other').length;
      const orphan = s.entries.filter((e) => e.group === 'orphan').length;
      this.item.text = current ? `$(plug) ${current}` : '$(plug)';
      this.item.tooltip = [
        t('{0} port(s) in this workspace', current),
        t('{0} in other projects', other),
        orphan ? t('{0} orphaned — click to review', orphan) : '',
      ].filter(Boolean).join('\n');
      this.item.backgroundColor = orphan ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
      this.item.accessibilityInformation = { label: t('{0} port(s) in this workspace', current) };
    });
    this.item.text = '$(plug)';
    this.applyVisibility();
  }

  applyVisibility(): void {
    if (cfg().showStatusBar) this.item.show();
    else this.item.hide();
  }

  dispose(): void {
    this.sub.dispose();
    this.item.dispose();
  }
}
