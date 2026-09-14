import type { WindowApiType } from './index';

declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>;
        send: (channel: string, ...args: any[]) => void;
        on: (channel: string, listener: (...args: any[]) => void) => void;
        removeListener: (channel: string, listener: (...args: any[]) => void) => void;
        removeAllListeners: (channel: string) => void;
      };
      process: {
        env: Record<string, string | undefined>;
        platform: string;
        versions: Record<string, string>;
      };
    };
    api: WindowApiType;
  }
}
