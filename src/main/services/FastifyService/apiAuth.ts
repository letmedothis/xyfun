import { randomBytes } from 'node:crypto';

export const API_AUTH_HEADER = 'x-zyfun-api-token';
export const API_AUTH_TOKEN = randomBytes(32).toString('hex');

/**
 * Routes that must stay reachable without the renderer-injected token because
 * their clients are separate local processes:
 * - `/proxy`: external players (mpv/VLC) stream CMS media through this
 *   SSRF-guarded relay and cannot attach custom headers.
 * - `/docs`: Swagger UI and the OpenAPI document consumed by swagger-mcp.
 */
const API_AUTH_EXEMPT_ROUTES: ReadonlyArray<{ methods: ReadonlyArray<string>; path: string; prefix?: boolean }> = [
  { methods: ['GET', 'HEAD'], path: '/proxy' },
  { methods: ['GET'], path: '/docs', prefix: true },
];

const normalizePathname = (url: string): string => {
  const pathname = url.split('?')[0].replace(/\/+$/, '');
  return pathname.length > 0 ? pathname : '/';
};

export const isApiAuthExempt = (method: string, url: string): boolean => {
  const pathname = normalizePathname(url);
  return API_AUTH_EXEMPT_ROUTES.some((route) => {
    if (!route.methods.includes(method)) return false;
    if (route.prefix) return pathname === route.path || pathname.startsWith(`${route.path}/`);
    return pathname === route.path;
  });
};
