import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Client } from '@libsql/client';
import { createClient } from '@libsql/client';
import type { IModels } from '@shared/types/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const paths = vi.hoisted(() => ({ database: '', backups: '' }));
vi.mock('@main/utils/path', () => ({
  get APP_DATABASE_PATH() {
    return paths.database;
  },
  get APP_DATABASE_BACKUP_PATH() {
    return paths.backups;
  },
}));
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), error: vi.fn() }) },
}));
vi.mock('@main/services/ConfigManager', () => ({ configManager: { set: vi.fn() }, STORE_KEYS: [] }));
vi.mock('@main/services/StorageService', () => ({ ICloudStorage: class {}, WebdavStorage: class {} }));

import { DbService } from '..';
import { latestVersion } from '../migrations';

describe('database upgrade compatibility', () => {
  let client: Client;
  let service: DbService;

  beforeEach(async () => {
    paths.database = await mkdtemp(join(tmpdir(), 'xyfun-upgrade-test-'));
    paths.backups = join(paths.database, 'backups');
    client = createClient({ url: `file:${join(paths.database, 'data.db')}` });
    service = DbService.reload();
  });

  afterEach(async () => {
    await service.close();
    client.close();
    await rm(paths.database, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const seed = async (version = '3.4.1') => {
    const fixture = await readFile(new URL('./fixtures/3.4.1.sql', import.meta.url), 'utf8');
    await client.executeMultiple(fixture);
    if (version !== '3.4.1' && version !== '3.4.6') {
      await client.execute("ALTER TABLE tbl_channel ADD COLUMN headers TEXT DEFAULT '{}'");
    }
    for (const [key, value] of Object.entries({ version, theme: 'dark', bossKey: 'Alt+Z', defaultSite: 'site-key' })) {
      await client.execute({
        sql: 'INSERT INTO tbl_setting(id,key,value) VALUES(?,?,?)',
        args: [key, key, JSON.stringify({ data: value })],
      });
    }
    await client.executeMultiple(`
      INSERT INTO tbl_site(id,key,name,api,type) VALUES('site','site-key','Custom','https://example.test/api',1);
      INSERT INTO tbl_star(id,type,relateId,videoId,videoName) VALUES('star',1,'site-key','video','Favorite');
      INSERT INTO tbl_channel(id,name,api,createdAt,updatedAt) VALUES('channel','Channel','https://example.test/live',1000,2000);
      INSERT INTO tbl_iptv(id,key,name,api,type,headers) VALUES('iptv','live-key','Live','https://example.test/list',1,'{"Token":"custom"}');
      INSERT INTO tbl_analyze(id,key,name,api,type) VALUES('analyze','parse-key','Parser','https://example.test/parse',1);
      INSERT INTO tbl_plugin(id,name,pluginName,base) VALUES('plugin','Plugin','test-plugin','/example/plugin');
      INSERT INTO tbl_history(id,type,relateId,videoId,videoName,watchTime,createdAt,updatedAt)
        VALUES('play',1,'site-key','video','Video',120,1000,2000);
    `);
  };

  const history = async (
    id: string,
    type: number,
    term: string,
    updatedAt: number,
    relateId: string | null = 'source',
  ) => {
    await client.execute({
      sql: 'INSERT INTO tbl_history(id,type,relateId,videoId,videoName,createdAt,updatedAt) VALUES(?,?,?,?,?,1000,?)',
      args: [id, type, relateId, '1', term, updatedAt],
    });
  };

  const rows = async (table: string, db = client) => (await db.execute(`SELECT * FROM ${table} ORDER BY id`)).rows;
  const version = async () =>
    JSON.parse(String((await client.execute("SELECT value FROM tbl_setting WHERE key='version'")).rows[0].value)).data;
  const backupPaths = async () => {
    const directories = await readdir(paths.backups).catch(() => [] as string[]);
    return directories.map((name) => join(paths.backups, name, 'data.db'));
  };

  it.each(['3.4.1', '3.4.7'])('preserves user data and search terms when upgrading %s', async (oldVersion) => {
    await seed(oldVersion);
    await history('search-a', 5, '猫', 1000);
    await history('search-b', 5, '狗', 2000);
    await history('search-c', 5, '电影', 3000);
    await history('import-a', 6, 'first import', 1000);
    await history('import-b', 6, 'second import', 2000);
    const tables = ['tbl_history', 'tbl_star', 'tbl_site', 'tbl_iptv', 'tbl_analyze', 'tbl_plugin'];
    const before = await Promise.all(tables.map((table) => rows(table)));
    await service.init();
    expect(await Promise.all(tables.map((table) => rows(table)))).toEqual(before);
    expect(await version()).toBe(latestVersion);
    expect(await service.setting.getValue('theme')).toBe('dark');
    expect(await service.setting.getValue('bossKey')).toBe('Alt+Z');
    expect(await service.channel.get('channel')).toMatchObject({
      id: 'channel',
      headers: {},
      createdAt: 1000,
      updatedAt: 2000,
    });
    expect(
      (await client.execute("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'tbl_%'")).rows[0]
        .n,
    ).toBe(8);
    const backups = await backupPaths();
    expect(backups).toHaveLength(1);
    const backup = createClient({ url: `file:${backups[0]}` });
    try {
      expect(await rows('tbl_history', backup)).toEqual(before[0]);
      expect(
        JSON.parse(String((await backup.execute("SELECT value FROM tbl_setting WHERE key='version'")).rows[0].value))
          .data,
      ).toBe(oldVersion);
      expect((await backup.execute('PRAGMA integrity_check')).rows[0].integrity_check).toBe('ok');
    } finally {
      backup.close();
    }
    await service.close();
    await service.init();
    expect(await backupPaths()).toEqual(backups);
    expect(await rows('tbl_history')).toEqual(before[0]);
  });

  it('repairs an already migrated 3.4.8 index and keeps subsequent searches distinct', async () => {
    await seed('3.4.8');
    await history('search', 5, 'original', 1000);
    await client.execute('CREATE UNIQUE INDEX uidx_history_identity ON tbl_history(type,relateId,videoId)');
    await service.init();
    for (const term of ['new one', 'new two']) {
      await service.history.add({ type: 5, relateId: 'source', videoId: '1', videoName: term } as IModels['history']);
    }
    expect((await service.history.getByField({ type: 5 })).map((item) => item.videoName)).toEqual([
      'original',
      'new one',
      'new two',
    ]);
    await service.history.add({
      id: 'replacement',
      type: 1,
      relateId: 'site-key',
      videoId: 'video',
      watchTime: 240,
      createdAt: 9999,
    } as IModels['history']);
    expect(await service.history.get('play')).toMatchObject({ id: 'play', watchTime: 240, createdAt: 1000 });
    expect(await service.history.get('replacement')).toBeUndefined();
  });

  it('deduplicates playback only and retains an exact pre-migration backup', async () => {
    await seed('3.4.7');
    for (const type of [1, 2, 3, 5, 6, 7]) {
      await history(`${type}-old`, type, 'old', 1000);
      await history(`${type}-new`, type, 'new', 2000);
    }
    await history('null-a', 1, 'unknown source a', 1000, null);
    await history('null-b', 1, 'unknown source b', 2000, null);
    const before = await rows('tbl_history');
    await service.init();
    const after = await rows('tbl_history');
    expect(after).toEqual(before.filter((row) => !['1-old', '2-old', '3-old'].includes(String(row.id))));
    const backup = createClient({ url: `file:${(await backupPaths())[0]}` });
    try {
      expect(await rows('tbl_history', backup)).toEqual(before);
    } finally {
      backup.close();
    }
  });

  it('initializes a truly empty database with the corrected index and no backup', async () => {
    await service.init();
    expect(await version()).toBe(latestVersion);
    expect(await backupPaths()).toEqual([]);
    await history('a', 5, 'first', 1000);
    await history('b', 5, 'second', 2000);
    expect(await rows('tbl_history')).toHaveLength(2);
  });

  it.each([null, 'broken json', '{"data":"invalid"}', '{"data":"0.0.0"}'])(
    'does not reset an existing database with version %s',
    async (value) => {
      await seed();
      if (value === null) await client.execute("DELETE FROM tbl_setting WHERE key='version'");
      else await client.execute({ sql: "UPDATE tbl_setting SET value=? WHERE key='version'", args: [value] });
      const before = await rows('tbl_setting');
      await expect(service.init()).rejects.toThrow('missing or invalid version');
      expect(await rows('tbl_setting')).toEqual(before);
      expect(await rows('tbl_history')).toHaveLength(1);
      expect(await backupPaths()).toEqual([]);
    },
  );

  it('does not initialize an unrelated existing database', async () => {
    await client.executeMultiple("CREATE TABLE private_data(value TEXT); INSERT INTO private_data VALUES ('keep');");
    await expect(service.init()).rejects.toThrow('no settings table');
    expect((await client.execute('SELECT * FROM private_data')).rows).toEqual([{ value: 'keep' }]);
    expect((await client.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows).toEqual([
      { name: 'private_data' },
    ]);
  });

  it('reads a pre-timestamp version without using the current ORM schema', async () => {
    await client.executeMultiple(`CREATE TABLE tbl_setting(id TEXT,key TEXT,value TEXT);
      INSERT INTO tbl_setting VALUES('v','version','{"data":"3.4.0"}');`);
    await expect(service.init()).rejects.toThrow('Legacy database 3.4.0 requires conversion');
    expect((await client.execute('PRAGMA table_info(tbl_setting)')).rows.map((row) => row.name)).toEqual([
      'id',
      'key',
      'value',
    ]);
    expect(await version()).toBe('3.4.0');
  });

  it('rejects newer versions without changing their data', async () => {
    await seed('99.0.0');
    await expect(service.init()).rejects.toThrow('newer than supported');
    expect(await version()).toBe('99.0.0');
    expect(await backupPaths()).toEqual([]);
  });

  it('rejects a version marker whose physical schema is missing columns', async () => {
    await seed();
    await client.execute({
      sql: "UPDATE tbl_setting SET value=? WHERE key='version'",
      args: [JSON.stringify({ data: latestVersion })],
    });
    await expect(service.init()).rejects.toThrow('tbl_channel.headers');
    expect(await rows('tbl_history')).toHaveLength(1);
  });

  it('validates the index even when the version is already current', async () => {
    await service.init();
    await service.close();
    await client.execute('DROP INDEX uidx_history_identity');
    await client.execute('CREATE UNIQUE INDEX uidx_history_identity ON tbl_history(type,relateId,videoId)');
    await expect(service.init()).rejects.toThrow('Incompatible playback history index');
  });

  it('does not overwrite channel headers when an imported version is older than the schema', async () => {
    await seed('3.4.7');
    await client.execute('UPDATE tbl_setting SET value=\'{"data":"3.4.1"}\' WHERE key=\'version\'');
    await client.execute('UPDATE tbl_channel SET headers=\'{"Token":"keep"}\'');
    const before = await rows('tbl_channel');
    await expect(service.init()).rejects.toThrow('predates existing channel headers');
    expect(await rows('tbl_channel')).toEqual(before);
    expect(await backupPaths()).toEqual([]);
  });

  it('leaves an unreadable database file intact', async () => {
    client.close();
    const path = join(paths.database, 'data.db');
    const bytes = 'not a SQLite database; preserve for recovery';
    await writeFile(path, bytes);
    await expect(service.init()).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(bytes);
    expect(await backupPaths()).toEqual([]);
  });

  it('stops before modifying data when the backup directory cannot be created', async () => {
    await seed('3.4.7');
    await history('a', 1, 'old', 1000);
    await history('b', 1, 'new', 2000);
    const before = await rows('tbl_history');
    await writeFile(paths.backups, 'not a directory');
    await expect(service.init()).rejects.toThrow();
    expect(await version()).toBe('3.4.7');
    expect(await rows('tbl_history')).toEqual(before);
  });

  it('rolls back table replacement and version updates together, then retries safely', async () => {
    await seed('3.4.6');
    await client.execute(`CREATE TRIGGER fail_version BEFORE UPDATE ON tbl_setting
      WHEN NEW.key = 'version' AND json_extract(NEW.value, '$.data') = '3.4.7'
      BEGIN SELECT RAISE(ABORT, 'injected migration failure'); END;`);
    const before = await rows('tbl_channel');
    await expect(service.init()).rejects.toThrow('Migrate to 3.4.7 failed');
    expect(await version()).toBe('3.4.6');
    expect(await rows('tbl_channel')).toEqual(before);
    expect((await client.execute("SELECT name FROM sqlite_master WHERE name LIKE '__new_%'")).rows).toEqual([]);
    expect((await client.execute('PRAGMA integrity_check')).rows[0].integrity_check).toBe('ok');
    const firstBackup = (await backupPaths())[0];
    const bytes = await readFile(firstBackup);
    await client.execute('DROP TRIGGER fail_version');
    await service.init();
    expect(await version()).toBe(latestVersion);
    expect(await backupPaths()).toHaveLength(2);
    expect(await readFile(firstBackup)).toEqual(bytes);
    expect(await service.channel.get('channel')).toMatchObject({ headers: {}, createdAt: 1000 });
  });

  it('includes committed WAL data in the backup', async () => {
    await seed('3.4.7');
    await client.execute('PRAGMA journal_mode=WAL');
    await client.execute('PRAGMA wal_autocheckpoint=0');
    await history('wal-search', 5, 'committed in WAL', 3000);
    await service.init();
    const backup = createClient({ url: `file:${(await backupPaths())[0]}` });
    try {
      expect((await backup.execute("SELECT videoName FROM tbl_history WHERE id='wal-search'")).rows).toEqual([
        { videoName: 'committed in WAL' },
      ]);
    } finally {
      backup.close();
    }
  });
});
