/** Resolves with `work`'s result, but not sooner than `ms`, so a "Saving…" state is actually seen on fast saves. */
export function visibleProgress<T>(work: Promise<T>, ms = 600): Promise<T> {
  return Promise.all([work, new Promise(resolve => setTimeout(resolve, ms))]).then(([result]) => result);
}
