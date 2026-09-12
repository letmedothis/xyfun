import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('xgplayer', () => {
  class Plugin {
    static POSITIONS = { CONTROLS_CENTER: 'controls-center' };

    player: any;
    config: any;
    i18n = { danmuPlaceholder: 'placeholder', danmuSend: 'send' };
    bind = vi.fn();
    emit = vi.fn();
    find = vi.fn();
    unbind = vi.fn();

    constructor(args: any) {
      this.player = args.player;
      this.config = args.config ?? {};
    }
  }

  return {
    I18N: { extend: vi.fn() },
    Plugin,
  };
});

import DanmuSendPlugin from './danmuSend';

function createPlugin() {
  const sendComment = vi.fn();
  const danmu = { danmujs: {}, sendComment };
  const player = {
    currentTime: 12,
    getPlugin: vi.fn(() => danmu),
    plugins: { danmu },
  };
  const plugin = new DanmuSendPlugin({ config: { maxLength: 10 }, player } as any);
  const input = document.createElement('input');
  const button = document.createElement('div');

  vi.mocked(plugin.find).mockImplementation((selector: string) => {
    if (selector === '.danmu-input') return input;
    if (selector === '.danmu-send') return button;
    return null;
  });

  return { button, danmu, input, player, plugin, sendComment };
}

describe('danmu send plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('binds and unbinds click and keyboard handlers', () => {
    const { plugin } = createPlugin();

    plugin.afterCreate();
    expect(plugin.bind).toHaveBeenCalledWith('.danmu-send', 'click', plugin.sendBtnClick);
    expect(plugin.bind).toHaveBeenCalledWith('.danmu-input', 'keydown', plugin.inputKeydown);

    plugin.destroy();
    expect(plugin.unbind).toHaveBeenCalledWith('.danmu-send', 'click');
    expect(plugin.unbind).toHaveBeenCalledWith('.danmu-input', 'keydown');
  });

  it('sends trimmed text and clears the input after success', () => {
    const { input, plugin, sendComment } = createPlugin();
    input.value = ' hello ';
    plugin.onPluginsReady();

    plugin.sendBtnClick();

    expect(sendComment).toHaveBeenCalledWith(expect.objectContaining({ mode: 'scroll', start: 12_300, txt: 'hello' }));
    expect(plugin.emit).toHaveBeenCalledWith('DANMAKU_SEND', expect.objectContaining({ start: 12, txt: 'hello' }));
    expect(input.value).toBe('');
  });

  it('keeps the input and emits an error when sending fails', () => {
    const { input, plugin, sendComment } = createPlugin();
    input.value = 'hello';
    sendComment.mockImplementation(() => {
      throw new Error('failed');
    });
    plugin.onPluginsReady();

    plugin.sendBtnClick();

    expect(input.value).toBe('hello');
    expect(plugin.emit).toHaveBeenCalledWith('DANMAKU_SEND_ERROR', {
      reason: 'send-failed',
      text: 'hello',
    });
  });

  it('rejects blank and overlong text', () => {
    const { input, plugin, sendComment } = createPlugin();
    plugin.onPluginsReady();

    input.value = '   ';
    plugin.sendBtnClick();
    expect(plugin.emit).toHaveBeenCalledWith('DANMAKU_SEND_ERROR', { reason: 'empty', text: '' });

    input.value = '12345678901';
    plugin.sendBtnClick();
    expect(plugin.emit).toHaveBeenCalledWith('DANMAKU_SEND_ERROR', {
      reason: 'too-long',
      text: '12345678901',
    });
    expect(sendComment).not.toHaveBeenCalled();
  });

  it('sends on Enter but ignores composition events', () => {
    const { input, plugin, sendComment } = createPlugin();
    input.value = 'hello';
    plugin.onPluginsReady();

    plugin.inputKeydown(new KeyboardEvent('keydown', { isComposing: true, key: 'Enter' }));
    expect(sendComment).not.toHaveBeenCalled();

    const event = new KeyboardEvent('keydown', { cancelable: true, key: 'Enter' });
    plugin.inputKeydown(event);
    expect(event.defaultPrevented).toBe(true);
    expect(sendComment).toHaveBeenCalledOnce();
  });
});
