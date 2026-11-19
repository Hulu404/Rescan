import { createHmac, timingSafeEqual } from 'node:crypto';
export function validateTelegram(raw, token, allowed, now = Date.now()) {
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
  if (!Number.isSafeInteger(user.id) || !allowed.includes(String(user.id))) throw new Error('Нет доступа. Обратитесь к администратору клиники');
  return String(user.id);
}
