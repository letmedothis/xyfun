import type { ResultSet } from '@libsql/client';
import type { IModels, ITableName } from '@shared/types/db';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { SQLiteTransaction } from 'drizzle-orm/sqlite-core';

import { analyze } from './analyze';
import { channel } from './channel';
import { history } from './history';
import { iptv } from './iptv';
import { plugin } from './plugin';
import { setting } from './setting';
import { site } from './site';
import { star } from './star';

export const schemas = {
  analyze,
  channel,
  history,
  iptv,
  plugin,
  setting,
  site,
  star,
} as const;

export const tableNames = Object.keys(schemas) as ITableName[];

export type Schemas = typeof schemas;

export type TableName = ITableName;

// Re-export Models type from shared types
export type Models = IModels;

export type AppTransaction<TMode extends 'async' | 'sync' = 'async'> = SQLiteTransaction<
  TMode,
  ResultSet,
  Schemas,
  ExtractTablesWithRelations<Schemas>
>;

export type Transaction = AppTransaction<'async'>;
