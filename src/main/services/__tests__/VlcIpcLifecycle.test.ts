import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../../../../packages/vlc/src/control/api', () => ({ VlcApi: class {} }));

import { destroyInstances, instances } from '../../../../packages/vlc/src/control/ipc';

describe('vlc IPC lifecycle', () => {
  afterEach(() => {
    instances.clear();
  });

  it('destroys and removes tracked instances', () => {
    const destroy = vi.fn();
    instances.set('player-1', { destroy } as any);

    destroyInstances(['player-1']);

    expect(destroy).toHaveBeenCalledOnce();
    expect(instances.has('player-1')).toBe(false);
  });

  it('removes an instance even when native destruction fails', () => {
    instances.set('player-1', {
      destroy: vi.fn(() => {
        throw new Error('native failure');
      }),
    } as any);

    expect(() => destroyInstances(['player-1'])).toThrow('native failure');
    expect(instances.has('player-1')).toBe(false);
  });
});
