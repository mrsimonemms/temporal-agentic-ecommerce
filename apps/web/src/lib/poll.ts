export interface PollOptions<T> {
  intervalMs: number;
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
  // Stops polling once the value will not change again, such as a finished
  // Workflow. Defaults to polling indefinitely.
  isFinal?: (value: T) => boolean;
  // Stops polling after an error that retrying cannot fix, such as an unknown
  // ID. Defaults to retrying every error.
  isPermanent?: (error: unknown) => boolean;
}

// Runs the task immediately, then again `intervalMs` after each run settles,
// so requests never overlap. Failures are reported and polling continues
// unless the failure is permanent or the value is final.
//
// The returned function stops polling and aborts any in-flight request. No
// callback runs after it is called, so a late response for a previous
// selection is never applied.
export function startPolling<T>(
  task: (signal: AbortSignal) => Promise<T>,
  { intervalMs, onSuccess, onError, isFinal, isPermanent }: PollOptions<T>,
): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const run = async () => {
    let finished = false;
    try {
      const value = await task(controller.signal);
      if (!stopped) {
        onSuccess(value);
        finished = isFinal?.(value) ?? false;
      }
    } catch (err) {
      if (!stopped) {
        onError(err);
        finished = isPermanent?.(err) ?? false;
      }
    }

    if (!stopped && !finished) {
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
