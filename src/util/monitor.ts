/** Own signal handlers for the entire collector, including setup and cleanup. */
export function createSignalScope(): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const interrupt = (): void => controller.abort('SIGINT');
  const terminate = (): void => controller.abort('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  return {
    signal: controller.signal,
    dispose: () => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    },
  };
}

/** Signal-aware polling with a final sample, including durations below interval. */
export async function monitorFor(
  opts: { interval: number; duration?: number; signal?: AbortSignal },
  sample: () => Promise<void>,
): Promise<'completed' | 'interrupted'> {
  const deadline = opts.duration === undefined ? Infinity : Date.now() + opts.duration;
  const ownedScope = opts.signal ? undefined : createSignalScope();
  const signal = opts.signal ?? ownedScope!.signal;
  try {
    do {
      if (!signal.aborted) {
        await new Promise<void>(resolve => {
          const finish = (): void => {
            clearTimeout(timer);
            signal.removeEventListener('abort', finish);
            resolve();
          };
          const timer = setTimeout(finish, Math.max(0, Math.min(opts.interval, deadline - Date.now())));
          signal.addEventListener('abort', finish, { once: true });
        });
      }
      await sample();
    } while (!signal.aborted && Date.now() < deadline);
    return signal.aborted ? 'interrupted' : 'completed';
  } finally {
    ownedScope?.dispose();
  }
}
