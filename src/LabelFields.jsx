import React from 'react';

const FIELDS = [
  { key: 'model', label: 'Модель линзы', maxLength: 80 },
  { key: 'power', label: 'Оптическая сила, D', maxLength: 12 },
  { key: 'serial', label: 'Серийный номер (SN)', maxLength: 100 },
];

/**
 * Editable label fields with the photo fragment each value was read from,
 * the recognizer's warning and alternative readings to pick from.
 * @param {{fields:object, review:object, crops:object, disabled:boolean, onChange:(key:string, value:string)=>void}} props
 */
export function LabelFields({ fields, review, crops, disabled, onChange }) {
  return FIELDS.map(({ key, label, maxLength }) => {
    const info = review?.[key];
    const flagged = Boolean(info?.needsCheck);
    const alternatives = (info?.candidates ?? []).filter(value => value !== fields[key]);
    return (
      <div className={`field${flagged ? ' field-flagged' : ''}`} key={key}>
        <label>
          {label}
          <input required type="text" maxLength={maxLength} autoComplete="off" spellCheck="false" value={fields[key]} disabled={disabled} aria-describedby={info?.note ? `${key}-note` : undefined} onChange={e => onChange(key, e.target.value)} />
        </label>
        {crops?.[key] && <img className="field-crop" src={crops[key]} alt={`Фрагмент снимка: ${label}`} />}
        {info?.note && <p className="field-note" id={`${key}-note`}>{info.note}</p>}
        {alternatives.length > 0 && (
          <div className="field-options" role="group" aria-label={`Другие варианты: ${label}`}>
            {alternatives.map(value => <button type="button" key={value} disabled={disabled} onClick={() => onChange(key, value)}>{value}</button>)}
          </div>
        )}
      </div>
    );
  });
}

export function needsConfirmation(review) {
  return Object.values(review ?? {}).some(info => info?.needsCheck);
}
