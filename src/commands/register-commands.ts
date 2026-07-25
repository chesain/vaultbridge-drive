import type { Command, Plugin } from "obsidian";

export interface CommandActions {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sync(): Promise<void>;
  preview(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  history(): Promise<void>;
  conflicts(): Promise<void>;
  recovery(): Promise<void>;
  validate(): Promise<void>;
  rebuild(): Promise<void>;
  exportPairing(): Promise<void>;
  importPairing(): Promise<void>;
  reauthenticate(): Promise<void>;
  forget(): Promise<void>;
  cancel(): void;
  diagnostics(): Promise<void>;
}

export function registerCommands(plugin: Plugin, actions: CommandActions): void {
  const commands: Array<
    Omit<Command, "callback" | "checkCallback" | "editorCallback" | "editorCheckCallback"> & {
      run: () => void;
    }
  > = [
    { id: "connect", name: "Connect Google Drive", run: () => void actions.connect() },
    { id: "disconnect", name: "Disconnect Google Drive", run: () => void actions.disconnect() },
    { id: "sync-now", name: "Sync now", run: () => void actions.sync() },
    { id: "preview-sync", name: "Preview sync", run: () => void actions.preview() },
    { id: "pause-auto-sync", name: "Pause auto-sync", run: () => void actions.pause() },
    { id: "resume-auto-sync", name: "Resume auto-sync", run: () => void actions.resume() },
    { id: "open-history", name: "Open sync history", run: () => void actions.history() },
    {
      id: "open-conflict-center",
      name: "Open conflict center",
      run: () => void actions.conflicts(),
    },
    {
      id: "open-recovery-center",
      name: "Open recovery center",
      run: () => void actions.recovery(),
    },
    { id: "validate-vault", name: "Validate vault", run: () => void actions.validate() },
    { id: "rebuild-index", name: "Rebuild local index", run: () => void actions.rebuild() },
    {
      id: "export-mobile-pairing",
      name: "Export encrypted mobile pairing bundle",
      run: () => void actions.exportPairing(),
    },
    {
      id: "import-mobile-pairing",
      name: "Import encrypted pairing bundle",
      run: () => void actions.importPairing(),
    },
    { id: "reauthenticate", name: "Reauthenticate", run: () => void actions.reauthenticate() },
    {
      id: "forget-credentials",
      name: "Forget local credentials",
      run: () => void actions.forget(),
    },
    { id: "cancel-sync", name: "Cancel current sync", run: () => actions.cancel() },
    {
      id: "copy-diagnostics",
      name: "Copy redacted diagnostics",
      run: () => void actions.diagnostics(),
    },
  ];
  for (const command of commands)
    plugin.addCommand({ id: command.id, name: command.name, callback: command.run });
}
