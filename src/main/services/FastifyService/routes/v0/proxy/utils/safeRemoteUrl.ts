import { lookup } from 'node:dns/promises';

import ipaddr from 'ipaddr.js';

const isPrivateAddress = (address: string): boolean => {
  try {
    const normalized = ipaddr.process(address);
    return normalized.range() !== 'unicast';
  } catch {
    return true;
  }
};

export const isSafeRemoteUrl = async (rawUrl: string): Promise<boolean> => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false;

  try {
    const addresses = ipaddr.isValid(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
  } catch {
    return false;
  }
};
