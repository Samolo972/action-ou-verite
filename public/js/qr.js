// QR code dessiné côté client avec la librairie locale /vendor/qrcode.js (aucune API externe).
// Correction d'erreur niveau H : le logo au centre (≈ 6 % de la surface) ne gêne pas la lecture.

/* global qrcode */
export function drawQR(canvas, text, { size = 200, dark = '#0F0E17', light = '#FFFFFE' } = {}) {
  const qr = qrcode(0, 'H');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const scale = window.devicePixelRatio > 1 ? 2 : 1;
  const px = size * scale;
  canvas.width = px;
  canvas.height = px;
  const c = canvas.getContext('2d');
  c.fillStyle = light;
  c.fillRect(0, 0, px, px);
  c.fillStyle = dark;
  const cell = px / n;
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      if (qr.isDark(r, col)) {
        // On arrondit les bords pour éviter les fines lignes blanches entre modules.
        const x = Math.floor(col * cell);
        const y = Math.floor(r * cell);
        c.fillRect(x, y, Math.ceil((col + 1) * cell) - x, Math.ceil((r + 1) * cell) - y);
      }
    }
  }
}
