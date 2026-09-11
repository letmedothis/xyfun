import type { Buffer } from 'node:buffer';
import { dirname, join } from 'node:path';

import { loggerService } from '@logger';
import {
  createDir,
  fileDelete,
  pathExist,
  readDirFaster,
  readFile,
  resolveWithinPath,
  saveFile,
} from '@main/utils/file';
import { APP_HOME_PATH } from '@main/utils/path';
import { isMacOS } from '@main/utils/systemInfo';
import { APP_NAME_ALIAS } from '@shared/config/appInfo';
import { LOG_MODULE } from '@shared/config/logger';

const logger = loggerService.withContext(LOG_MODULE.SYNC_STORAGE);

export class ICloudStorage {
  private readonly icloudRootPath = join(APP_HOME_PATH, 'Library/Mobile Documents/com~apple~CloudDocs');
  private readonly baseDirPath: string = `${this.icloudRootPath}/${APP_NAME_ALIAS}`;

  constructor() {}

  private getLocalFilePath(filename: string): string {
    const filePath = resolveWithinPath(this.baseDirPath, filename);
    if (!filePath) throw new Error('Invalid iCloud file path');
    return filePath;
  }

  public ensureIcloudReady = async (): Promise<void> => {
    if (!isMacOS) {
      throw new Error('iCloud storage is only supported on macOS');
    }

    if (!(await pathExist(this.icloudRootPath))) {
      throw new Error('iCloud Drive is not enabled or not available');
    }

    if (!(await pathExist(this.baseDirPath))) {
      await createDir(this.baseDirPath);
    }
  };

  public putFileContents = async (filename: string, data: string | Buffer) => {
    await this.ensureIcloudReady();

    const remoteFilePath = this.getLocalFilePath(filename);
    const remoteFileDirPath = dirname(remoteFilePath);

    try {
      if (!(await pathExist(remoteFileDirPath))) {
        await createDir(remoteFileDirPath);
      }

      return await saveFile(remoteFilePath, data);
    } catch (error) {
      logger.error('Error putting file contents:', error as Error);
      throw error;
    }
  };

  public getFileContents = async (filename: string, options?) => {
    await this.ensureIcloudReady();

    const remoteFilePath = this.getLocalFilePath(filename);

    try {
      const fileExists = await pathExist(remoteFilePath);
      if (!fileExists) {
        logger.error(`File does not exist: ${remoteFilePath}`);
        throw new Error('File does not exist');
      }

      return await readFile(remoteFilePath, options);
    } catch (error) {
      logger.error('Error getting file contents:', error as Error);
      throw error;
    }
  };

  public getDirectoryContents = async (depth = 1) => {
    await this.ensureIcloudReady();

    try {
      return await readDirFaster(this.baseDirPath, depth);
    } catch (error) {
      logger.error('Error getting directory contents:', error as Error);
      throw error;
    }
  };

  public createDirectory = async (path: string) => {
    await this.ensureIcloudReady();

    const remoteFilePath = this.getLocalFilePath(path);

    try {
      return await createDir(remoteFilePath);
    } catch (error) {
      logger.error('Error creating directory:', error as Error);
      throw error;
    }
  };

  public deleteFile = async (filename: string) => {
    await this.ensureIcloudReady();

    const remoteFilePath = this.getLocalFilePath(filename);

    try {
      return await fileDelete(remoteFilePath);
    } catch (error) {
      logger.error('Error deleting file:', error as Error);
      throw error;
    }
  };
}
