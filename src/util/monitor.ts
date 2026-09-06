/** Signal-aware polling with a final sample, including durations below interval. */
export async function monitorFor(
  opts: { interval: number; duration?: number },
  sample: () => Promise<void>,
): Promise<void> {
  const deadline = opts.duration === undefined ? Infinity : Date.now() + opts.duration;
  let stopped = false;
  let wake: (() => void) | undefined;
  const stop = (): void => { stopped = true; wake?.(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    do {
      if (!stopped) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, Math.max(0, Math.min(opts.interval, deadline - Date.now())));
          wake = () => { clearTimeout(timer); resolve(); };
        });
        wake = undefined;
      }
      await sample();
    } while (!stopped && Date.now() < deadline);
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
