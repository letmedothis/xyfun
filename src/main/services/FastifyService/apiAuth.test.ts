import { describe, expect, it } from 'vitest';

import { isApiAuthExempt } from './apiAuth';

describe('isApiAuthExempt', () => {
  it('exempts the media proxy used by external players', () => {
    expect(isApiAuthExempt('GET', '/proxy?url=https%3A%2F%2Fexample.com')).toBe(true);
    expect(isApiAuthExempt('HEAD', '/proxy?url=https%3A%2F%2Fexample.com')).toBe(true);
    expect(isApiAuthExempt('GET', '/proxy/')).toBe(true);
  });

  it('keeps write access to the media proxy authenticated', () => {
    expect(isApiAuthExempt('POST', '/proxy')).toBe(false);
  });

  it('exempts swagger documentation for GET only', () => {
    expect(isApiAuthExempt('GET', '/docs')).toBe(true);
    expect(isApiAuthExempt('GET', '/docs/json')).toBe(true);
    expect(isApiAuthExempt('GET', '/docs/static/style.css')).toBe(true);
    expect(isApiAuthExempt('POST', '/docs/json')).toBe(false);
  });

  it('does not exempt sensitive API routes', () => {
    expect(isApiAuthExempt('GET', '/api/v1/system/process')).toBe(false);
    expect(isApiAuthExempt('POST', '/api/v1/data/db')).toBe(false);
    expect(isApiAuthExempt('GET', '/api/v1/file/manage/file')).toBe(false);
    expect(isApiAuthExempt('GET', '/proxyfoo')).toBe(false);
  });
});
