// Short-lived signed links for Telegram's native file download (WebApp.downloadFile).
// Telegram fetches the file itself, without our X-Telegram-Init-Data header, so the link carries
// its own proof: session, owner and expiry, signed with a server-side secret.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const DOWNLOAD_TTL_SECONDS = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Signing key; a dedicated DOWNLOAD_SECRET wins, otherwise it is derived from the bot token. */
export function downloadKey(env = process.env) {
  const base = env.DOWNLOAD_SECRET || env.TELEGRAM_BOT_TOKEN;
  if (!base) throw new Error('Ссылки на скачивание не настроены: нет DOWNLOAD_SECRET или TELEGRAM_BOT_TOKEN');
  return createHmac('sha256', 'ReScanDownload').update(base).digest();
}

const sign = (payload, key) => createHmac('sha256', key).update(payload).digest('base64url');

/**
 * @param {{sessionId:string, owner:string}} subject
 * @param {Buffer} key
 * @param {number} [now] ms
 * @returns {string} token safe for a URL path segment
 */
export function createDownloadToken({ sessionId, owner }, key, now = Date.now()) {
  const expires = Math.floor(now / 1000) + DOWNLOAD_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ s: sessionId, o: owner, e: expires })).toString('base64url');
  return `${payload}.${sign(payload, key)}`;
}

/**
 * @returns {{sessionId:string, owner:string}}
 * @throws when the token is malformed, tampered with or expired
 */
export function verifyDownloadToken(token, key, now = Date.now()) {
  const [payload, signature, extra] = String(token ?? '').split('.');
  if (!payload || !signature || extra !== undefined) throw new Error('Некорректная ссылка');
  const expected = Buffer.from(sign(payload, key));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new Error('Некорректная ссылка');
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new Error('Некорректная ссылка'); }
  if (!UUID.test(data?.s ?? '') || typeof data.o !== 'string' || !Number.isSafeInteger(data.e)) throw new Error('Некорректная ссылка');
  if (now / 1000 > data.e) throw new Error('Ссылка устарела. Нажмите «Скачать» ещё раз');
  return { sessionId: data.s, owner: data.o };
}
