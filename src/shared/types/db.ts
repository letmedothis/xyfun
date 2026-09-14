import type { Client, Config } from '@libsql/client';
import type { drizzle } from 'drizzle-orm/libsql';

import type { ISetting } from '../config/tblSetting';

export type IClient = Client;

export type IConfig = Config;

export type IOrm = ReturnType<typeof drizzle>;

// Define generic model types that can be used across processes
export interface IModels {
  analyze: {
    id: string;
    key: string;
    name: string;
    api: string;
    type: number;
    flag: string[];
    headers: Record<string, any>;
    script: string | null;
    isActive: boolean;
    createdAt: number;
    updatedAt: number;
  };
  channel: {
    id: string;
    name: string;
    url: string;
    group: string | null;
    logo: string | null;
    isActive: boolean;
    createdAt: number;
    updatedAt: number;
  };
  history: {
    id: string;
    relateSite: string;
    relateId: string;
    vodId: string;
    vodName: string;
    vodPic: string;
    vodRemarks: string;
    episodeId: string;
    episodeName: string;
    watchTime: number;
    duration: number;
    createdAt: number;
    updatedAt: number;
  };
  iptv: {
    id: string;
    name: string;
    url: string;
    group: string | null;
    logo: string | null;
    isActive: boolean;
    createdAt: number;
    updatedAt: number;
  };
  plugin: {
    id: string;
    name: string;
    pluginName: string;
    author: string;
    description: string;
    readme: string;
    main: string;
    web: string;
    base: string;
    version: string;
    logo: string;
    homepage: string;
    isActive: boolean;
    createdAt: number;
    updatedAt: number;
  };
  setting: {
    id: string;
    key: string;
    value: { data: any };
    createdAt: number;
    updatedAt: number;
  };
  site: {
    id: string;
    key: string;
    name: string;
    api: string;
    type: number;
    flag: string[];
    headers: Record<string, any>;
    script: string | null;
    isActive: boolean;
    createdAt: number;
    updatedAt: number;
  };
  star: {
    id: string;
    relateSite: string;
    relateId: string;
    vodId: string;
    vodName: string;
    vodPic: string;
    vodRemarks: string;
    vodYear: string;
    vodArea: string;
    vodClass: string;
    type: 'film' | 'iptv' | 'analyze';
    createdAt: number;
    updatedAt: number;
  };
}

export type ITableName = keyof IModels;

export type ISchemas = Record<ITableName, any>;

export type IMigrate = (orm: IOrm, schemas: ISchemas) => Promise<void>;

export interface IMigration {
  version: string;
  migrate: IMigrate;
}

export type IMigrations = readonly IMigration[];

export type IDb = {
  [K in keyof IModels]: IModels[K][];
};

export type IDbStore = {
  [K in keyof IModels]?: K extends 'setting' ? Partial<ISetting> : IModels[K][];
};
