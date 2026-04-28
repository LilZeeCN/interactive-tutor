/**
 * Track background async tasks (e.g. AI generation) so the server
 * can wait for them during graceful shutdown.
 */

let activeTasks = new Map<string, Promise<void>>();
let taskIdCounter = 0;

export function trackTask(promise: Promise<void>, label?: string): Promise<void> {
  const id = `task-${++taskIdCounter}`;
  const wrapped = promise.finally(() => {
    activeTasks.delete(id);
  });
  activeTasks.set(id, wrapped);
  return wrapped;
}

/**
 * Wait for all tracked background tasks to finish (or reject).
 * Called during graceful shutdown with a timeout.
 */
export async function drainTasks(timeoutMs: number = 30_000): Promise<void> {
  if (activeTasks.size === 0) return;

  console.log(`[shutdown] Waiting for ${activeTasks.size} background tasks to finish...`);

  const promises = Array.from(activeTasks.values());
  const results = await Promise.allSettled(promises);

  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) {
    console.warn(`[shutdown] ${failed}/${results.length} tasks rejected during drain`);
  }
  console.log('[shutdown] All background tasks drained');
}

export function activeTaskCount(): number {
  return activeTasks.size;
}
