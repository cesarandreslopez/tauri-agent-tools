export class CliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly hint: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function errorDetail(error: unknown): { code: string; message: string; hint: string } {
  if (error instanceof CliError) return { code: error.code, message: error.message, hint: error.hint };
  const message = error instanceof Error ? error.message : String(error);
  if (/authenticat|Unauthorized/i.test(message)) {
    return { code: 'AUTH_FAILED', message, hint: 'Check the target --port and --token, or rediscover it with probe.' };
  }
  if (/timeout|timed out/i.test(message)) {
    return { code: 'TIMEOUT', message, hint: 'Check app responsiveness with probe and verify the requested timeout.' };
  }
  if (/No bridge|fetch failed|ECONNREFUSED/i.test(message)) {
    return { code: 'BRIDGE_UNAVAILABLE', message, hint: 'Run probe and select the running dev app with --pid.' };
  }
  return { code: 'COMMAND_FAILED', message, hint: 'Run this command with --help to check its arguments and prerequisites.' };
}
