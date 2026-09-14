import { join } from 'node:path';

import { loggerService } from '@logger';
import { appLocale } from '@main/services/AppLocale';
import { configManager } from '@main/services/ConfigManager';
import { API_AUTH_HEADER, API_AUTH_TOKEN } from '@main/services/FastifyService/apiAuth';
import { handleProtocolUrl } from '@main/services/ProtocolClient';
import { APP_DATABASE_PATH } from '@main/utils/path';
import {
  generateUserAgent,
  isDev,
  isLinux,
  isMacOS,
  isMacOSTahoe,
  isPackaged,
  isWindows,
  isWindows22H2,
} from '@main/utils/systemInfo';
import { APP_NAME_PROTOCOL, titleBarOverlayDark, titleBarOverlayLight } from '@shared/config/appInfo';
import { PORT } from '@shared/config/env';
import { IPC_CHANNEL } from '@shared/config/ipcChannel';
import { LOG_MODULE } from '@shared/config/logger';
import type { ISize } from '@shared/config/window';
import { WINDOW_NAME, WINDOW_SIZE } from '@shared/config/window';
import {
  convertHeaders,
  convertUriToStandard,
  ELECTRON_TAG,
  isLocalhostURI,
  REMOVE_TAG,
  removePrefixHeaders,
  UNSAFE_HEADERS,
} from '@shared/modules/headers';
import {
  isHttp,
  isPositiveFiniteNumber,
  isSecurityScheme,
  isSystemScheme,
  isUndefined,
} from '@shared/modules/validate';
import type { BrowserWindowConstructorOptions, Session } from 'electron';
import { app, BrowserWindow, ipcMain, nativeImage, nativeTheme, screen, shell } from 'electron';
import windowStateKeeper from 'electron-window-state';
import { merge } from 'es-toolkit';
import { getDomain } from 'tldts';

import iconPath from '../../../build/icon.png?asset';
import { contextMenu } from './ContextMenu';
import { initSessionUserAgent } from './WebviewService';

const logger = loggerService.withContext(LOG_MODULE.APP_WINDOW);

const linuxIcon = isLinux ? nativeImage.createFromPath(iconPath) : undefined;

export class WindowService {
  private static instance: WindowService | null = null;
  private winPool = new Map<string, { window: BrowserWindow | null; lastCrashTime: number }>();
  private supportShowWindow = new Set<string>([WINDOW_NAME.MAIN, WINDOW_NAME.PLAYER, WINDOW_NAME.BROWSER]);
  private webRequestSessions = new WeakSet<Session>();
  private webviewHeaderRules = new Map<number, { rawUrl: string; headers?: Record<string, any> }>();
  private contextMenuSetup = false;
  private trustedWebContentsIds = new Set<number>();

  public static getInstance(): WindowService {
    if (!WindowService.instance) {
      WindowService.instance = new WindowService();
    }
    return WindowService.instance;
  }

  public computedSize(size: number): number {
    return Math.ceil(size * configManager.zoom);
  }

  public getWindowSize(name: string, type: 'default' | 'min' = 'default', computed: boolean = true): ISize {
    const config = WINDOW_SIZE[name] ?? WINDOW_SIZE[WINDOW_NAME.OTHER];
    const size = config[type];

    if (!computed) return { ...size };

    return {
      width: this.computedSize(size.width),
      height: this.computedSize(size.height),
    };
  }

  public getAllNames(): string[] {
    return [...this.winPool.keys()];
  }

  public getAllWindows(): BrowserWindow[] {
    return Array.from(this.winPool.values(), (item) => item.window!).filter(
      (win) => win instanceof BrowserWindow && !win.isDestroyed(),
    );
  }

  public getWindowName(mainWindow: BrowserWindow): string | null {
    for (const [name, item] of this.winPool.entries()) {
      if (item.window === mainWindow) {
        return name;
      }
    }

    return null;
  }

  public getWindow(window: string | BrowserWindow): BrowserWindow | null {
    if (typeof window === 'string') {
      if (this.winPool.has(window)) {
        return this.winPool.get(window)?.window as BrowserWindow;
      }
    } else if (typeof window === 'object' && window instanceof BrowserWindow) {
      return window;
    }

    return null;
  }

