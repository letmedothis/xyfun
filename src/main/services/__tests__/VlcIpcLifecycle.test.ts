import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  play: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => mocks.handlers.set(channel, handler)),
  },
}));
vi.mock('../../../../packages/vlc/src/control/api', () => ({
  VlcApi: class {
    constructor(private readonly id: string) {}

    create() {
      return this.id;
    }

    destroy() {}

    play() {
      mocks.play();
    }
  },
}));

import { VLC_IPC_CHANNEL } from '../../../../packages/vlc/src/constants/ipc';
import { destroyInstances, instanceOwners, instances, ipc } from '../../../../packages/vlc/src/control/ipc';

describe('vlc IPC lifecycle', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.play.mockClear();
    ipc();
  });

  afterEach(() => {
    instances.clear();
    instanceOwners.clear();
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

  it('rejects duplicate explicit instance ids', () => {
    const create = mocks.handlers.get(VLC_IPC_CHANNEL.VLC_CREATE)!;
    const event = { sender: { id: 1, on: vi.fn() } };

    expect(create(event, {}, {}, 'player-1')).toBe('player-1');
    expect(() => create(event, {}, {}, 'player-1')).toThrow('VLC instance already exists');
  });

  it('allows only the owner webContents to control an instance', () => {
    const create = mocks.handlers.get(VLC_IPC_CHANNEL.VLC_CREATE)!;
    const play = mocks.handlers.get(VLC_IPC_CHANNEL.VLC_PLAY)!;
    const owner = { sender: { id: 1, on: vi.fn() } };

    create(owner, {}, {}, 'player-1');
    play({ sender: { id: 2 } }, 'player-1');
    expect(mocks.play).not.toHaveBeenCalled();

    play(owner, 'player-1');
    expect(mocks.play).toHaveBeenCalledOnce();
  });
});
