import { describe, it, expect, beforeEach } from 'vitest';
import { acquire, __resetForTests } from './launchSerializer.js';

describe('launchSerializer', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('uncontended acquire resolves on the next microtask', async () => {
    const release = await acquire();
    expect(typeof release).toBe('function');
    release();
  });

  it('queued acquires resolve in FIFO order', async () => {
    const order: string[] = [];
    const first = await acquire();

    // Don't release first yet — queue two more behind it.
    const secondPending = acquire().then((release) => {
      order.push('second');
      release();
    });
    const thirdPending = acquire().then((release) => {
      order.push('third');
      release();
    });

    // Neither has resolved yet because first is still held.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([]);

    first();
    await secondPending;
    await thirdPending;
    expect(order).toEqual(['second', 'third']);
  });

  it('release is idempotent within a single acquire', async () => {
    const release = await acquire();
    // Call release twice; the second call should be a no-op.
    release();
    release();
    // The next acquire should still resolve normally.
    const nextRelease = await acquire();
    expect(typeof nextRelease).toBe('function');
    nextRelease();
  });

  it('multiple queued acquires after release all run in order', async () => {
    const order: number[] = [];
    const acquires = [1, 2, 3, 4].map((n) =>
      acquire().then((release) => {
        order.push(n);
        release();
      }),
    );
    await Promise.all(acquires);
    expect(order).toEqual([1, 2, 3, 4]);
  });
});
