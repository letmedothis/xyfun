import { loggerService } from '@logger';
import { LOG_MODULE } from '@shared/config/logger';
import type { ProxyConfig } from 'electron';
import { app, session } from 'electron';
import { getSystemProxy } from 'os-proxy-config';

import { NodeProxyController } from './nodeProxy';

const logger = loggerService.withContext(LOG_MODULE.APP_PROXY);

export class ProxyManager {
  private config: ProxyConfig = { mode: 'direct' };
  private systemProxyInterval: NodeJS.Timeout | null = null;
  private isSettingProxy = false;
  private nodeProxyController = new NodeProxyController(logger);

  private async monitorSystemProxy(): Promise<void> {
    this.clearSystemProxyMonitor();
    this.systemProxyInterval = setInterval(async () => {
      const currentProxy = await getSystemProxy();
      if (
        currentProxy?.proxyUrl.toLowerCase() === this.config?.proxyRules &&
        currentProxy?.noProxy.join(',').toLowerCase() === this.config?.proxyBypassRules?.toLowerCase()
      ) {
        return;
      }

      logger.info(
        `system proxy changed: ${currentProxy?.proxyUrl}, this.config.proxyRules: ${this.config.proxyRules}, this.config.proxyBypassRules: ${this.config.proxyBypassRules}`,
      );
      await this.configureProxy({
        mode: 'system',
        proxyRules: currentProxy?.proxyUrl.toLowerCase(),
        proxyBypassRules: currentProxy?.noProxy.join(','),
      });
    }, 1000 * 60);
  }

  private clearSystemProxyMonitor(): void {
    if (this.systemProxyInterval) {
      clearInterval(this.systemProxyInterval);
      this.systemProxyInterval = null;
    }
  }

  async configureProxy(config: ProxyConfig): Promise<void> {
    logger.info(`configureProxy: ${config?.mode} ${config?.proxyRules} ${config?.proxyBypassRules}`);

    if (this.isSettingProxy) {
      return;
    }

    this.isSettingProxy = true;

    try {
      this.clearSystemProxyMonitor();
      if (config.mode === 'system') {
        const currentProxy = await getSystemProxy();
        if (currentProxy) {
          logger.info(
            `current system proxy: ${currentProxy.proxyUrl}, bypass rules: ${currentProxy.noProxy.join(',')}`,
          );
          config.proxyRules = currentProxy.proxyUrl.toLowerCase();
          config.proxyBypassRules = currentProxy.noProxy.join(',');
        }
        this.monitorSystemProxy();
      }

      await this.setGlobalProxy(config);
      this.config = config;
    } catch (error) {
      logger.error('Failed to config proxy:', error as Error);
      throw error;
    } finally {
      this.isSettingProxy = false;
    }
  }

  private async setGlobalProxy(config: ProxyConfig): Promise<void> {
    this.nodeProxyController.configure({
      proxyRules: config.mode === 'direct' ? undefined : config.proxyRules,
      proxyBypassRules: config.proxyBypassRules,
    });
    await this.setSessionsProxy(config);
  }

  private async setSessionsProxy(config: ProxyConfig): Promise<void> {
    const sessions = [session.defaultSession, session.fromPartition('persist:webview')];
    await Promise.all(sessions.map((session) => session.setProxy(config)));

    app.setProxy(config);
  }
}

export const proxyManager = new ProxyManager();
