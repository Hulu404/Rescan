import { createHmac, timingSafeEqual } from 'node:crypto';

// Telegram usernames: 5–32 chars, latin letters, digits, underscore; case-insensitive.
const USERNAME_RE = /^[a-z0-9_]{5,32}$/;

/** "@Ivan_Petrov" / "ivan_petrov" → "ivan_petrov"; anything invalid → "" */
export function normalizeUsername(value) {
  const name = String(value ?? '').trim().replace(/^@/, '').toLowerCase();
  return USERNAME_RE.test(name) ? name : '';
}

/** Parses ALLOWED_TELEGRAM_USERNAMES="@a_user, @b_user" into a normalized list. */
export function parseAllowedUsernames(raw) {
  return (raw || '').split(',').map(normalizeUsername).filter(Boolean);
}

/**
 * Verifies Telegram WebApp initData and the username allowlist.
 * Returns the numeric Telegram user ID as the stable owner key
 * (usernames can be changed, so data is never keyed by them).
 */
export function validateTelegram(raw, token, allowedUsernames, now = Date.now()) {
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error('Откройте приложение из Telegram');
  if (new Set(params.keys()).size !== [...params.keys()].length) throw new Error('Некорректная подпись');
  params.delete('hash');
  const data = [...params.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(data).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw new Error('Некорректная подпись Telegram');
  const age = now / 1000 - Number(params.get('auth_date'));
  if (!Number.isFinite(age) || age < -30 || age > 86400) throw new Error('Сессия Telegram истекла. Откройте приложение заново');
  const user = JSON.parse(params.get('user') || '{}');
  if (!Number.isSafeInteger(user.id)) throw new Error('Откройте приложение из Telegram');
  const username = normalizeUsername(user.username);
  if (!username) throw new Error('У вашего аккаунта Telegram не задан никнейм (@username). Задайте его в настройках Telegram и обратитесь к администратору клиники');
  if (!allowedUsernames.includes(username)) throw new Error('Нет доступа. Обратитесь к администратору клиники');
  return String(user.id);
}
