// 시험용 접수 5건 (로컬 모드 data/designs.json + 인쇄 파일). ops·helper 검증이 이 코드들을 쓴다.
// 날짜는 실행 시각 기준: OD-3QNT-CPFA는 접수 5일째, OD-R2KH-56GT는 주문 확인 3일째라 '늦어지는 건' 2건이 된다
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const DAY = 86400000;
const text = (t) => ({ background: '#ffffff', fields: { recipient: '', sender: '', date: '' }, layers: [{ id: 'l1', x: 500, y: 500, rotation: 0, scaleX: 1, scaleY: 1, type: 'text', text: t, font: 'serif', fontSize: 78, color: '#1f2a26', stroke: null, shadow: false }] });
const DESIGNS = [
  { code: 'OD-7ZBM-MVL5', event: 'funeral', ago: 0, words: '보내주신 위로에\n깊이 감사드립니다' },
  { code: 'OD-2THX-RTKZ', event: 'wedding', ago: 0, words: '함께해 주셔서\n감사합니다' },
  { code: 'OD-L588-SM5T', event: 'funeral', ago: 0, words: '마음 깊이\n감사드립니다' },
  { code: 'OD-R2KH-56GT', event: 'wedding', ago: 3, status: 'order_confirmed', words: '고맙습니다' },
  { code: 'OD-3QNT-CPFA', event: 'wedding', ago: 5, words: '축복해 주셔서\n감사합니다' },
];

export async function writeFixtures(root) {
  const sharp = createRequire(join(root, 'package.json'))('sharp');
  const now = Date.now();
  const designs = DESIGNS.map((d, i) => {
    const at = new Date(now - d.ago * DAY - i * 60000).toISOString();
    return {
      productNo: 49, productName: '지리산 야생화로 채밀한 순수 자연산 벌꿀', quantity: 30, event: d.event,
      styleId: 's1', styleName: '송학 장생', sticker: { shape: 'circle', sizeCm: 6 }, draft: text(d.words),
      code: d.code, createdAt: at, statusChangedAt: at, hasPrintFile: true, status: d.status ?? 'received', orderNo: null, memo: '',
    };
  });
  writeFileSync(join(root, 'data/designs.json'), JSON.stringify(designs, null, 2));
  // 인쇄 파일: 6cm 원형 300dpi + 도련 = 756px 정사각 PNG
  const dir = join(root, 'data/design-files');
  mkdirSync(dir, { recursive: true });
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="756" height="756"><circle cx="378" cy="378" r="360" fill="#e8efe9" stroke="#1f2a26" stroke-width="6"/><text x="378" y="400" font-size="64" text-anchor="middle" fill="#1f2a26">ONDAP TEST</text></svg>');
  const png = await sharp(svg).png().toBuffer();
  for (const d of designs) writeFileSync(join(dir, `${d.code}.png`), png);
}
