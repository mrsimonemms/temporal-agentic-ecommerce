import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startPolling } from './poll';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startPolling', () => {
  it('runs immediately and then after each interval', async () => {
    const task = vi.fn().mockResolvedValue('ok');
    const onSuccess = vi.fn();

    const stop = startPolling(task, { intervalMs: 1000, onSuccess, onError: vi.fn() });

    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith('ok');

    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);

    stop();
  });

  it('does not start another request while one is in flight', async () => {
    const pending = deferred<string>();
    const task = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue('later');

    const stop = startPolling(task, { intervalMs: 1000, onSuccess: vi.fn(), onError: vi.fn() });

    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(1);

    pending.resolve('slow');
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    // The next request is scheduled an interval after the previous one settles
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);

    stop();
  });

  it('reports failures and keeps polling', async () => {
    const task = vi
      .fn()
      .mockRejectedValueOnce(new Error('API unavailable'))
      .mockResolvedValueOnce('recovered');
    const onSuccess = vi.fn();
    const onError = vi.fn();

    const stop = startPolling(task, { intervalMs: 1000, onSuccess, onError });

    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(new Error('API unavailable'));
    expect(onSuccess).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onSuccess).toHaveBeenCalledWith('recovered');

    stop();
  });

  it('stops polling and discards a response that arrives after stopping', async () => {
    const pending = deferred<string>();
    let signal: AbortSignal | undefined;
    const task = vi.fn((s: AbortSignal) => {
      signal = s;
      return pending.promise;
    });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    const stop = startPolling(task, { intervalMs: 1000, onSuccess, onError });
    stop();

    expect(signal?.aborted).toBe(true);

    pending.resolve('stale');
    await vi.advanceTimersByTimeAsync(5000);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('does not report the abort error caused by stopping', async () => {
    const pending = deferred<string>();
    const onError = vi.fn();

    const stop = startPolling(() => pending.promise, {
      intervalMs: 1000,
      onSuccess: vi.fn(),
      onError,
    });
    stop();

    pending.reject(new DOMException('Aborted', 'AbortError'));
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).not.toHaveBeenCalled();
  });
});
