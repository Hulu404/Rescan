export function parsePower(value) {
  const text = String(value ?? '').trim().replace(/\s*[DД]$/i, '').replace(',', '.').replace(/[−–]/g, '-');
  if (!/^[+-]?\d{1,3}(\.\d{1,3})?$/.test(text)) throw new Error('Введите оптическую силу числом, например −2,5');
  const number = Number(text);
  if (!Number.isFinite(number) || Math.abs(number) > 100) throw new Error('Проверьте оптическую силу (от −100 до +100 D)');
  return number;
}
// Alcon prints SN as 8 + 3 digit groups; typed or OCR-read values often lose the gap.
const SERIAL_GROUPED = /^(\d{8})(\d{3})$/;

/** One spelling per serial, so the same lens is stored and exported the same way. Digits are never changed. */
export function normalizeSerial(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return text.replace(SERIAL_GROUPED, '$1 $2');
}

export function clinicDate(value, timeZone = 'Europe/Moscow') {
  return new Intl.DateTimeFormat('ru-RU', { timeZone, day:'2-digit', month:'2-digit', year:'numeric' }).format(new Date(value));
}
