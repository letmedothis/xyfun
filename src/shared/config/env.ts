export const ORIGIN = import.meta.env.VITE_API_URL || 'http://127.0.0.1';
export const PORT = Number(import.meta.env.VITE_API_PORT) || 9978;
export const PREFIX = import.meta.env.VITE_API_PREFIX || '';
export const PREFIX_API = `${ORIGIN}${PREFIX}`;

export const PROXY_API = `${ORIGIN}/proxy`;
export const AIGC_CHAT_COMPLETION_API = `${PREFIX_API}/v1/aigc/chat/completion`;
export const FILE_MANAGE_API = `${PREFIX_API}/v1/file/manage/file`;
export const SYSTEM_M3U8_AD_REMOVE_API = `${PREFIX_API}/v1/system/m3u8/adremove`;
