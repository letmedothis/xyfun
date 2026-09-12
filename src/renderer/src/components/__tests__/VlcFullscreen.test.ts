import { describe, expect, it, vi } from 'vitest';

import fullscreenMix from '../../../../../packages/vlc/src/renderer/player/fullscreenMix';

function createPlayer(requestFullscreen: () => Promise<void>) {
  const container = document.createElement('div');
  const playerElement = document.createElement('div');
  container.appendChild(playerElement);
  playerElement.requestFullscreen = requestFullscreen;

  const handlers = new Map<string, () => void>();
  const player = {
    constructor: { FULLSCREEN_WEB_IN_BODY: false },
    emit: vi.fn(),
    notice: { show: '' },
    on: vi.fn((event: string, handler: () => void) => handlers.set(event, handler)),
    state: 'idle',
    template: { $container: container, $player: playerElement },
  } as any;

  fullscreenMix(player);
  return { handlers, player, playerElement };
}

describe('vlc fullscreen', () => {
  it('commits fullscreen state only after the browser accepts the request', async () => {
    let resolveRequest!: () => void;
    const request = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });
    const { player, playerElement } = createPlayer(() => request);

    player.fullscreenWeb = true;
    expect(playerElement.classList.contains('vlc-fullscreen-web')).toBe(false);

    resolveRequest();
    await vi.waitFor(() => expect(playerElement.classList.contains('vlc-fullscreen-web')).toBe(true));
    expect(player.state).toBe('fullscreenWeb');
  });

  it('keeps normal state and reports a rejected fullscreen request', async () => {
    const error = new Error('denied');
    const { player, playerElement } = createPlayer(() => Promise.reject(error));

    player.fullscreenWeb = true;

    await vi.waitFor(() => expect(player.emit).toHaveBeenCalledWith('fullscreenError', error));
    expect(playerElement.classList.contains('vlc-fullscreen-web')).toBe(false);
    expect(player.notice.show).toBe('Fullscreen failed');
    expect(player.state).toBe('idle');
  });
});
