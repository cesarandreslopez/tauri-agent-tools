import { CliError } from '../errors.js';

/** Each request and sleep consumes the same overall time budget. */
export async function pollUntil<T>(
  attempt: (remainingMs: number) => Promise<T | null>,
  timeoutMs: number,
  intervalMs: number,
  message: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        attempt(remaining),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new CliError('TIMEOUT', message, 'Check the target and its readiness.')), remaining);
        }),
      ]);
      if (result !== null) return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const sleep = Math.min(intervalMs, deadline - Date.now());
    if (sleep > 0) await new Promise(resolve => setTimeout(resolve, sleep));
  }
  throw new CliError('TIMEOUT', message, 'Check the target and its readiness.');
}
