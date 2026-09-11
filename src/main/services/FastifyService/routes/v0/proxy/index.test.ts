import { describe, expect, it } from 'vitest';

import { isSafeRemoteUrl } from './utils/safeRemoteUrl';

describe('isSafeRemoteUrl', () => {
  it.each([
    'http://127.0.0.1',
    'http://10.0.0.1',
    'http://192.168.1.1',
    'http://169.254.169.254',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://[::ffff:192.168.1.1]',
    'http://localhost',
  ])('rejects local or private address %s', async (url) => {
    await expect(isSafeRemoteUrl(url)).resolves.toBe(false);
  });

  it('accepts a public IP literal', async () => {
    await expect(isSafeRemoteUrl('https://93.184.216.34/resource')).resolves.toBe(true);
  });

  it('rejects credentials embedded in a URL', async () => {
    await expect(isSafeRemoteUrl('https://user:password@93.184.216.34')).resolves.toBe(false);
  });
});
