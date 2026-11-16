// Remembers the last command executed in each terminal of this window (Shell Integration API)
// and tracks when executions end. Shared by Kill & Retry and Restart; it never reads output streams.
import * as vscode from 'vscode';

export interface TrackedCommand {
  commandLine: string;
  cwd?: string;
  execution: vscode.TerminalShellExecution;
  startedAt: number;
}

export class CommandTracker implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly last = new WeakMap<vscode.Terminal, TrackedCommand>();
  private readonly ended = new WeakSet<vscode.TerminalShellExecution>();
  private readonly startEmitter = new vscode.EventEmitter<vscode.TerminalShellExecutionStartEvent>();
  private readonly endEmitter = new vscode.EventEmitter<vscode.TerminalShellExecutionEndEvent>();
  /** Fires after the start has been recorded. */
  readonly onDidStart = this.startEmitter.event;
  readonly onDidEnd = this.endEmitter.event;

  constructor() {
    this.disposables.push(
      this.startEmitter,
      this.endEmitter,
      vscode.window.onDidStartTerminalShellExecution((e) => {
        const value = e.execution.commandLine.value.trim();
        // Low confidence = guessed from the prompt; not safe to re-run.
        if (value && e.execution.commandLine.confidence !== vscode.TerminalShellExecutionCommandLineConfidence.Low) {
          this.last.set(e.terminal, {
            commandLine: value,
            cwd: e.execution.cwd?.fsPath,
            execution: e.execution,
            startedAt: Date.now(),
          });
        }
        this.startEmitter.fire(e);
      }),
      vscode.window.onDidEndTerminalShellExecution((e) => {
        this.ended.add(e.execution);
        this.endEmitter.fire(e);
      }),
    );
  }

  /** Last command run in this terminal since the extension started, if known. */
  lastCommand(terminal: vscode.Terminal | undefined): TrackedCommand | undefined {
    return terminal ? this.last.get(terminal) : undefined;
  }

  isEnded(execution: vscode.TerminalShellExecution): boolean {
    return this.ended.has(execution);
  }

  /** Resolves true once the execution has ended, false after `timeoutMs`. */
  waitForEnd(execution: vscode.TerminalShellExecution, timeoutMs: number): Promise<boolean> {
    if (this.ended.has(execution)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        sub.dispose();
        resolve(this.ended.has(execution));
      }, timeoutMs);
      const sub = this.endEmitter.event((e) => {
        if (e.execution !== execution) return;
        clearTimeout(timer);
        sub.dispose();
        resolve(true);
      });
    });
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
