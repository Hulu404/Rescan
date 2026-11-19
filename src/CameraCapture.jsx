import React, { useEffect, useRef, useState } from 'react';

// In-app camera via getUserMedia. Telegram's Android WebView ignores <input capture> and opens the
// gallery instead (bugs.telegram.org/c/44936), so the live stream is the reliable way to shoot.
// Ask for a large frame: the label is a small part of it and OCR needs pixels.
const CONSTRAINTS = { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } };
const JPEG_QUALITY = 0.92;

export function canUseLiveCamera() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

function cameraError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'Нет доступа к камере. Разрешите Telegram доступ к камере в настройках телефона или выберите фото из галереи.';
  if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') return 'Камера не найдена. Выберите фото из галереи.';
  return 'Не удалось включить камеру. Выберите фото из галереи.';
}

/**
 * Full-screen camera with a framing guide and a shutter button.
 * @param {{onCapture:(file:File)=>void, onCancel:()=>void, onGallery:()=>void}} props
 */
export function CameraCapture({ onCapture, onCancel, onGallery }) {
  const video = useRef(null);
  const stream = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices.getUserMedia(CONSTRAINTS).then(media => {
      if (cancelled) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      video.current.srcObject = media;
      return video.current.play().then(() => { if (!cancelled) setReady(true); });
    }).catch(e => { console.error('Camera failed', e?.name, e?.message); if (!cancelled) setError(cameraError(e)); });
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach(track => track.stop());
      stream.current = null;
    };
  }, []);

  function handleShoot() {
    const { videoWidth: width, videoHeight: height } = video.current;
    if (!width || !height) return;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(video.current, 0, 0, width, height);
    canvas.toBlob(blob => {
      if (!blob) { setError('Не удалось сохранить снимок. Попробуйте ещё раз.'); return; }
      onCapture(new File([blob], `label-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', JPEG_QUALITY);
  }

  return (
    <div className="camera" role="dialog" aria-modal="true" aria-label="Съёмка этикетки">
      <video ref={video} className="camera-video" playsInline muted autoPlay />
      {!error && <div className="camera-guide" aria-hidden="true" />}
      <p className="camera-hint">{error || (ready ? 'Этикетка целиком в рамке, без бликов' : 'Включаем камеру…')}</p>
      <div className="camera-actions">
        <button type="button" className="camera-cancel" onClick={onCancel}>Отмена</button>
        {error
          ? <button type="button" className="primary" onClick={onGallery}>Из галереи</button>
          : <button type="button" className="camera-shutter" disabled={!ready} onClick={handleShoot} aria-label="Снять" />}
      </div>
    </div>
  );
}
