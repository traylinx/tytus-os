export interface LauncherEditor {
  binary: string;
  name: string;
}

export interface Launchers {
  editors: LauncherEditor[];
  terminal_available: boolean;
}
