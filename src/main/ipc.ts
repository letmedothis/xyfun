import type { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { loggerService } from '@logger';
import { appLocale } from '@main/services/AppLocale';
import { appService } from '@main/services/AppService';
import AppUpdater from '@main/services/AppUpdater';
import { binaryService } from '@main/services/BinaryService';
import { fastifyService } from '@main/services/FastifyService';
import { fileStorage } from '@main/services/FileStorage';
import { menuService } from '@main/services/MenuService';
import NotificationService from '@main/services/NotificationService';
import { pluginService } from '@main/services/PluginService';
import { proxyManager } from '@main/services/ProxyManager';
import { shortcutService } from '@main/services/ShortcutService';
import { trayService } from '@main/services/TrayService';
import { windowService } from '@main/services/WindowService';
import {
  createDir,
  fileDelete,
  pathExist,
  readDirFaster,
  readFile,
  resolveWithinPath,
  saveFile,
} from '@main/utils/file';
import type { IHomePath, ISystemPath, IUserPath } from '@main/utils/path';
import {
  APP_DATABASE_PATH,
  APP_FILE_PATH,
  APP_LOG_PATH,
  APP_PLUGIN_PATH,
  APP_STORE_PATH,
  APP_TEMP_PATH,
  getHomePath,
  getSystemPath,
  getUserPath,
  HOME_BIN_PATH,
} from '@main/utils/path';
import { execAsync } from '@main/utils/shell';
import { arch, generateUserAgent, isLinux, isMacOS, isPortable, isWindows, platform } from '@main/utils/systemInfo';
import { IPC_CHANNEL } from '@shared/config/ipcChannel';
import { LOG_MODULE } from '@shared/config/logger';
import type { INotification } from '@shared/config/notification';
import type { IProxyType } from '@shared/config/setting';
import { PROXY_TYPE } from '@shared/config/setting';
import type { IShortcutConfig, IShortcutType } from '@shared/config/shortcut';
import { WINDOW_NAME } from '@shared/config/window';
import type { ILang } from '@shared/locales';
import { isFile, isHttp, isObject, isPositiveFiniteNumber, isSecurityScheme } from '@shared/modules/validate';
import type { ProxyConfig } from 'electron';
import { BrowserWindow, ipcMain as electronIpcMain, shell, webContents } from 'electron';

const logger = loggerService.withContext(LOG_MODULE.APP_IPC);

export function registerIpc(mainWindow: BrowserWindow, app: Electron.App) {
  const getSenderWindow = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window && !window.isDestroyed() ? window : null;
  };

  const isTrustedSender = (event: Electron.IpcMainInvokeEvent): boolean => {
    const senderWindow = getSenderWindow(event);
    if (!senderWindow) return false;

    const senderUrl = event.senderFrame?.url;
    if (!senderUrl) return false;
    if (senderUrl.startsWith('file:')) return true;

    if (process.env.ELECTRON_RENDERER_URL) {
      try {
        return new URL(senderUrl).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin;
      } catch {
        return false;
      }
    }

    return false;
  };

  const ipcMain = {
    handle(channel: string, listener: (...args: any[]) => unknown) {
      electronIpcMain.handle(channel, (event, ...args) => {
        if (!isTrustedSender(event)) {
          logger.warn(`Rejected IPC request from an untrusted sender: ${channel}`);
          return;
        }
        return listener(event, ...args);
      });
    },
  };

  const ALLOWED_FS_PATHS = [
    APP_STORE_PATH,
    APP_FILE_PATH,
    APP_DATABASE_PATH,
    APP_PLUGIN_PATH,
    APP_TEMP_PATH,
    APP_LOG_PATH,
    HOME_BIN_PATH,
  ];

  // Paths the user explicitly chose through a native dialog. The FS handlers
  // also back user-selected files outside the app directories, so those picks
  // are granted for the remainder of the session.
  const userGrantedPaths = new Set<string>();

  const grantUserPath = (filePath?: string | null): void => {
    if (typeof filePath !== 'string' || filePath.length === 0) return;
    userGrantedPaths.add(path.resolve(filePath));
  };

  const isPathAllowed = (filePath: string): boolean => {
    if (ALLOWED_FS_PATHS.some((allowed) => resolveWithinPath(allowed, filePath) !== null)) return true;
    for (const granted of userGrantedPaths) {
      if (resolveWithinPath(granted, filePath) !== null) return true;
    }
    return false;
  };

  const getOwnedWebview = (event: Electron.IpcMainInvokeEvent, webviewId: number): Electron.WebContents | null => {
    if (!isTrustedSender(event) || !Number.isInteger(webviewId)) return null;
    const webview = webContents.fromId(webviewId);
    return webview?.hostWebContents?.id === event.sender.id ? webview : null;
  };

  const appUpdater = new AppUpdater(mainWindow);

  // api
  ipcMain.handle(IPC_CHANNEL.API_SERVER_START, async () => {
    return await fastifyService.start();
  });

  ipcMain.handle(IPC_CHANNEL.API_SERVER_STOP, async () => {
    return await fastifyService.stop();
  });

  ipcMain.handle(IPC_CHANNEL.API_SERVER_RESTART, async () => {
    return await fastifyService.restart();
  });

  ipcMain.handle(IPC_CHANNEL.API_SERVER_STATUS, () => {
    return fastifyService.status();
  });

  // app
  ipcMain.handle(IPC_CHANNEL.APP_AUTO_LAUNCH, (_, isLaunchOnBoot: boolean) => {
    appService.setAppLaunchOnBoot(isLaunchOnBoot);
  });

  ipcMain.handle(IPC_CHANNEL.APP_DNS, (_, dns: string) => {
    if (isHttp(dns, true)) {
      logger.info(`Set DNS to ${dns}`);
      app.configureHostResolver({
        secureDnsMode: 'secure',
        secureDnsServers: [dns],
      });
    } else {
      app.configureHostResolver({ secureDnsMode: 'off' });
    }
  });

  ipcMain.handle(IPC_CHANNEL.APP_QUIT, () => {
    app.quit();
  });

  ipcMain.handle(IPC_CHANNEL.APP_REBOOT, (_, options?: Electron.RelaunchOptions) => {
    // Fix for .AppImage
    if (isLinux && process.env.APPIMAGE) {
      logger.info(`Relaunching app with options: ${process.env.APPIMAGE}`, options);
      // On Linux, we need to use the APPIMAGE environment variable to relaunch
      // https://github.com/electron-userland/electron-builder/issues/1727#issuecomment-769896927
      options = options || {};
      options.execPath = process.env.APPIMAGE;
      options.args = options.args || [];
      options.args.unshift('--appimage-extract-and-run');
    }
    if (isWindows && isPortable) {
      options = options || {};
      options.execPath = process.env.PORTABLE_EXECUTABLE_FILE;
      options.args = options.args || [];
    }
    app.relaunch(options);
    app.exit(0);
  });

  ipcMain.handle(IPC_CHANNEL.APP_PROXY, async (_, type: IProxyType, proxy?: string, bypass?: string) => {
    let proxyConfig: ProxyConfig;

    if (type === PROXY_TYPE.SYSTEM) {
      // system proxy will use the system filter by themselves
      proxyConfig = { mode: 'system' };
    } else if (proxy) {
      proxyConfig = { mode: 'fixed_servers', proxyRules: proxy, proxyBypassRules: bypass };
    } else {
      proxyConfig = { mode: 'direct' };
    }

    await proxyManager.configureProxy(proxyConfig);
  });

  ipcMain.handle(IPC_CHANNEL.APP_PROXY_SYSTEM, () => {
    if (platform === 'win32') shell.openExternal('ms-settings:network-proxy');
    if (platform === 'darwin') shell.openExternal('x-apple.systempreferences:com.apple.preference.network?Proxies');
    if (platform === 'linux') execAsync('gnome-control-center network'); // xdg-open settings://network
  });

  // binary
  ipcMain.handle(IPC_CHANNEL.BINARY_INSTALL, async (_, binaryName: string[]) => {
    return await binaryService.installBinary(binaryName);
  });

  // business
  const ALLOWED_PLAYER_NAMES = new Set([
    'vlc',
    'mpv',
    'iina',
    'potplayer',
    'potplayermini',
    'potplayermini64',
    'smplayer',
    'celluloid',
    'haruna',
    'kmp',
    'kmplayer',
    'mplayer',
    'ffplay',
    'mpc-hc',
    'mpc-hc64',
    'mpc-be',
    'mpc-be64',
    'daum',
    'gom',
    'nplayer',
    'infuse',
    'elmedia',
    'quicktime player',
    'windows media player',
  ]);

  const isAllowedPlayer = (appPath: string): boolean => {
    const name = path.basename(appPath, path.extname(appPath)).toLowerCase();
    return ALLOWED_PLAYER_NAMES.has(name);
  };

  ipcMain.handle(IPC_CHANNEL.CALL_PLAYER, async (_, app: string, url: string) => {
    if (!url || !app) return false;
    if (!isHttp(url) && !(await pathExist(url))) return false;

    const executable = app.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!isAllowedPlayer(executable)) {
      logger.warn(`Rejected CALL_PLAYER with untrusted executable: ${executable}`);
      return false;
    }

    try {
      if (windowService.getWindow(WINDOW_NAME.PLAYER)) {
        windowService.closeWindow(WINDOW_NAME.PLAYER);
      }

      // Windows: "C:\Program Files\VLC\vlc.exe" "C:\Video\1.mp4"
      // Linux: "/usr/bin/vlc" "http://..."
      // Mac: open -a "/Applications/IINA.app" "http://..."
      const executable = app.trim().replace(/^(['"])(.*)\1$/, '$2');
      const args = isMacOS ? ['-a', executable, url] : [url];
      const command = isMacOS ? 'open' : executable;

      return await new Promise<boolean>((resolve) => {
        const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
        child.once('spawn', () => {
          child.unref();
          resolve(true);
        });
        child.once('error', (error) => {
          logger.error('Failed to call player:', error);
          resolve(false);
        });
      });
    } catch (error) {
      logger.error(`Failed to call player:`, error as Error);
      return false;
    }
  });

  // change
  ipcMain.handle(IPC_CHANNEL.CHANGE_LANG, async (_, lang: ILang) => {
    appLocale.changeLocale(lang);

    menuService.updateMenu(true);
    trayService.updateTray(true);
  });

  ipcMain.handle(IPC_CHANNEL.CHANGE_ZOOM, (_, zoom: number) => {
    windowService.setZoomWindows(zoom);
  });

  // file
  ipcMain.handle(IPC_CHANNEL.FILE_SELECT_FOLDER_DIALOG, async (_, options?: Electron.OpenDialogOptions) => {
    const paths = await fileStorage.selectFolderDialog(options);
    paths.forEach(grantUserPath);
    return paths;
  });

  ipcMain.handle(IPC_CHANNEL.FILE_SELECT_FILE_DIALOG, async (_, options?: Electron.OpenDialogOptions) => {
    const paths = await fileStorage.selectFileDialog(options);
    paths.forEach(grantUserPath);
    return paths;
  });

  ipcMain.handle(IPC_CHANNEL.FILE_SAVE_FILE_DIALOG, async (_, options?: Electron.SaveDialogOptions) => {
    const filePath = await fileStorage.saveFileDialog(options);
    grantUserPath(filePath);
    return filePath;
  });

  ipcMain.handle(IPC_CHANNEL.FILE_SELECT_FOLDER_READ, async (_, options?: Electron.OpenDialogOptions) => {
    const result = await fileStorage.selectFileRead(options);
    grantUserPath(result.path);
    return result;
  });

  ipcMain.handle(
    IPC_CHANNEL.FILE_SELECT_FILE_WRITE,
    async (_, content: string | Buffer, options?: Electron.SaveDialogOptions) => {
      const result = await fileStorage.selectFolderWrite(content, options);
      grantUserPath(result.path);
      return result;
    },
  );

  // fs
  ipcMain.handle(IPC_CHANNEL.FS_EXIST, async (event, path: string) => {
    if (!isTrustedSender(event)) return false;
    if (!isPathAllowed(path)) return false;
    return await pathExist(path);
  });

  ipcMain.handle(IPC_CHANNEL.FS_DELETE, async (event, path: string) => {
    if (!isTrustedSender(event)) return false;
    if (!isPathAllowed(path)) return false;
    return await fileDelete(path);
  });

  ipcMain.handle(IPC_CHANNEL.FS_FILE_READ, async (event, path: string, encoding: BufferEncoding = 'utf-8') => {
    if (!isTrustedSender(event)) return null;
    if (!isPathAllowed(path)) return null;
    return await readFile(path, encoding);
  });

  ipcMain.handle(
    IPC_CHANNEL.FS_FILE_WRITE,
    async (event, path: string, data: string | Buffer, encoding: BufferEncoding = 'utf-8') => {
      if (!isTrustedSender(event)) return false;
      if (!isPathAllowed(path)) return false;
      return await saveFile(path, data, encoding);
    },
  );

  ipcMain.handle(IPC_CHANNEL.FS_DIR_READ, async (event, path: string, depth: number = 0, exclude?, include?) => {
    if (!isTrustedSender(event)) return [];
    if (!isPathAllowed(path)) return [];
    return await readDirFaster(path, depth, exclude, include);
  });

  ipcMain.handle(IPC_CHANNEL.FS_DIR_CREATE, async (event, path: string) => {
    if (!isTrustedSender(event)) return false;
    if (!isPathAllowed(path)) return false;
    return await createDir(path);
  });

  // notification
  ipcMain.handle(
    IPC_CHANNEL.NOTIFICATION_SEND,
    async (event: Electron.IpcMainInvokeEvent, notification: INotification) => {
      const win = getSenderWindow(event);
      if (!win) return false;
      const notificationService = new NotificationService(win);
      await notificationService.sendNotification(notification);
      return true;
    },
  );

  // open
  ipcMain.handle(IPC_CHANNEL.OPEN_PATH, (event, path: string) => {
    if (!isTrustedSender(event)) return;
    if (!isPathAllowed(path)) return;
    shell.openPath(path);
  });

  ipcMain.handle(IPC_CHANNEL.OPEN_WEBSITE, (_, url: string) => {
    if (!isSecurityScheme(url)) return;
    shell.openExternal(url);
  });

  // path
  ipcMain.handle(IPC_CHANNEL.PATH_RESOLVE, (event, ...paths: string[]) => {
    if (!isTrustedSender(event)) return '';
    return path.resolve(...paths);
  });

  ipcMain.handle(IPC_CHANNEL.PATH_JOIN, (event, ...paths: string[]) => {
    if (!isTrustedSender(event)) return '';
    return path.join(...paths);
  });

  ipcMain.handle(IPC_CHANNEL.PATH_SYSTEM, (_, name: ISystemPath) => {
    return getSystemPath(name);
  });

  ipcMain.handle(IPC_CHANNEL.PATH_HOME, (_, name: IHomePath) => {
    return getHomePath(name);
  });

  ipcMain.handle(IPC_CHANNEL.PATH_USER, (_, name: IUserPath) => {
    return getUserPath(name);
  });

  // plugin
  ipcMain.handle(IPC_CHANNEL.PLUGIN_INSTALL, async (_, plugins: string[]) => {
    return await pluginService.install(plugins);
  });

  ipcMain.handle(IPC_CHANNEL.PLUGIN_UNINSTALL, async (_, plugins: string[]) => {
    return await pluginService.uninstall(plugins);
  });

  ipcMain.handle(IPC_CHANNEL.PLUGIN_START, async (_, plugins: string[]) => {
    return await pluginService.start(plugins);
  });

  ipcMain.handle(IPC_CHANNEL.PLUGIN_STOP, async (_, plugins: string[]) => {
    return await pluginService.stop(plugins);
  });

  // shortcut
  ipcMain.handle(IPC_CHANNEL.SHORTCUTS_IS_REGISTERD, (_, type: IShortcutType, id: string, winName?: string) => {
    return shortcutService.isRegistered(type, id, winName);
  });

  ipcMain.handle(IPC_CHANNEL.SHORTCUT_REGISTER, (_, id: string, config: IShortcutConfig, force: boolean) => {
    return shortcutService.register(id, config, force);
  });

  ipcMain.handle(IPC_CHANNEL.SHORTCUT_UNREGISTER, (_, type: IShortcutType, id: string, winName?: string) => {
    return shortcutService.unregister(type, id, winName);
  });

  ipcMain.handle(IPC_CHANNEL.SHORTCUT_CLEAR, () => {
    shortcutService.clear();
  });

  // system
  ipcMain.handle(IPC_CHANNEL.SYSTEM_ARCH, () => {
    return arch;
  });

  ipcMain.handle(IPC_CHANNEL.SYSTEM_PLATFORM, () => {
    return platform;
  });

  // update
  ipcMain.handle(IPC_CHANNEL.UPDATE_CHECK, async () => {
    return await appUpdater.checkForUpdates();
  });

  ipcMain.handle(IPC_CHANNEL.UPDATE_INSTALL, async () => {
    await appUpdater.install();
  });

  ipcMain.handle(IPC_CHANNEL.UPDATE_DOWNLOAD, async (_, status: boolean) => {
    if (status) await appUpdater.startDownload();
    else await appUpdater.cancelDownload();
  });

  // webview
  ipcMain.handle(IPC_CHANNEL.WEBVIEW_SPELL_CHECK, (event, webviewId: number, mode: 1 | 2) => {
    const webview = getOwnedWebview(event, webviewId);
    if (!webview) return;

    if (isPositiveFiniteNumber(mode)) {
      if (mode === 1) webview.session.setSpellCheckerEnabled(true);
      else if (mode === 2) webview.session.setSpellCheckerEnabled(false);
    }

    return webview.session.isSpellCheckerEnabled();
  });

  ipcMain.handle(
    IPC_CHANNEL.WEBVIEW_LINK_BLOCK,
    (event: Electron.IpcMainInvokeEvent, webviewId: number, mode: 1 | 2) => {
      const webview = getOwnedWebview(event, webviewId);
      if (!webview) return;

      if (isPositiveFiniteNumber(mode)) {
        if (mode === 1) {
          webview.setWindowOpenHandler(({ url }) => {
            const mainWindow = getSenderWindow(event);
            if (mainWindow) mainWindow.webContents.send(IPC_CHANNEL.WEBVIEW_LINK_BLOCK_RELAY, url);
            return { action: 'deny' };
          });
        } else if (mode === 2) {
          webview.setWindowOpenHandler(() => {
            return { action: 'allow' };
          });
        }
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNEL.WEBVIEW_HEADER_BLOCK,
    (event, webviewId: number, rawUrl: string, headers?: Record<string, any>) => {
      const webview = getOwnedWebview(event, webviewId);
      if (!webview) return;

      windowService.setWebviewHeaderRule(
        webviewId,
        typeof rawUrl === 'string' ? rawUrl : '',
        isObject(headers) ? headers : undefined,
      );

      const defaultUA = generateUserAgent();
      webview.setUserAgent(defaultUA);

      webview.once('destroyed', () => windowService.clearWebviewHeaderRule(webviewId));
    },
  );

  // window
  ipcMain.handle(IPC_CHANNEL.WINDOW_SIZE, (event: Electron.IpcMainInvokeEvent, width: number, height: number) => {
    const win = getSenderWindow(event);
    if (!win) return [];

    if (isPositiveFiniteNumber(width) && isPositiveFiniteNumber(height)) {
      win.setSize(
        Math.min(Math.max(Math.round(width), 100), 10000),
        Math.min(Math.max(Math.round(height), 100), 10000),
      );
    }

    return win.getSize();
  });

  ipcMain.handle(IPC_CHANNEL.WINDOW_PIN, (event: Electron.IpcMainInvokeEvent, mode: 0 | 1 | 2) => {
    const win = getSenderWindow(event);
    if (!win) return false;

    if (isPositiveFiniteNumber(mode)) {
      if (mode === 0) win.setAlwaysOnTop(!win.isAlwaysOnTop());
      else if (mode === 1) win.setAlwaysOnTop(true);
      else if (mode === 2) win.setAlwaysOnTop(false);
    }

    return win.isAlwaysOnTop();
  });

  ipcMain.handle(IPC_CHANNEL.WINDOW_CLOSE, (event: Electron.IpcMainInvokeEvent, mode: 1) => {
    const win = getSenderWindow(event);
    if (!win) return false;

    if (isPositiveFiniteNumber(mode)) {
      if (mode === 1 && win.isClosable()) win.close();
    }

    return !win.isClosable();
  });

  ipcMain.handle(IPC_CHANNEL.WINDOW_MIN, (event: Electron.IpcMainInvokeEvent, mode: 0 | 1 | 2) => {
    const win = getSenderWindow(event);
    if (!win) return false;

    if (isPositiveFiniteNumber(mode)) {
      if (mode === 0) {
        win.isMinimized() ? win.restore() : win.minimize();
      } else if (mode === 1 && !win.isMinimized()) {
        win.minimize();
      } else if (mode === 2 && win.isMinimized()) {
        win.restore();
      }
    }

    return win.isMinimized();
  });

  ipcMain.handle(IPC_CHANNEL.WINDOW_MAX, (event: Electron.IpcMainInvokeEvent, mode: 0 | 1 | 2) => {
    const win = getSenderWindow(event);
    if (!win) return false;

    if (!win.isResizable()) return win.isMaximized();

    if (isPositiveFiniteNumber(mode)) {
      if (mode === 0) {
        win.isMaximized() ? win.unmaximize() : win.maximize();
      } else if (mode === 1 && !win.isMaximized()) {
        win.maximize();
      } else if (mode === 2 && win.isMaximized()) {
        win.unmaximize();
      }
    }

    return win.isMaximized();
  });

  ipcMain.handle(
    IPC_CHANNEL.WINDOW_POSITION,
    (
      event: Electron.IpcMainInvokeEvent,
      mode: 'relative' | 'absolute',
      position: { dx?: number; dy?: number } = {},
    ) => {
      const { dx, dy } = position;
      const win = getSenderWindow(event);
      if (!win || typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx) || !Number.isFinite(dy))
        return [];

      const [x, y] = win.getPosition();
      const safeDx = Math.min(Math.max(Math.round(dx), -100000), 100000);
      const safeDy = Math.min(Math.max(Math.round(dy), -100000), 100000);

      if (mode === 'absolute') win.setPosition(safeDx, safeDy);
      else if (mode === 'relative') win.setPosition(x + safeDx, y + safeDy);

      return win.getPosition();
    },
  );

  ipcMain.handle(IPC_CHANNEL.WINDOW_DESTROY, (event, name: string) => {
    if (!isTrustedSender(event)) return;
    const window = windowService.getWindow(name);
    if (window && !window.isDestroyed()) {
      windowService.closeWindow(window);
    }
  });

  ipcMain.handle(IPC_CHANNEL.WINDOW_HIDE, (event, name: string) => {
    if (!isTrustedSender(event)) return;
    const window = windowService.getWindow(name);
    if (window && !window.isDestroyed()) {
      windowService.hideWindow(window);
    }
  });

  ipcMain.handle(IPC_CHANNEL.WINDOW_SHOW, (event, name: string) => {
    if (!isTrustedSender(event)) return;
    const window = windowService.getWindow(name);
    if (window && !window.isDestroyed()) {
      windowService.showWindow(window);
    }
  });

  ipcMain.handle(IPC_CHANNEL.WINDOW_STATUS, (_, name: string) => {
    const window = windowService.getWindow(name);
    return !!window;

    // const window = windowService.getWindowName(name);
    // return !!window;
  });

  ipcMain.handle(IPC_CHANNEL.WINDOW_PLAYER, () => {
    const window = windowService.getWindow(WINDOW_NAME.PLAYER);
    if (window && !window.isDestroyed()) {
      windowService.showWindow(window);
      windowService.reloadWindow(window);
    } else {
      windowService.createPlayerWindow();
    }
  });

  ipcMain.handle(IPC_CHANNEL.WINDOW_MAIN, () => {
    const window = windowService.getWindow(WINDOW_NAME.MAIN);
    if (window && !window.isDestroyed()) {
      windowService.showWindow(window);
    } else {
      windowService.createMainWindow();
    }
  });

  ipcMain.handle(
    IPC_CHANNEL.WINDOW_BROWSER,
    (_event: Electron.IpcMainInvokeEvent, url: string, headers?: Record<string, any>) => {
      if (!isHttp(url) && !isFile(url)) return;

      let mainWindow = windowService.getWindow(WINDOW_NAME.BROWSER);
      if (mainWindow && !mainWindow.isDestroyed()) {
        windowService.showWindow(mainWindow);
        mainWindow.webContents.send(IPC_CHANNEL.BROWSER_NAVIGATE, url, headers);
      } else {
        mainWindow = windowService.createBrowserWindow();
        mainWindow.webContents.once('did-stop-loading', () => {
          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(IPC_CHANNEL.BROWSER_NAVIGATE, url, headers);
            }
          }, 1000);
        });
      }
    },
  );
}
