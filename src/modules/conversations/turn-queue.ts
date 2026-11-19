const queues = new Map<string, Promise<void>>();

/**
 * Runs `task` after every earlier task with the same key has finished (or after `maxWaitMs`, so a
 * stuck one can't block the queue forever). Skips the task if `signal` aborts while waiting.
 * `waited` tells the task whether it queued behind another, i.e. whether state may have changed.
 */
export async function runSerialized(
  key: string,
  signal: AbortSignal,
  task: (waited: boolean) => Promise<void>,
  maxWaitMs = 45_000,
): Promise<void> {
  const earlier = queues.get(key);
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  const chained = (earlier ?? Promise.resolve()).then(() => mine);
  queues.set(key, chained);
  try {
    if (earlier) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        earlier,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, maxWaitMs);
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
      ]);
      clearTimeout(timer);
    }
    if (signal.aborted) return;
    await task(Boolean(earlier));
  } finally {
    release();
    if (queues.get(key) === chained) queues.delete(key);
  }
}
