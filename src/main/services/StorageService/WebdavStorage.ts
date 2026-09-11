import { posix } from 'node:path';
import type { Stream } from 'node:stream';

import { loggerService } from '@logger';
import { APP_NAME_ALIAS } from '@shared/config/appInfo';
import { LOG_MODULE } from '@shared/config/logger';
import { isHttp, isStrEmpty } from '@shared/modules/validate';
import type {
  BufferLike,
  CreateDirectoryOptions,
  GetFileContentsOptions,
  PutFileContentsOptions,
  WebDAVClient,
} from 'webdav';
import { createClient } from 'webdav';

export interface IWebdavConfig {
  url: string;
  username: string;
  password: string;
}

const logger = loggerService.withContext(LOG_MODULE.SYNC_STORAGE);

export class WebdavStorage {
  private readonly baseDirPath: string = `/${APP_NAME_ALIAS}`;
  private client: WebDAVClient | null = null;

  constructor() {}

  private getRemoteFilePath(filename: string): string {
    const remoteFilePath = posix.normalize(posix.join(this.baseDirPath, filename));
    if (remoteFilePath !== this.baseDirPath && !remoteFilePath.startsWith(`${this.baseDirPath}/`)) {
      throw new Error('Invalid WebDAV file path');
    }
    return remoteFilePath;
  }

  public initClient = async (config: IWebdavConfig): Promise<void> => {
    const { url, username, password } = config;

    if (!isHttp(url) || isStrEmpty(username) || isStrEmpty(password)) {
      logger.error('Invalid WebDAV configuration');
      throw new Error('Invalid WebDAV configuration');
    }

    try {
      this.client = createClient(url, {
        username,
        password,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
    } catch (error) {
      logger.error('Error initializing WebDAV client:', error as Error);
      throw error;
    }
  };

  public putFileContents = async (
    filename: string,
    data: string | BufferLike | Stream.Readable,
    options?: PutFileContentsOptions,
  ) => {
    if (!this.client) {
      return new Error('WebDAV client not initialized');
    }

    try {
      if (!(await this.client.exists(this.baseDirPath))) {
        await this.client.createDirectory(this.baseDirPath, {
          recursive: true,
        });
      }
    } catch (error) {
      logger.error('Error creating directory on WebDAV:', error as Error);
      throw error;
    }

    const remoteFilePath = this.getRemoteFilePath(filename);

    try {
      return await this.client.putFileContents(remoteFilePath, data, options);
    } catch (error) {
      logger.error('Error putting file contents on WebDAV:', error as Error);
      throw error;
    }
  };

  public getFileContents = async (filename: string, options?: GetFileContentsOptions) => {
    if (!this.client) {
      throw new Error('WebDAV client not initialized');
    }

    const remoteFilePath = this.getRemoteFilePath(filename);

    try {
      const fileExists = await this.client!.exists(remoteFilePath);
      if (!fileExists) {
        logger.error(`File does not exist on WebDAV: ${remoteFilePath}`);
        throw new Error('File does not exist on WebDAV');
      }

      return await this.client.getFileContents(remoteFilePath, options);
    } catch (error) {
      logger.error('Error getting file contents on WebDAV:', error as Error);
      throw error;
    }
  };

  public getDirectoryContents = async () => {
    if (!this.client) {
      throw new Error('WebDAV client not initialized');
    }

    try {
      return await this.client.getDirectoryContents(this.baseDirPath);
    } catch (error) {
      logger.error('Error getting directory contents on WebDAV:', error as Error);
      throw error;
    }
  };

  public checkConnection = async (): Promise<boolean> => {
    if (!this.client) {
      throw new Error('WebDAV client not initialized');
    }

    try {
      return await this.client.exists('/');
    } catch (error) {
      logger.error('Error checking connection:', error as Error);
      throw error;
    }
  };

  public createDirectory = async (path: string, options?: CreateDirectoryOptions) => {
    if (!this.client) {
      throw new Error('WebDAV client not initialized');
    }

    try {
      return await this.client.createDirectory(this.getRemoteFilePath(path), options);
    } catch (error) {
      logger.error('Error creating directory on WebDAV:', error as Error);
      throw error;
    }
  };

  public deleteFile = async (filename: string): Promise<void> => {
    if (!this.client) {
      throw new Error('WebDAV client not initialized');
    }

    const remoteFilePath = this.getRemoteFilePath(filename);

    try {
      return await this.client.deleteFile(remoteFilePath);
    } catch (error) {
      logger.error('Error deleting file on WebDAV:', error as Error);
      throw error;
    }
  };

  public disconnect(): void {
    this.client = null;
  }
}
