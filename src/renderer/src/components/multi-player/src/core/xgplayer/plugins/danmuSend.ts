import type { IXGI18nText } from 'xgplayer';
import { I18N, Plugin } from 'xgplayer';

const LANG = [
  {
    LANG: 'zh-cn',
    TEXT: {
      danmuSend: '发送',
      danmuPlaceholder: '请输入弹幕',
    },
  },
  {
    LANG: 'zh-hk',
    TEXT: {
      danmuSend: '發送',
      danmuPlaceholder: '請輸入彈幕',
    },
  },
  {
    LANG: 'en',
    TEXT: {
      danmuSend: 'Send',
      danmuPlaceholder: 'Please enter a comment',
    },
  },
];
I18N.extend(LANG as Array<IXGI18nText>);

const { POSITIONS } = Plugin;

interface DanmuPlugin {
  danmujs?: unknown;
  sendComment: (comment: DanmuRenderComment) => void;
}

interface DanmuComment {
  txt: string;
  start: number;
  mode: 'scroll';
  style: {
    color: string;
    fontSize: string;
  };
}

interface DanmuRenderComment extends DanmuComment {
  duration: number;
  id: string;
  prior: boolean;
}

type SendFailureReason = 'danmu-unavailable' | 'empty' | 'invalid-time' | 'too-long' | 'send-failed';

export default class DanmuSendPlugin extends Plugin {
  private danmuPlugin: DanmuPlugin | null = null;

  // 插件的名称，将作为插件实例的唯一key值
  static get pluginName() {
    return 'danmuSend';
  }

  static get defaultConfig() {
    return {
      position: POSITIONS.CONTROLS_CENTER,
      index: 0,
      showIcon: false,
      preferDocument: false,
      width: undefined,
      height: undefined,
      docPiPNode: undefined,
      docPiPStyle: undefined,
      maxLength: 200,
    };
  }

  constructor(args: any) {
    super(args);
  }

  onPluginsReady() {
    this.danmuPlugin = (this.player.getPlugin('danmu') || this.player.plugins.danmu || null) as DanmuPlugin | null;
    this.setControlsEnabled(!!this.danmuPlugin?.danmujs);
  }

  private emitFailure(reason: SendFailureReason, text: string) {
    this.emit('DANMAKU_SEND_ERROR', { reason, text });
  }

  private setControlsEnabled(enabled: boolean) {
    const input = this.find('.danmu-input') as HTMLInputElement | null;
    const button = this.find('.danmu-send') as HTMLElement | null;

    if (input) input.disabled = !enabled;
    if (button) {
      button.setAttribute('aria-disabled', String(!enabled));
      button.style.cursor = enabled ? 'pointer' : 'not-allowed';
      button.style.opacity = enabled ? '1' : '0.5';
    }
  }

  sendBtnClick = () => {
    const input = this.find('.danmu-input') as HTMLInputElement | null;
    if (!input) return;

    const inputValue = input.value.trim();
    if (!inputValue) {
      this.emitFailure('empty', inputValue);
      return;
    }

    const maxLength = Number(this.config.maxLength) || 200;
    if (inputValue.length > maxLength) {
      this.emitFailure('too-long', inputValue);
      return;
    }

    if (!this.danmuPlugin?.danmujs || typeof this.danmuPlugin.sendComment !== 'function') {
      this.emitFailure('danmu-unavailable', inputValue);
      return;
    }

    const currentTime = this.player.currentTime;
    if (!Number.isFinite(currentTime) || currentTime < 0) {
      this.emitFailure('invalid-time', inputValue);
      return;
    }

    const doc: DanmuComment = {
      txt: inputValue,
      start: currentTime,
      mode: 'scroll',
      style: {
        color: '#FFFFFF',
        fontSize: '24px',
      },
    };

    try {
      this.danmuPlugin.sendComment({
        ...doc,
        start: (doc.start + 0.3) * 1000,
        duration: 5000,
        id: Date.now().toString(),
        prior: true,
      });
    } catch {
      this.emitFailure('send-failed', inputValue);
      return;
    }

    this.emit('DANMAKU_SEND', doc);
    input.value = '';
  };

  inputKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    this.sendBtnClick();
  };

  afterCreate() {
    /**
     * 自定义插件 弹幕发送模块
     * root.__root__为根节点Vue模板data值
     */
    this.bind('.danmu-send', 'click', this.sendBtnClick);
    this.bind('.danmu-input', 'keydown', this.inputKeydown);
  }

  destroy() {
    this.unbind('.danmu-send', 'click');
    this.unbind('.danmu-input', 'keydown');
    this.danmuPlugin = null;
  }

  render() {
    const btnEl = `<div
      class="danmu-send"
      style="
        cursor: pointer;
        width: 60px;
        height: 100%;
        text-shadow: none;
        background-color: #00a1d6;
        border-top-right-radius: 5px;
        border-bottom-right-radius: 5px;
        justify-content: center;
        align-items: center;
        display: flex;"
      >
      ${(this.i18n as any).danmuSend}
    </div>`;

    const inputEl = `
      <input
        class="danmu-input"
        style="
          color: #fff;
          background-color: #0000;
          border: none;
          outline: none;
          flex: 1;
          width: auto;
          min-width: 0;
          padding: 0 6px;
          height: 100%;
          line-height: 1;
        "
        maxlength="${Number(this.config.maxLength) || 200}"
        placeholder="${(this.i18n as any).danmuPlaceholder}"
      />
      `;

    return `
      <div class="danmu-send-plugin" style="
        height: 32px; max-width: 300px; margin: 0 auto;
        background-color: #1f1f1fe6; border-radius: 5px;
        display: flex; flex-direction: row;"
      >
        ${inputEl}
        ${btnEl}
      </div>`;
  }
}
