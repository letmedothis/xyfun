import { randomBytes } from 'node:crypto';

export const API_AUTH_HEADER = 'x-zyfun-api-token';
export const API_AUTH_TOKEN = randomBytes(32).toString('hex');
