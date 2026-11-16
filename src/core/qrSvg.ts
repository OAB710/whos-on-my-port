// QR code → SVG (for "Show QR Code for Phone"). Pure, no 'vscode' import.
import { qrcodegen } from '../vendor/qrcodegen';

/** Dark/light module grid (row-major, true = dark), ECC level M. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  const rows: boolean[][] = [];
  for (let y = 0; y < qr.size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < qr.size; x++) row.push(qr.getModule(x, y));
    rows.push(row);
  }
  return rows;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

/**
 * Standalone SVG: black modules on white with the mandatory 4-module quiet zone,
 * optionally followed by a caption line (the URL) under the code.
 */
export function qrSvg(text: string, caption?: string, moduleSize = 8): string {
  const m = qrMatrix(text);
  const quiet = 4;
  const dim = (m.length + quiet * 2) * moduleSize;
  const captionH = caption ? 40 : 0;
  let d = '';
  m.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${(x + quiet) * moduleSize},${(y + quiet) * moduleSize}h${moduleSize}v${moduleSize}h-${moduleSize}z`;
    }),
  );
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim + captionH}" viewBox="0 0 ${dim} ${dim + captionH}" shape-rendering="crispEdges">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<path d="${d}" fill="#000000"/>`,
  ];
  if (caption) {
    parts.push(
      `<text x="${dim / 2}" y="${dim + captionH / 2}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="18" fill="#000000">${escapeXml(caption)}</text>`,
    );
  }
  parts.push('</svg>');
  return parts.join('\n') + '\n';
}
