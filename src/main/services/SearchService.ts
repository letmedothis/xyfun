import { loggerService } from '@logger';
import { windowService } from '@main/services/WindowService';
import { getTimeout } from '@main/utils/tool';
import { LOG_MODULE } from '@shared/config/logger';
import { WINDOW_NAME } from '@shared/config/window';
import { isHttp } from '@shared/modules/validate';

const logger = loggerService.withContext(LOG_MODULE.SEARCH);

export class SearchService {
  private static instance: SearchService | null = null;

  public static getInstance(): SearchService {
    if (!SearchService.instance) {
      SearchService.instance = new SearchService();
    }
    return SearchService.instance;
  }

  public getWindowName(uid: string): string {
    return `${WINDOW_NAME.SEARCH}-${uid}`;
  }

  public async openSearchWindow(uid: string): Promise<void> {
    const windowName = this.getWindowName(uid);
    let mainWindow = windowService.getWindow(windowName);

    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = windowService.createSearchWindow(uid);
    }

    windowService.showWindow(mainWindow);
  }

  public async closeSearchWindow(uid: string): Promise<void> {
    const windowName = this.getWindowName(uid);
    const mainWindow = windowService.getWindow(windowName);

    if (mainWindow && !mainWindow.isDestroyed()) {
      windowService.closeWindow(mainWindow);
    }
  }

  public async openUrlInSearchWindow(uid: string, url: string, timeout?: number): Promise<any> {
    if (!isHttp(url)) throw new Error('Search URL must use HTTP or HTTPS');

    const windowName = this.getWindowName(uid);
    let mainWindow = windowService.getWindow(windowName);

    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = windowService.createSearchWindow(uid);
    }

    logger.debug(`Search url: ${url}`);
    try {
      let loadTimer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          mainWindow.loadURL(url),
          new Promise<never>((_, reject) => {
            loadTimer = setTimeout(() => reject(new Error('Search page load timed out')), getTimeout(timeout));
            loadTimer.unref();
          }),
        ]);
      } finally {
        if (loadTimer) clearTimeout(loadTimer);
      }
      // Give scripts scheduled immediately after page load a short time to update the DOM.
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.stop();
      logger.error(`Failed to load search URL: ${url}`, error as Error);
      return '';
    }

    // Get the page content after ensuring it's fully loaded
    try {
      if (mainWindow.isDestroyed()) return '';
      return await mainWindow.webContents.executeJavaScript('document.documentElement.outerHTML');
    } catch (error) {
      logger.error('Failed to read search page content', error as Error);
      return '';
    }
  }
}

export const searchService = SearchService.getInstance();
