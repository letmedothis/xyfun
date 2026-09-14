import { lookup } from 'node:dns/promises';

import ipaddr from 'ipaddr.js';
import type { Dispatcher } from 'undici';
import { Agent, request as undiciRequest } from 'undici';

const isPrivateAddress = (address: string): boolean => {
  try {
    const normalized = ipaddr.process(address);
    return normalized.range() !== 'unicast';
  } catch {
    return true;
  }
};

const validateIpAddresses = async (hostname: string): Promise<boolean> => {
  try {
    const addresses = ipaddr.isValid(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
  } catch {
    return false;
  }
};

export class SsrfSafeAgent extends Agent {
  constructor(options?: Agent.Options) {
    super({
      ...options,
      connect: {
        ...options?.connect,
        lookup: async (hostname, options, callback) => {
          try {
            const isSafe = await validateIpAddresses(hostname);
            if (!isSafe) {
              callback(new Error(`SSRF protection: ${hostname} resolves to private IP`), '', 4);
              return;
            }

            // Use default lookup after validation
            const { lookup: defaultLookup } = await import('node:dns');
            defaultLookup(hostname, options, callback);
          } catch (error) {
            callback(error as Error, '', 4);
          }
        },
      },
    });
  }
}

const ssrfSafeAgent = new SsrfSafeAgent();

export const safeRequest = async (
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
  },
) => {
  const { method = 'GET', headers, body } = options || {};

  const response = await undiciRequest(url, {
    method: method as Dispatcher.HttpMethod,
    headers,
    body,
    dispatcher: ssrfSafeAgent,
  });

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body,
  };
};
