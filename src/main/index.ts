// don't reorder this file, it's used to initialize the app data dir and
// other which should be run before the main process is ready

import process from 'node:process';

import { electronApp, optimizer } from '@electron-toolkit/utils';
import { loggerService } from '@logger';
import { registerIpc } from '@main/ipc';
import { appLocale } from '@main/services/AppLocale';
import { configManager } from '@main/services/ConfigManager';
import { dbService } from '@main/services/DbService';
import { fastifyService } from '@main/services/FastifyService';
import {
  setup as filmCmsSetup,
  terminate as filmCmsTerminate,
} from '@main/services/FastifyService/routes/v1/film/cms/utils/cache';
import { fileStorage } from '@main/services/FileStorage';
import { menuService } from '@main/services/MenuService';
import { pluginService } from '@main/services/PluginService';
import { handleProtocolUrl, setupAppImageDeepLink } from '@main/services/ProtocolClient';
import { proxyManager } from '@main/services/ProxyManager';
import { trayService } from '@main/services/TrayService';
import { windowService } from '@main/services/WindowService';
import { isDev, isLinux, isMacOS, isWindows } from '@main/utils/systemInfo';
import { APP_NAME, APP_NAME_PROTOCOL } from '@shared/config/appInfo';
import { IPC_CHANNEL } from '@shared/config/ipcChannel';
import { LOG_MODULE } from '@shared/config/logger';
import { CacheService } from '@shared/modules/cache';
import { runFunction } from '@shared/modules/function';
import { isBoolean, isHttp } from '@shared/modules/validate';
import type { IAuthCacheProgress, IAuthCert, IAuthRelayPayload } from '@shared/types/auth';
import { app, BrowserWindow, crashReporter, ipcMain } from 'electron';
import installExtension, { VUEJS_DEVTOOLS } from 'electron-devtools-installer';
import fixPath from 'fix-path';

const logger = loggerService.withContext(LOG_MODULE.MAIN);

// enable local crash reports
crashReporter.start({
  productName: APP_NAME,
  submitURL: '',
  uploadToServer: false,
});

/**
 * Environment Variable Repair
 */
const setupEnv = () => {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'; // disable security warnings

  process.on('warning', (warning) => {
    logger.warn(`Capture Warning: ${warning.message}`);
  });

  // in production mode, handle uncaught exception and unhandled rejection globally
  if (!isDev) {
    // handle uncaught exception
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
    });

    // handle unhandled rejection
    process.on('unhandledRejection', (reason, promise) => {
      logger.error(`Unhandled Rejection at: ${promise} reason: ${reason}`);
    });
  }

  fixPath(); // fix environment
};

/**
 * Application Initialization Processing
 */
const setupApp = async () => {
  /**
   * Disable hardware acceleration if setting is enabled
   */
  const dbHardwareAcceleration = configManager.hardwareAcceleration;
  const disableHardwareAcceleration = isBoolean(dbHardwareAcceleration) ? !dbHardwareAcceleration : false;
  if (disableHardwareAcceleration) {
    app.disableHardwareAcceleration();
  }

  /**
   * Disable chromium's window animations
   * main purpose for this is to avoid the transparent window flashing when it is shown
   * (especially on Windows for SelectionAssistant Toolbar)
   * Know Issue: https://github.com/electron/electron/issues/12130#issuecomment-627198990
   */
  if (isWindows) {
    app.commandLine.appendSwitch('wm-window-animations-disabled');
  }

  /**
   * Enable GlobalShortcutsPortal for Linux Wayland Protocol
   * see: https://www.electronjs.org/docs/latest/api/global-shortcut
   */
  if (isLinux && process.env.XDG_SESSION_TYPE === 'wayland') {
    app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');
  }

  /**
   * Set window class and name for Linux
   * This ensures the window manager identifies the app correctly on both X11 and Wayland
   */
  if (isLinux) {
    app.commandLine.appendSwitch('class', APP_NAME);
    app.commandLine.appendSwitch('name', APP_NAME);
  }

  /**
   * Enable Chromium features
   * https://github.com/microsoft/vscode/pull/241640/files
   */
  const enableFeatures = [
    'DocumentPolicyIncludeJSCallStacksInCrashReports', // unresponsive renderer js call stacks
    'EarlyEstablishGpuChannel', // early establish gpu channel
    'EstablishGpuChannelAsync', // early establish gpu channel
    'PlatformHEVCDecoderSupport', // HEVC video decoding support
    'VaapiVideoDecoder', // VA-API video decoder
    'UseMultiPlaneFormatForHardwareVideo', // Fix frame pool issue
    'VaapiIgnoreDriverChecks', // Ignore driver compatibility check
    'CanvasOopRasterization', // Canvas OOP rasterization
  ];
  app.commandLine.appendSwitch('enable-features', enableFeatures.join(','));
  app.commandLine.appendSwitch('disable-http-cache'); // disable HTTP cache
};

