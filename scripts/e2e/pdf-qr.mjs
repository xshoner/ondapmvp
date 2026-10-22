// 인쇄 PDF 오른쪽 위 QR이 실제로 읽히는지: PDF 안의 QR 벡터를 다시 그림으로 그려 jsQR로 판독한다. 실행: npm run e2e:pdf
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// 이 검사만 쓰는 도구(PGlite: 브라우저·Node에서 도는 Postgres, jsQR: QR 판독)는 scripts/e2e 안에 따로 설치한다
async function need(name) {
  try { return await import(name); } catch {
    console.error(`${name}이 없습니다. 한 번만: npm --prefix scripts/e2e ci`);
    process.exit(1);
  }
}

const { default: jsQR } = await need('jsqr');
const root = process.argv[2] ?? join(import.meta.dirname, '..', '..');
const { buildPrintPdf } = await import(pathToFileURL(join(root, 'src/packaging/print-pdf.ts')).href);
const { PDFDocument, PDFRawStream, PDFName, decodePDFRawStream } = await import(pathToFileURL(join(root, 'node_modules/pdf-lib/cjs/index.js')).href);

const sharp = createRequire(join(root, 'package.json'))('sharp');
const png = await sharp({ create: { width: 756, height: 756, channels: 4, background: { r: 232, g: 239, b: 233, alpha: 1 } } }).png().toBuffer();
const ok = [];
const check = (name, cond, detail = '') => { ok.push(cond); console.log(`${cond ? 'OK ' : 'NG '} ${name}${detail ? ' — ' + detail : ''}`); };

async function qrIn(pdf) {
  const doc = await PDFDocument.load(pdf);
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.get(PDFName.of('Subtype'))?.toString() !== '/Form') continue;
    const text = new TextDecoder().decode(decodePDFRawStream(obj).decode());
    // pdf-lib 사각형: q … 1 0 0 1 x y cm … 0 0 m 0 h l w h l w 0 l h f Q
    const rects = text.split('Q').flatMap((block) => {
      let x = 0, y = 0, w = 0;
      for (const m of block.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm/g)) { x += Number(m[1]); y += Number(m[2]); }
      for (const m of block.matchAll(/(-?[\d.]+) (-?[\d.]+) l/g)) w = Math.max(w, Number(m[1]));
      return w > 0 ? [[x, y, w]] : [];
    });
    if (rects.length < 20) continue;
    const bbox = obj.dict.get(PDFName.of('BBox')).asArray().map((n) => n.asNumber());
    const n = Math.round(bbox[2]);
    const scale = 8, quiet = 4, size = (n + quiet * 2) * scale;
    const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
    for (const [x, y, w] of rects) {
      const row = n - 1 - Math.round(y + 0.02); // 위아래 뒤집기 (PDF는 아래가 0)
      for (let c = Math.round(x); c < Math.round(x + w); c++) {
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
          const px = ((row + quiet) * scale + dy) * size + (c + quiet) * scale + dx;
          rgba[px * 4] = rgba[px * 4 + 1] = rgba[px * 4 + 2] = 0;
        }
      }
    }
    return { text: jsQR(rgba, size, size)?.data ?? null, modules: n, forms: 1 };
  }
  return null;
}

const label = { code: 'OD-3QNT-CPFA', orderNo: null, productNo: 49, quantity: 30 };
for (const [paper, sizeCm] of [['A4', 6], ['A4', 4], ['A3', 6], ['A3', 4]]) {
  const { pdf } = await buildPrintPdf({ png, sticker: { shape: 'circle', sizeCm }, paper, count: 30, fill: false, label, qrUrl: 'https://ondapmvp.vercel.app/s/OD-3QNT-CPFA' });
  const qr = await qrIn(pdf);
  const want = qr && qr.modules > 21 ? 'https://ondapmvp.vercel.app/s/OD-3QNT-CPFA' : 'OD-3QNT-CPFA';
  check(`${paper} ${sizeCm}cm QR 판독`, qr?.text === want, `${qr?.text} (${qr?.modules}칸)`);
}

// QR을 넣어도 장 수가 늘 때 파일이 거의 커지지 않는다 (한 번 만들어 재사용)
const one = await buildPrintPdf({ png, sticker: { shape: 'circle', sizeCm: 6 }, paper: 'A4', count: 12, fill: false, label, qrUrl: 'https://x.test/s/OD-3QNT-CPFA' });
const many = await buildPrintPdf({ png, sticker: { shape: 'circle', sizeCm: 6 }, paper: 'A4', count: 12 * 100, fill: false, label, qrUrl: 'https://x.test/s/OD-3QNT-CPFA' });
const none = await buildPrintPdf({ png, sticker: { shape: 'circle', sizeCm: 6 }, paper: 'A4', count: 12 * 100, fill: false, label, qrUrl: null });
check('100장 PDF에 QR을 넣어도 크기 차이 작음', many.pdf.length - none.pdf.length < 60_000, `1장 ${one.pdf.length}B, 100장 ${many.pdf.length}B, QR 없이 100장 ${none.pdf.length}B`);
const test = await buildPrintPdf({ png, sticker: { shape: 'circle', sizeCm: 6 }, paper: 'A4', count: 1, fill: false, label: { ...label, quantity: 1, test: true }, qrUrl: null });
check('시험 인쇄 1장: 1장·1칸', test.sheets === 1 && test.stickers === 1);
console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
process.exitCode = ok.every(Boolean) ? 0 : 1;
