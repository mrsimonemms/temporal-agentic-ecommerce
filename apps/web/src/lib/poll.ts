export interface PollOptions<T> {
  intervalMs: number;
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
}

// Runs the task immediately, then again `intervalMs` after each run settles,
// so requests never overlap. Failures are reported and polling continues.
//
// The returned function stops polling and aborts any in-flight request. No
// callback runs after it is called, so a late response for a previous
// selection is never applied.
export function startPolling<T>(
  task: (signal: AbortSignal) => Promise<T>,
  { intervalMs, onSuccess, onError }: PollOptions<T>,
): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const run = async () => {
    try {
      const value = await task(controller.signal);
      if (!stopped) {
        onSuccess(value);
      }
    } catch (err) {
      if (!stopped) {
        onError(err);
      }
    }

    if (!stopped) {
      timer = setTimeout(run, intervalMs);
    }
  };

  void run();

  return () => {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
  };
}
