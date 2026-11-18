/**
 * Deferred wafer-strip commits (`redesign.md` §5.8, §5.10).
 *
 * Keyboard stepping in the wafer strip paints the stage imperatively and commits
 * `activeWaferIndex` to the selection store a little later. Any action that reads
 * `activeWaferIndex` (for example a finding click) calls `flushPendingWaferCommits()`
 * first, so the pending commit lands in the same batched React render as that action
 * instead of in a separate render inside the same frame.
 */
const pendingFlushers = new Set<() => void>();

export function registerPendingWaferCommit(flush: () => void): () => void {
  pendingFlushers.add(flush);
  return () => {
    pendingFlushers.delete(flush);
  };
}

export function flushPendingWaferCommits(): void {
  for (const flush of pendingFlushers) {
    flush();
  }
}
