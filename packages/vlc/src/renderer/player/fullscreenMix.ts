import { addClass, append, hasClass, removeClass, setStyle } from '../utils/dom';
import { def } from '../utils/property';

export default function fullscreenMix(vlc: any) {
  const {
    constructor,
    template: { $container, $player },
  } = vlc;

  let cssText = '';
  let fullscreenPending = false;

  async function requestBrowserFullscreen(): Promise<void> {
    const el = $player as HTMLElement;
    if (el.requestFullscreen) {
      await el.requestFullscreen();
    } else if ((el as any).webkitRequestFullscreen) {
      await (el as any).webkitRequestFullscreen();
    } else {
      throw new Error('Fullscreen API is unavailable');
    }
  }

  async function exitBrowserFullscreen(): Promise<void> {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
    } else if ((document as any).webkitExitFullscreen) {
      await (document as any).webkitExitFullscreen();
    }
  }

  function isBrowserFullscreen(): boolean {
    const fullEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
    return fullEl === $player;
  }

  def(vlc, 'fullscreenWeb', {
    get() {
      return isBrowserFullscreen() || hasClass($player, 'vlc-fullscreen-web');
    },
    set(value) {
      if (fullscreenPending) return;

      if (value) {
        cssText = $player.style.cssText;
        if (constructor.FULLSCREEN_WEB_IN_BODY) {
          append(document.body, $player);
        }
        fullscreenPending = true;
        void requestBrowserFullscreen()
          .then(() => {
            vlc.state = 'fullscreenWeb';
            setStyle($player, 'width', '100%');
            setStyle($player, 'height', '100%');
            addClass($player, 'vlc-fullscreen-web');
            vlc.emit('fullscreenWeb', true);
            vlc.emit('resize');
          })
          .catch((error) => {
            if (constructor.FULLSCREEN_WEB_IN_BODY) append($container, $player);
            cssText = '';
            vlc.notice.show = 'Fullscreen failed';
            vlc.emit('fullscreenError', error);
          })
          .finally(() => {
            fullscreenPending = false;
          });
      } else {
        if (isBrowserFullscreen()) {
          fullscreenPending = true;
          void exitBrowserFullscreen()
            .then(() => onFullscreenChange())
            .catch((error) => {
              vlc.notice.show = 'Exit fullscreen failed';
              vlc.emit('fullscreenError', error);
            })
            .finally(() => {
              fullscreenPending = false;
            });
          return;
        }
        if (constructor.FULLSCREEN_WEB_IN_BODY) {
          append($container, $player);
        }
        if (cssText) {
          $player.style.cssText = cssText;
          cssText = '';
        }
        removeClass($player, 'vlc-fullscreen-web');
        vlc.emit('fullscreen', false);
        vlc.emit('resize');
      }
    },
  });

  // Handle Esc key or other browser-initiated fullscreen exit
  function onFullscreenChange(): void {
    if (!isBrowserFullscreen()) {
      if (constructor.FULLSCREEN_WEB_IN_BODY) {
        append($container, $player);
      }
      if (cssText) {
        $player.style.cssText = cssText;
        cssText = '';
      }
      removeClass($player, 'vlc-fullscreen-web');
      vlc.state = 'idle';
      vlc.emit('fullscreen', false);
      vlc.emit('resize');
    }
  }

  $player.addEventListener('fullscreenchange', onFullscreenChange);
  $player.addEventListener('webkitfullscreenchange', onFullscreenChange);
  vlc.on('destroy', () => {
    $player.removeEventListener('fullscreenchange', onFullscreenChange);
    $player.removeEventListener('webkitfullscreenchange', onFullscreenChange);
  });
}
