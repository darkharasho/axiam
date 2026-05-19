/**
 * Single-slot async mutex with a FIFO queue.
 *
 * Each call to `acquire()` returns a Promise that resolves with a `release`
 * function when the previous holder (if any) has called release. Calls resolve
 * in FIFO order.
 *
 * Usage:
 *   const release = await launchSerializer.acquire();
 *   try {
 *     // do mutually-exclusive work
 *   } finally {
 *     release();
 *   }
 *
 * Uncontended `acquire()` resolves on the next microtask (the chain head is
 * `Promise.resolve()`), so the common single-launch path adds negligible
 * overhead.
 */
let chain: Promise<void> = Promise.resolve();

export async function acquire(): Promise<() => void> {
  let release: () => void = () => {};
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waitFor = chain;
  chain = next;
  await waitFor;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
  };
}

/**
 * Test helper: reset the internal chain. Tests should call this in beforeEach
 * so a leftover unreleased acquire from one test doesn't deadlock the next.
 * Not exported for production use.
 */
export function __resetForTests(): void {
  chain = Promise.resolve();
}
