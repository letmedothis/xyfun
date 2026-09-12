import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:os', () => {
  const os = {
    arch: vi.fn(() => 'x64'),
    cpus: vi.fn(() => [{ model: 'Mock CPU' }]),
    platform: vi.fn(() => 'darwin'),
    release: vi.fn(() => '24.0.0'),
    totalmem: vi.fn(() => 8 * 1024 * 1024 * 1024),
    version: vi.fn(() => '24.0.0'),
  };
  return { ...os, default: os };
});
vi.mock('@main/services/ConfigManager', () => ({ configManager: { set: vi.fn() }, STORE_KEYS: [] }));
vi.mock('@main/services/StorageService', () => ({ ICloudStorage: class {}, WebdavStorage: class {} }));
vi.mock('@main/utils/path', () => ({ APP_DATABASE_PATH: '/mock/database' }));

import { DbService } from '../DbService';

describe('database watcher synchronization', () => {
  const service = DbService.getInstance() as any;

  afterEach(() => {
    vi.restoreAllMocks();
    service.watcherDirty = false;
    service.watcherSyncing = false;
  });

  it('runs another synchronization when data changes during an active run', async () => {
    let releaseFirstBackup!: () => void;
    const firstBackup = new Promise<void>((resolve) => {
      releaseFirstBackup = resolve;
    });
    const cloudBackup = vi
      .spyOn(service, 'cloudBackup')
      .mockImplementationOnce(() => firstBackup.then(() => true))
      .mockResolvedValue(true);
    const dbSyncStore = vi.spyOn(service, 'dbSyncStore').mockResolvedValue(undefined);
    vi.spyOn(service, 'setting', 'get').mockReturnValue({
      getValue: vi.fn().mockResolvedValue({ sync: true, type: 'webdav' }),
    });

    const firstRun = service.syncWatcherChanges();
    await vi.waitFor(() => expect(cloudBackup).toHaveBeenCalledTimes(1));

    await service.syncWatcherChanges();
    releaseFirstBackup();
    await firstRun;

    expect(cloudBackup).toHaveBeenCalledTimes(2);
    expect(dbSyncStore).toHaveBeenCalledTimes(2);
    expect(service.watcherSyncing).toBe(false);
  });
});
