// Frozen copy of the parser that shipped before the OCR rework — used only as the evaluation baseline.
export function parseLabelLegacy(text) {
  const lines = text.replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);
  const serials = lines.map(line => line.match(/\bS\s*\/?\s*N\b\s*[:#-]?\s*([A-Z0-9][A-Z0-9 -]*)/i)?.[1]?.split(/\s+(?:EXP|LOT|REF|USE|MFG)\b/i)[0]?.trim()).filter(Boolean);
  const models = lines.map(line => line.match(/\b(?:MODEL|МОДЕЛЬ|REF)\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]*)/i)?.[1]).filter(Boolean);
  if (!models.length) for (const line of lines) {
    if (/\b(?:SN|LOT|EXP|UDI)\b/i.test(line)) continue;
    if (/^(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9-]{4,16}$/.test(line)) models.push(line);
  }
  const powers = [...text.matchAll(/([+−–-]?\s*\d{1,2}(?:[.,]\d{1,3})?)\s*(?:D\b|ДПТР\b)/gi)].map(m => m[1].replace(/\s/g, ''));
  const unique = values => [...new Set(values)];
  return { model: unique(models).length === 1 ? models[0] : '', serial: unique(serials).length === 1 ? serials[0] : '', power: unique(powers).length === 1 ? powers[0] : '' };
}
