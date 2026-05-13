import type { NormalizedLogEntry } from '../../schemas/osLog.js';

export interface WindowsSpawnArgs {
  identifier: string;
  productName: string;
  since?: string;
}

/**
 * Windows os-logs support is not implemented in v0.7. The plan is to wrap
 * `wevtutil qe Application` and `Get-WinEvent -FilterHashtable` once we have
 * a Windows test target. Until then, callers receive a clear error rather
 * than silent zero output.
 */
export function buildArgs(_args: WindowsSpawnArgs): string[] {
  throw new Error(
    'os-logs is not yet implemented on Windows. ' +
      'Track the gap in the CHANGELOG or use `tauri-agent-tools forensics --since <duration>` ' +
      'against the app log directory directly.',
  );
}

export function parseLine(_line: string): NormalizedLogEntry | null {
  return null;
}

export const COMMAND = 'wevtutil';