/**
 * Application Ready Processing
 */
const setupReady = () => {
  app
    .whenReady()
    .then(async () => {
      // Set app user model id for windows
      electronApp.setAppUserModelId(import.meta.env.VITE_MAIN_BUNDLE_ID);

      // Set doh
      const hostResolver = configManager.dns;
      if (isHttp(hostResolver, true)) {
        logger.info(`Using secure dns: ${hostResolver}`);
        app.configureHostResolver({
          secureDnsMode: 'secure',
          secureDnsServers: [hostResolver],
        });
      }

      const mainWindow = windowService.createMainWindow();

      trayService.updateTray(true);
      menuService.updateMenu(true);

      registerIpc(mainWindow, app);

      // Setup deep link for AppImage on Linux
      await setupAppImageDeepLink();

      if (isDev) {
        installExtension([VUEJS_DEVTOOLS])
          .then(([...args]) => logger.info(`Added devtool extensions: ${args.map((arg) => arg.name).join(', ')}`))
          .catch((error) => logger.error('An error occurred: ', error));
      }
    })
    .catch((error) => {
      logger.error('Application ready initialization failed:', error as Error);
      app.quit();
    });

  app.on(
    'login',
    (
      event: Electron.Event,
      webContents: Electron.WebContents,
      request: Electron.AuthenticationResponseDetails,
      authInfo: Electron.AuthInfo,
      callback,
    ) => {
      if (authInfo.isProxy || authInfo.scheme !== 'basic') return;
      event.preventDefault();

      const url = request.url;
      const key = `${authInfo.scheme}:${authInfo.host}:${authInfo.port}:${authInfo.realm}`;
      // Keep pending credentials separate for concurrent windows requesting the same realm.
      const progressKey = `login-progress:${key}:${webContents.id}`;
      const authKey = `login-auth:${key}`;
      const attemptKey = `login-attempt:${key}`;

      logger.info(`Received login request for ${url}`);

      // If caching has been tried before, it means that caching is wrong
      if (CacheService.has(attemptKey)) {
        CacheService.remove(authKey);
        CacheService.remove(attemptKey);
      }

      // Try cache
      if (CacheService.has(authKey)) {
        const { username, password } = CacheService.get<IAuthCert>(authKey)!;
        CacheService.set(attemptKey, true); // Mark cache attempt
        callback(username, password);
        return;
      }

      CacheService.set(progressKey, { callback, webContentsId: webContents.id, url }); // Store current auth context

      const mainWindow = BrowserWindow.fromWebContents(webContents);
      if (!mainWindow || mainWindow.isDestroyed()) {
        CacheService.remove(progressKey);
        callback('', '');
        return;
      }
      mainWindow.webContents.send(IPC_CHANNEL.LOGIN_BASIC, { authInfo, webContentsId: webContents.id, url });
      // webContents.send(IPC_CHANNEL.LOGIN_BASIC, { authInfo, webContentsId: webContents.id, url });

      const relayHandler = (_: Electron.IpcMainEvent, payload: IAuthRelayPayload) => {
        if (!payload?.authInfo || !payload?.authCert || !Number.isInteger(payload.webContentsId)) return;
        const { authInfo, authCert, webContentsId } = payload;
        const { username, password } = authCert;
        if (typeof username !== 'string' || typeof password !== 'string') return;

        const payloadKey = `${authInfo.scheme}:${authInfo.host}:${authInfo.port}:${authInfo.realm}`;
        if (payloadKey !== key || webContentsId !== webContents.id) return;

        const relayProgressKey = `login-progress:${payloadKey}:${webContentsId}`;
        const progress = CacheService.get<IAuthCacheProgress>(relayProgressKey);

        if (!progress || progress.webContentsId !== webContents.id) return;

        ipcMain.removeListener(IPC_CHANNEL.LOGIN_BASIC_RELAY, relayHandler);
        progress.callback(username, password); // Callback auth
        CacheService.set(`login-auth:${payloadKey}`, { username, password }); // Set auth cache

        CacheService.remove(relayProgressKey); // Clean progress cache
      };
      ipcMain.on(IPC_CHANNEL.LOGIN_BASIC_RELAY, relayHandler);

      // Never leave Chromium authentication requests pending indefinitely.
      setTimeout(() => {
        const pending = CacheService.get<IAuthCacheProgress>(progressKey);
        if (!pending) return;
        ipcMain.removeListener(IPC_CHANNEL.LOGIN_BASIC_RELAY, relayHandler);
        CacheService.remove(progressKey);
        pending.callback('', '');
      }, 60_000).unref();
    },
  );

  app.on('web-contents-created', (_, webContents) => {
    webContents.on('unresponsive', async () => {
      // Interrupt execution and collect call stack from unresponsive renderer
      logger.error('Renderer unresponsive start');
      try {
        const callStack = await webContents.mainFrame.collectJavaScriptCallStack();
        logger.error(`Renderer unresponsive js call stack\n ${callStack}`);
      } catch (error) {
        // The renderer may be destroyed while the stack is being collected.
        logger.warn('Failed to collect renderer call stack', error as Error);
      }
    });
  });

  app.on('activate', () => {
    const windowNames = windowService.getAllNames();
    if (windowNames.length === 0) {
      windowService.createMainWindow();
    } else {
      windowService.showAllWindows();
    }
  });

  app.on('window-all-closed', () => {
    if (!isMacOS) app.quit();
  });

  // macOS specific: handle protocol when app is already running
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleProtocolUrl(url);
  });

  const handleOpenUrl = (args: string[]) => {
    const url = args.find((arg) => arg.startsWith(APP_NAME_PROTOCOL));
    if (url) handleProtocolUrl(url);
  };

  // for windows to start with url
  handleOpenUrl(process.argv);

  // Listen for second instance
  app.on('second-instance', (_event, argv) => {
    windowService.showAllWindows();

    // Protocol handler for Windows/Linux
    // The commandLine is an array of strings where the last item might be the URL
    handleOpenUrl(argv);
  });

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
  });

  let shutdownStarted = false;
  app.on('will-quit', (e: Electron.Event) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    e.preventDefault();

    const runCleanup = async (name: string, cleanup: () => Promise<unknown>, timeoutMs = 10_000) => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          cleanup(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${name} cleanup timed out`)), timeoutMs);
            timer.unref();
          }),
        ]);
      } catch (error) {
        logger.error(`${name} cleanup failed`, error as Error);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    void (async () => {
      try {
        await runCleanup('Film CMS', filmCmsTerminate);
        await runCleanup('Fastify', () => fastifyService.stop());
        await runCleanup('Plugin', () => pluginService.clean());
      } finally {
        logger.finish();
        app.exit(0);
      }
    })();
  });

  // In this file you can include the rest of your app"s specific main process
  // code. You can also put them in separate files and require them here.
};

const main = async () => {
  setupEnv();
  await setupApp();

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
  } else {
    await fileStorage.initRequireDir();
    await dbService.init();
    await proxyManager.configureProxy(configManager.proxy);
    const fastifyStarted = await fastifyService.start();
    if (!fastifyStarted) logger.error('Fastify service failed to start; API features are unavailable');

    appLocale.init();
    setupReady();

    runFunction(() => {
      filmCmsSetup();
      pluginService.autoLaunch();
    });
  }
};

main().catch((error) => {
  logger.error('Application startup failed:', error as Error);
  if (app.isReady()) app.quit();
  else process.exitCode = 1;
});