  public setZoomWindow(window: string | BrowserWindow, zoom: number) {
    if (!isPositiveFiniteNumber(zoom)) {
      return;
    }

    const mainWindow = this.getWindow(window);

    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    const newZoom = Math.min(Math.max(Number(zoom.toFixed(1)), 0.5), 2.0);

    const currentZoom = mainWindow.webContents.getZoomFactor();
    if (Math.abs(newZoom - currentZoom) < 0.01) return;

    const windowName = this.getWindowName(mainWindow)!;

    const [currentWidth, currentHeight] = mainWindow.getSize();
    const baseWidth = currentWidth / currentZoom;
    const baseHeight = currentHeight / currentZoom;

    const calculatedSize = {
      width: Math.round(baseWidth * newZoom),
      height: Math.round(baseHeight * newZoom),
    };

    const minConfSize = this.getWindowSize(windowName, 'min', false);
    const minSize = {
      width: Math.round(minConfSize.width * newZoom),
      height: Math.round(minConfSize.height * newZoom),
    };

    const defaultConfSize = this.getWindowSize(windowName, 'default', false);
    const defaultSize = {
      width: Math.round(defaultConfSize.width * newZoom),
      height: Math.round(defaultConfSize.height * newZoom),
    };

    const finalSize = {
      width: calculatedSize.width < minSize.width ? defaultSize.width : calculatedSize.width,
      height: calculatedSize.height < minSize.height ? defaultSize.height : calculatedSize.height,
    };

    mainWindow.setMinimumSize(minSize.width, minSize.height);
    mainWindow.setSize(finalSize.width, finalSize.height);
    mainWindow.webContents.setZoomFactor(newZoom);
  }

  public setZoomWindows(zoom: number) {
    const windows = this.getAllWindows();
    windows.forEach((win) => this.setZoomWindow(win, zoom));
  }

  public showWindow(window: string | BrowserWindow) {
    const mainWindow = this.getWindow(window);

    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    if (isWindows) {
      mainWindow.setOpacity(1);
    }

    /**
     * [Linux] Special handling for window activation
     * When the window is visible but covered by other windows, simply calling show() and focus()
     * is not enough to bring it to the front. We need to hide it first, then show it again.
     * This mimics the "close to tray and reopen" behavior which works correctly.
     */
    if (isLinux && mainWindow.isVisible() && !mainWindow.isFocused()) {
      mainWindow.hide();
      setImmediate(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      });
      return;
    }

    /**
     * About setVisibleOnAllWorkspaces
     *
     * [macOS] Known Issue
     *  setVisibleOnAllWorkspaces true/false will NOT bring window to current desktop in Mac (works fine with Windows)
     *  AppleScript may be a solution, but it's not worth
     *
     * [Linux] Known Issue
     *  setVisibleOnAllWorkspaces In Linux environments (especially KDE Wayland) this can cause windows to go into a "false popup" state
     */
    if (!isLinux) {
      mainWindow.setVisibleOnAllWorkspaces(true);
    }

    /**
     * [macOS] After being closed in fullscreen, the fullscreen behavior will become strange when window shows again
     * So we need to set it to FALSE explicitly.
     * althougle other platforms don't have the issue, but it's a good practice to do so
     *
     *  Check if window is visible to prevent interrupting fullscreen state when clicking dock icon
     */
    if (mainWindow.isFullScreen() && !mainWindow.isVisible()) {
      mainWindow.setFullScreen(false);
    }

    mainWindow.show();
    mainWindow.focus();

