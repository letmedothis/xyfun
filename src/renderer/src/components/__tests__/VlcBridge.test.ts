import { afterEach, describe, expect, it, vi } from 'vitest';

import { VLC_IPC_CHANNEL } from '../../../../../packages/vlc/src/constants/ipc';
import { createBridge } from '../../../../../packages/vlc/src/renderer/bridge';

describe('vlc renderer bridge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches metric polling and does not overlap slow requests', async () => {
    vi.useFakeTimers();
    let resolveMetrics!: (value: unknown) => void;
    const pendingMetrics = new Promise((resolve) => {
      resolveMetrics = resolve;
    });
    const invoke = vi.fn((channel: string) => {
      if (channel === VLC_IPC_CHANNEL.VLC_CREATE) return Promise.resolve('player-1');
      if (channel === VLC_IPC_CHANNEL.VLC_GET_METRICS) return pendingMetrics;
      return Promise.resolve();
    });
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn() } },
    });

    const bridge = createBridge({ libPath: '/mock/libvlc' }, { el: '#player', url: 'video.mp4' });
    await bridge.create('#player');

    await vi.advanceTimersByTimeAsync(1000);
    expect(invoke.mock.calls.filter(([channel]) => channel === VLC_IPC_CHANNEL.VLC_GET_METRICS)).toHaveLength(1);

    resolveMetrics({ buffered: 5, duration: 10, muted: false, playbackRate: 1, played: 2, progress: 0.2, volume: 0.7 });
    await vi.advanceTimersByTimeAsync(250);
    expect(invoke.mock.calls.filter(([channel]) => channel === VLC_IPC_CHANNEL.VLC_GET_METRICS)).toHaveLength(2);

    await bridge.destroy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(invoke.mock.calls.filter(([channel]) => channel === VLC_IPC_CHANNEL.VLC_GET_METRICS)).toHaveLength(2);
  });
});