    if (!isLinux) {
      mainWindow.setVisibleOnAllWorkspaces(false);
    }
  }

  public showAllWindows(all = false) {
    const windows = all
      ? this.getAllWindows()
      : this.supportShowWindow
          .values()
          .map((name) => this.getWindow(name))
          .filter((win): win is BrowserWindow => win instanceof BrowserWindow);

    windows.forEach((win) => this.showWindow(win));
  }

  public hideWindow(window: string | BrowserWindow) {
    const mainWindow = this.getWindow(window);

    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    // [macOS/Windows] hacky fix
    // previous window(not self-app) should be focused again after miniWindow hide
    // this workaround is to make previous window focused again after miniWindow hide
    if (isWindows) {
      mainWindow.setOpacity(0); // don't show the minimizing animation
      mainWindow.minimize();
      return;
    } else if (isMacOS) {
      mainWindow.hide();
      // app.hide();
      return;
    }

    mainWindow.hide();
  }

  public hideAllWindows() {
    const windows = this.getAllWindows();
    windows.forEach((win) => this.hideWindow(win));
  }

  public toggleWindow(window: string | BrowserWindow) {
    const mainWindow = this.getWindow(window);

    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    // should not toggle main window when in full screen
    // but if the main window is close to tray when it's in full screen, we can show it again
    // (it's a bug in macos, because we can close the window when it's in full screen, and the state will be remained)
    // if (mainWindow?.isFullScreen() && mainWindow.isVisible()) {
    //   return;
    // }

    mainWindow.isVisible() ? this.hideWindow(mainWindow) : this.showWindow(mainWindow);
  }

  public toggleAllWindows() {
    const windows = this.getAllWindows();
    const isVisable = windows.some((win) => win.isVisible());

    windows.forEach((win) => {
      isVisable ? this.hideWindow(win) : this.showWindow(win);
    });
  }

  public closeWindow(window: string | BrowserWindow) {
    const mainWindow = this.getWindow(window);
    const mainWindowName = this.getWindowName(mainWindow!);

    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.close();
      } catch {
        mainWindow.destroy();
      }
    }

    if (mainWindowName) {
      this.winPool.delete(mainWindowName);
    }
  }

  public closeAllWindows = () => {
    const windows = this.getAllWindows();
    windows.forEach((win) => this.closeWindow(win));
    this.winPool.clear();
  };

  public reloadWindow(window: string | BrowserWindow, force: boolean = false) {
    const mainWindow = this.getWindow(window);

    if (mainWindow && !mainWindow.isDestroyed()) {
      force ? mainWindow.webContents.reloadIgnoringCache() : mainWindow.webContents.reload();
    }
  }

  public reloadAllWindows(force: boolean = false) {
    const windows = this.getAllWindows();
    windows.forEach((win) => this.reloadWindow(win, force));
  }

  private mouseTracker(mainWindow: BrowserWindow, interval = 100) {
    let wasInside = false;

    const timer = setInterval(() => {
      if (mainWindow.isDestroyed()) {
        clearInterval(timer);
        return;
      }

      const cursor = screen.getCursorScreenPoint();
      const bounds = mainWindow.getBounds();
      const isInside =
        cursor.x >= bounds.x &&
        cursor.x <= bounds.x + bounds.width &&
        cursor.y >= bounds.y &&
        cursor.y <= bounds.y + bounds.height;

      if (isInside !== wasInside) {
        mainWindow.webContents.send(IPC_CHANNEL.MEDIA_BROWSE, !isInside);
        wasInside = isInside;
      }
    }, interval);

    return () => clearInterval(timer);
  }

  private safeClose(mainWindow: BrowserWindow) {
    const finish = () => {
      ipcMain.removeListener(IPC_CHANNEL.WINDOW_DESTROY_RELAY, onAck);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    };

    const onAck = (event: Electron.IpcMainEvent) => {
      if (mainWindow.isDestroyed()) {
        clearTimeout(timer);
        return finish();
      }
      if (event.sender.id !== mainWindow.webContents.id) return;
      if (timer) clearTimeout(timer);
      finish();
    };

    const timer = setTimeout(() => {
      ipcMain.removeListener(IPC_CHANNEL.WINDOW_DESTROY_RELAY, onAck);
      finish();
    }, 800);

    ipcMain.on(IPC_CHANNEL.WINDOW_DESTROY_RELAY, onAck);
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNEL.WINDOW_DESTROY);
    } else {
      finish();
    }
  }

  private setupWindowMonitor(mainWindow: BrowserWindow) {
    mainWindow.webContents.on('render-process-gone', (_, details) => {
      logger.error(`Renderer process crashed with: ${JSON.stringify(details)}`);
      const currentTime = Date.now();
      const mainWindowName = this.getWindowName(mainWindow)!;
      const lastCrashTime = this.winPool.get(mainWindowName)?.lastCrashTime || 0;
      this.winPool.set(mainWindowName, { window: mainWindow, lastCrashTime: currentTime });
      if (currentTime - lastCrashTime > 60 * 1000) {
        // If greater than 1 minute, restart the rendering process
        mainWindow.webContents.reload();
      } else {
        // If less than 1 minute, exit the application
        app.exit(1);
      }
    });
  }

  private setupContextMenu(mainWindow: BrowserWindow) {
    if (this.contextMenuSetup) return;
    this.contextMenuSetup = true;
    contextMenu.contextMenu(mainWindow.webContents);

    // setup context menu for all webviews
    app.on('web-contents-created', (_, webContents) => {
      contextMenu.contextMenu(webContents);
    });

    // Dangerous API
    if (isDev) {
      // mainWindow.webContents.on('will-attach-webview', (_, webPreferences) => {
      //   webPreferences.preload = join(import.meta.dirname, '../preload/index.js');
      // });
    }
  }

  private setupWindowEvents(mainWindow: BrowserWindow) {
    mainWindow.once('ready-to-show', () => {
      mainWindow.webContents.setZoomFactor(configManager.zoom);

      // [mac]hacky-fix: miniWindow set visibleOnFullScreen:true will cause dock icon disappeared
      // app.dock?.show();
      // mainWindow.show();
    });

    // set the zoom factor again when the window is going to resize
    //
    // this is a workaround for the known bug that
    // the zoom factor is reset to cached value when window is resized after routing to other page
    // see: https://github.com/electron/electron/issues/10572
    //
    mainWindow.on('will-resize', () => {
      mainWindow.webContents.setZoomFactor(configManager.zoom);
      mainWindow.webContents.send(IPC_CHANNEL.WINDOW_SIZE, mainWindow.getSize());
    });

    // set the zoom factor again when the window is going to restore
    // minimize and restore will cause zoom reset
    mainWindow.on('restore', () => {
      mainWindow.webContents.setZoomFactor(configManager.zoom);
    });

    // ARCH: as `will-resize` is only for Win & Mac,
    // linux has the same problem, use `resize` listener instead
    // but `resize` will fliker the ui
    if (isLinux) {
      mainWindow.on('resize', () => {
        mainWindow.webContents.setZoomFactor(configManager.zoom);
        mainWindow.webContents.send(IPC_CHANNEL.WINDOW_SIZE, mainWindow.getSize());
      });
    }

    mainWindow.on('maximize', () => {
      mainWindow.webContents.send(IPC_CHANNEL.WINDOW_MAX, mainWindow.isMaximized());
    });

    mainWindow.on('unmaximize', () => {
      mainWindow.webContents.send(IPC_CHANNEL.WINDOW_MAX, mainWindow.isMaximized());
    });

    mainWindow.on('enter-full-screen', () => {
      mainWindow.webContents.send(IPC_CHANNEL.WINDOW_FULLSCREEN, mainWindow.isFullScreen());
    });

    mainWindow.on('leave-full-screen', () => {
      mainWindow.webContents.send(IPC_CHANNEL.WINDOW_FULLSCREEN, mainWindow.isFullScreen());
    });
  }

  private setupWebContentsHandlers(mainWindow: BrowserWindow) {
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (url.includes('localhost:5173')) {
        return;
      }

      event.preventDefault();
      if (isSecurityScheme(url)) {
        shell.openExternal(url);
      } else {
        logger.warn(`Blocked navigation to untrusted URL scheme: ${url}`);
      }
    });

    mainWindow.webContents.setWindowOpenHandler((details) => {
      const { url } = details;

      if (isSystemScheme(url)) {
        shell.openExternal(url).catch((err) => {
          logger.error(`Failed to open external URL: ${url}`, err as Error);
        });
      } else if (url.startsWith(APP_NAME_PROTOCOL)) {
        handleProtocolUrl(url);
      } else if (isHttp(details.url)) {
        let window = this.getWindow(WINDOW_NAME.BROWSER);
        if (window && !window.isDestroyed()) {
          this.showWindow(window);
          window.webContents.send(IPC_CHANNEL.BROWSER_NAVIGATE, url);
        } else {
          window = this.createBrowserWindow();
          window.webContents.once('did-finish-load', () => {
            setTimeout(() => {
              if (window && !window.isDestroyed()) {
                window.webContents.send(IPC_CHANNEL.BROWSER_NAVIGATE, url);
              }
            }, 1000);
          });
        }
      } else {
        logger.warn(`Blocked shell.openExternal for untrusted URL scheme: ${url}`);
      }

      return { action: 'deny' };
    });

    this.setupWebRequestHeaders(mainWindow.webContents.session);
  }

  private setupWebRequestHeaders(targetSession: Session) {
    if (this.webRequestSessions.has(targetSession)) return;
    this.webRequestSessions.add(targetSession);

    const reqMap = new Map<number, { redirect: string; headers: Record<string, any> }>();

    targetSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      const { id, url } = details;

      // Block devtools detector requests
      if (['devtools-detector', 'disable-devtool'].some((f) => url.includes(f))) {
        callback({ cancel: true });
        return;
      }

      const { redirect, headers } = convertUriToStandard(url);
      if (headers && Object.keys(headers).length && url !== redirect) {
        reqMap.set(id, { redirect, headers });
        callback({ cancel: false, redirectURL: redirect });
      } else {
        callback({ cancel: false });
      }
    });

    targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const { id, requestHeaders: rawRequestHeaders, url } = details;
      let requestHeaders = convertHeaders(rawRequestHeaders);
      const isApiRequest =
        url.startsWith(`http://127.0.0.1:${PORT}/`) ||
        url.startsWith(`http://localhost:${PORT}/`) ||
        url.startsWith(`ws://127.0.0.1:${PORT}/`) ||
        url.startsWith(`ws://localhost:${PORT}/`) ||
        url.startsWith(`wss://127.0.0.1:${PORT}/`) ||
        url.startsWith(`wss://localhost:${PORT}/`);
      // Only bundled renderer windows may receive the local API credential.
      if (
        isApiRequest &&
        typeof details.webContentsId === 'number' &&
        this.trustedWebContentsIds.has(details.webContentsId)
      ) {
        requestHeaders[API_AUTH_HEADER] = API_AUTH_TOKEN;
      }
      const customHeaders = reqMap.has(id) ? reqMap.get(id)!.headers : {};
      if (reqMap.has(id)) reqMap.delete(id);

      // Handle Unsafe Headers
      UNSAFE_HEADERS.forEach((key) => {
        requestHeaders[key] = !isUndefined(customHeaders[key])
          ? customHeaders[key]
          : !isUndefined(requestHeaders[`${ELECTRON_TAG}-${key}`])
            ? requestHeaders[`${ELECTRON_TAG}-${key}`]
            : requestHeaders[key];
        delete requestHeaders[`${ELECTRON_TAG}-${key}`];

        if (key === 'User-Agent' && requestHeaders[key]?.includes(ELECTRON_TAG)) {
          requestHeaders[key] = configManager.ua;
        }

        if (isUndefined(requestHeaders[key]) || isLocalhostURI(requestHeaders[key])) {
          delete requestHeaders[key];
        }
      });

      // Accept-Language
      const language = appLocale.defaultLang();
      requestHeaders['Accept-Language'] = `${language}, en;q=0.9, *;q=0.5`;

      // Custom Header
      if (url.includes('doubanio.com') && !requestHeaders.Referer) {
        requestHeaders.Referer = 'https://api.douban.com/';
      }

      // Handle redirect mode
      if (requestHeaders.Redirect === 'manual') reqMap.set(id, { redirect: url, headers: requestHeaders });

      // Handle remove header
      requestHeaders = removePrefixHeaders(requestHeaders, REMOVE_TAG, true);

      const webviewRule =
        typeof details.webContentsId === 'number' ? this.webviewHeaderRules.get(details.webContentsId) : undefined;
      if (webviewRule) {
        let sameDomain = false;
        try {
          const sourceDomain = getDomain(url);
          const rawDomain = getDomain(webviewRule.rawUrl);
          sameDomain = Boolean(sourceDomain && rawDomain && sourceDomain === rawDomain);
        } catch {
          sameDomain = false;
        }

        if (sameDomain && webviewRule.headers) {
          for (const [key, value] of Object.entries(webviewRule.headers)) {
            requestHeaders[key] = value;
          }
        }
      }

      callback({ requestHeaders });
    });

    targetSession.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
      const { id, responseHeaders } = details;

      if (reqMap.has(id)) reqMap.delete(id);

      callback({
        cancel: false,
        responseHeaders: {
          ...responseHeaders,
          'Document-Policy': ['include-js-call-stacks-in-crash-reports'],
        },
      });
    });
  }

  public setWebviewHeaderRule(webviewId: number, rawUrl: string, headers?: Record<string, any>) {
    this.webviewHeaderRules.set(webviewId, { rawUrl, headers });
  }

  public clearWebviewHeaderRule(webviewId: number) {
    this.webviewHeaderRules.delete(webviewId);
  }

  // see: https://github.com/electron/electron/issues/42055#issuecomment-2449365647
  private replaceDevtoolsFont = (mainWindow: BrowserWindow) => {
    // only for windows and dev, don't do this in production to avoid performance issues
    if (isWindows && isDev) {
      mainWindow.webContents.on('devtools-opened', () => {
        const css = `
          :root {
            --sys-color-base: var(--ref-palette-neutral100);
            --source-code-font-family: consolas !important;
            --source-code-font-size: 12px;
            --monospace-font-family: consolas !important;
            --monospace-font-size: 12px;
            --default-font-family: system-ui, sans-serif;
            --default-font-size: 12px;
            --ref-palette-neutral99: #ffffffff;
          }
          .theme-with-dark-background {
            --sys-color-base: var(--ref-palette-secondary25);
          }
          body {
            --default-font-family: system-ui, sans-serif;
          }
      `;
        mainWindow.webContents.devToolsWebContents?.executeJavaScript(`
          const overriddenStyle = document.createElement('style');
          overriddenStyle.innerHTML = '${css.replaceAll('\n', ' ')}';
          document.body.append(overriddenStyle);
          document.querySelectorAll('.platform-windows').forEach(el => el.classList.remove('platform-windows'));
          addStyleToAutoComplete();
          const observer = new MutationObserver((mutationList, observer) => {
            for (const mutation of mutationList) {
              if (mutation.type === 'childList') {
                for (let i = 0; i < mutation.addedNodes.length; i++) {
                  const item = mutation.addedNodes[i];
                  if (item.classList.contains('editor-tooltip-host')) {
                      addStyleToAutoComplete();
                  }
                }
              }
            }
          });
          observer.observe(document.body, {childList: true});
          function addStyleToAutoComplete() {
            document.querySelectorAll('.editor-tooltip-host').forEach(element => {
              if (element.shadowRoot.querySelectorAll('[data-key="overridden-dev-tools-font"]').length === 0) {
                const overriddenStyle = document.createElement('style');
                overriddenStyle.setAttribute('data-key', 'overridden-dev-tools-font');
                overriddenStyle.innerHTML = '.cm-tooltip-autocomplete ul[role=listbox] {font-family: consolas !important;}';
                element.shadowRoot.append(overriddenStyle);
              }
            });
          }
      `);
      });
    }
  };

  public createWindow(
    windowName: string,
    options?: BrowserWindowConstructorOptions,
    trustedRenderer: boolean = true,
  ): BrowserWindow {
    let mainWindow = this.getWindow(windowName);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      return mainWindow;
    }

    const windowOptions: BrowserWindowConstructorOptions = merge(
      {
        width: WINDOW_SIZE[WINDOW_NAME.OTHER].default.width,
        height: WINDOW_SIZE[WINDOW_NAME.OTHER].default.height,
        show: false,
        autoHideMenuBar: true,
        transparent: false,
        ...(isLinux ? { icon: linuxIcon } : {}),
        webPreferences: {
          allowRunningInsecureContent: false,
          backgroundThrottling: false,
          contextIsolation: true,
          nodeIntegration: false,
          preload: join(import.meta.dirname, '../preload/index.js'),
          sandbox: true,
          spellcheck: false,
          webSecurity: true,
          zoomFactor: configManager.zoom,
        },
      },
      options || {},
    );

    if (!trustedRenderer) {
      delete windowOptions.webPreferences?.preload;
      windowOptions.webPreferences = {
        ...windowOptions.webPreferences,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      };
    }

    mainWindow = new BrowserWindow(windowOptions);

    if (trustedRenderer) {
      const webContentsId = mainWindow.webContents.id;
      this.trustedWebContentsIds.add(webContentsId);
      mainWindow.webContents.once('destroyed', () => this.trustedWebContentsIds.delete(webContentsId));
    }

    this.replaceDevtoolsFont(mainWindow);
    this.setupContextMenu(mainWindow);
    this.setupWindowMonitor(mainWindow);

    mainWindow.on('closed', () => {
      this.winPool.delete(windowName);

      if (app.isQuitting && this.getAllWindows().length === 0) {
        app.quit();
      }
    });

    this.winPool.set(windowName, { window: mainWindow, lastCrashTime: 0 });

    return mainWindow;
  }

  public createMainWindow(): BrowserWindow {
    const windowName = WINDOW_NAME.MAIN;

    const mainWindowState = windowStateKeeper({
      path: APP_DATABASE_PATH,
      file: `${windowName}-window-state.json`,
      defaultWidth: this.getWindowSize(windowName, 'default').width,
      defaultHeight: this.getWindowSize(windowName, 'default').height,
      fullScreen: false,
      maximize: false,
    });

    const mainWindow = this.createWindow(windowName, {
      x: mainWindowState.x,
      y: mainWindowState.y,
      width: mainWindowState.width,
      height: mainWindowState.height,
      minWidth: this.getWindowSize(windowName, 'min').width,
      minHeight: this.getWindowSize(windowName, 'min').height,
      show: false,
      autoHideMenuBar: true,
      transparent: false,
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      // For Windows and Linux, we use frameless window with custom controls
      // For Mac, we keep the native title bar style
      ...(isMacOS
        ? {
            titleBarStyle: 'hidden',
            titleBarOverlay: nativeTheme.shouldUseDarkColors ? titleBarOverlayDark : titleBarOverlayLight,
            trafficLightPosition: isMacOSTahoe ? { x: 8, y: 14 } : { x: 12, y: 14 },
          }
        : {
            frame: false, // Frameless window for Windows and Linux
          }),
      ...(isWindows22H2 ? { backgroundMaterial: 'mica' } : {}),
      ...(!isMacOS && !isWindows22H2
        ? { backgroundColor: nativeTheme.shouldUseDarkColors ? '#181818' : '#FFFFFF' }
        : {}),
      darkTheme: nativeTheme.shouldUseDarkColors,
      webPreferences: {
        webviewTag: true,
      },
    });

    mainWindowState.manage(mainWindow);

    this.setupWindowEvents(mainWindow);
    this.setupWebContentsHandlers(mainWindow);

    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
    });

    if (!isPackaged && process.env.ELECTRON_RENDERER_URL) {
      mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'));
    }

    // init webview useragent
    const webviewSession = initSessionUserAgent();
    this.setupWebRequestHeaders(webviewSession);

    return mainWindow;
  }

  public createPlayerWindow(): BrowserWindow {
    const windowName = WINDOW_NAME.PLAYER;

    const mainWindowState = windowStateKeeper({
      path: APP_DATABASE_PATH,
      file: `${windowName}-window-state.json`,
      defaultWidth: this.getWindowSize(windowName, 'default').width,
      defaultHeight: this.getWindowSize(windowName, 'default').height,
      fullScreen: false,
      maximize: false,
    });

    const mainWindow = this.createWindow(windowName, {
      x: mainWindowState.x,
      y: mainWindowState.y,
      width: mainWindowState.width,
      height: mainWindowState.height,
      minWidth: this.getWindowSize(windowName, 'min').width,
      minHeight: this.getWindowSize(windowName, 'min').height,
      show: false,
      autoHideMenuBar: true,
      transparent: false,
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      // For Windows and Linux, we use frameless window with custom controls
      // For Mac, we keep the native title bar style
      ...(isMacOS
        ? {
            titleBarStyle: 'hidden',
            titleBarOverlay: nativeTheme.shouldUseDarkColors ? titleBarOverlayDark : titleBarOverlayLight,
            trafficLightPosition: isMacOSTahoe ? { x: 8, y: 14 } : { x: 12, y: 14 },
          }
        : {
            frame: false, // Frameless window for Windows and Linux
          }),
      ...(isWindows22H2 ? { backgroundMaterial: 'mica' } : {}),
      ...(!isMacOS && !isWindows22H2
        ? { backgroundColor: nativeTheme.shouldUseDarkColors ? '#181818' : '#FFFFFF' }
        : {}),
      darkTheme: nativeTheme.shouldUseDarkColors,
    });

    mainWindowState.manage(mainWindow);

    this.setupWindowEvents(mainWindow);
    this.setupWebContentsHandlers(mainWindow);

    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
    });

    mainWindow.on('close', (event: Electron.Event) => {
      event.preventDefault();
      this.safeClose(mainWindow);

      if (!app.isQuitting) {
        const window = this.getWindow(WINDOW_NAME.MAIN);
        if (window && !window.isDestroyed()) {
          this.showWindow(window);
        } else {
          this.createMainWindow();
        }
      }
    });

    this.mouseTracker(mainWindow);

    if (!isPackaged && process.env.ELECTRON_RENDERER_URL) {
      mainWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/#/player`);
    } else {
      mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash: 'player' });
    }

    return mainWindow;
  }

  public createBrowserWindow(): BrowserWindow {
    const windowName = WINDOW_NAME.BROWSER;

    const mainWindowState = windowStateKeeper({
      path: APP_DATABASE_PATH,
      file: `${windowName}-window-state.json`,
      defaultWidth: this.getWindowSize(windowName, 'default').width,
      defaultHeight: this.getWindowSize(windowName, 'default').height,
      fullScreen: false,
      maximize: false,
    });

    const mainWindow = this.createWindow(windowName, {
      x: mainWindowState.x,
      y: mainWindowState.y,
      width: mainWindowState.width,
      height: mainWindowState.height,
      minWidth: this.getWindowSize(windowName, 'min').width,
      minHeight: this.getWindowSize(windowName, 'min').height,
      show: false,
      autoHideMenuBar: true,
      transparent: false,
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      // For Windows and Linux, we use frameless window with custom controls
      // For Mac, we keep the native title bar style
      ...(isMacOS
        ? {
            titleBarStyle: 'hidden',
            titleBarOverlay: nativeTheme.shouldUseDarkColors ? titleBarOverlayDark : titleBarOverlayLight,
            trafficLightPosition: isMacOSTahoe ? { x: 8, y: 14 } : { x: 12, y: 14 },
          }
        : {
            frame: false, // Frameless window for Windows and Linux
          }),
      ...(isWindows22H2 ? { backgroundMaterial: 'mica' } : {}),
      ...(!isMacOS && !isWindows22H2
        ? { backgroundColor: nativeTheme.shouldUseDarkColors ? '#181818' : '#FFFFFF' }
        : {}),
      darkTheme: nativeTheme.shouldUseDarkColors,
      webPreferences: {
        webviewTag: true,
      },
    });

    mainWindowState.manage(mainWindow);

    this.setupWindowEvents(mainWindow);
    this.setupWebContentsHandlers(mainWindow);

    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
    });

    mainWindow.on('close', (event: Electron.Event) => {
      event.preventDefault();
      this.safeClose(mainWindow);
    });

    if (!isPackaged && process.env.ELECTRON_RENDERER_URL) {
      mainWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/#/browser`);
    } else {
      mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash: 'browser' });
    }

    return mainWindow;
  }

  public createSnifferWindow(uuid: string): BrowserWindow {
    const mainWindow = this.createWindow(`${WINDOW_NAME.SNIFFER}-${uuid}`, {}, false);

    mainWindow.once('ready-to-show', () => {
      if (configManager.debug) {
        this.supportShowWindow.add(`${WINDOW_NAME.SNIFFER}-${uuid}`);
        mainWindow.show();
      }
    });

    mainWindow.once('close', () => {
      this.supportShowWindow.delete(`${WINDOW_NAME.SNIFFER}-${uuid}`);
    });

    return mainWindow;
  }

  public createSearchWindow(uuid: string): BrowserWindow {
    const mainWindow = this.createWindow(`${WINDOW_NAME.SEARCH}-${uuid}`, {}, false);
    mainWindow.webContents.userAgent = generateUserAgent();

    mainWindow.once('ready-to-show', () => {
      if (configManager.debug) {
        this.supportShowWindow.add(`${WINDOW_NAME.SEARCH}-${uuid}`);
        mainWindow.show();
      }
    });

    mainWindow.once('close', () => {
      this.supportShowWindow.delete(`${WINDOW_NAME.SEARCH}-${uuid}`);
    });

    return mainWindow;
  }
}

export const windowService = WindowService.getInstance();
