import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ACTIVE, MAX_LAYERS, bleedUnits, canActivate, effectiveDpi, fillPlaceholders, generateDesignCode,
  normalizeDesignCode, pngSize, printPixels, sanitizeDraft, sanitizeSticker,
} from '../src/packaging/rules.ts';

test('인쇄 파일은 재단 여백 2mm 포함 300dpi', () => {
  assert.equal(printPixels(4), 520); // 4.4cm
  assert.equal(printPixels(6), 756); // 6.4cm
  assert.ok(Math.abs(bleedUnits(6) - 31.25) < 1e-9);
});

test('사진 해상도: 6cm 스티커를 꽉 채운 800px 사진은 300dpi 이상, 400px는 150dpi 미만', () => {
  assert.ok(effectiveDpi(800, 1000, 6) > 300);
  assert.ok(effectiveDpi(400, 1000, 6) < 160);
  assert.ok(effectiveDpi(400, 1000, 6) > effectiveDpi(400, 2000, 6));
});

test('디자인 코드는 OD-XXXX-XXXX, 헷갈리는 글자(0 O 1 I)가 없다', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateDesignCode();
    assert.match(code, /^OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(normalizeDesignCode(code), code);
  }
  assert.equal(generateDesignCode(() => new Uint8Array(8)), 'OD-AAAA-AAAA');
  assert.equal(generateDesignCode(() => new Uint8Array(8).fill(255)), 'OD-9999-9999');
});

test('고객이 적은 코드는 소문자·공백을 정리해 찾는다', () => {
  assert.equal(normalizeDesignCode(' od-7qdf-3p6m '), 'OD-7QDF-3P6M');
  assert.equal(normalizeDesignCode('OD-7QDF- 3P6M'), 'OD-7QDF-3P6M');
  assert.equal(normalizeDesignCode('OD-0000-1111'), null);
  assert.equal(normalizeDesignCode('../etc/passwd'), null);
  assert.equal(normalizeDesignCode(''), null);
});

test('자리표시자: 적은 값으로 바꾸고, 빈 칸은 ○○○로 보여 준다', () => {
  const fields = { recipient: '', sender: '김온답', date: '' };
  assert.equal(fillPlaceholders('함께해 주셔서 감사합니다\n{보내는분} 올림', fields), '함께해 주셔서 감사합니다\n김온답 올림');
  assert.equal(fillPlaceholders('{받는분}님께 {날짜}', fields), '○○○님께 ○○○');
  assert.equal(fillPlaceholders('{보내는분}{보내는분}', { ...fields, sender: ' 홍 ' }), '홍홍');
});

test('PNG 크기 읽기: 실제 PNG는 읽고 다른 형식은 null', () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0xf4, 0, 0, 2, 0xf4]);
  assert.deepEqual(pngSize(png), { width: 756, height: 756 });
  assert.equal(pngSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(0)])), null);
  assert.equal(pngSize(new Uint8Array(4)), null);
});

test('스티커 규격은 원형·사각 × 4·6cm만', () => {
  assert.deepEqual(sanitizeSticker({ shape: 'circle', sizeCm: 6 }), { shape: 'circle', sizeCm: 6 });
  assert.deepEqual(sanitizeSticker({ shape: 'square', sizeCm: '4' }), { shape: 'square', sizeCm: 4 });
  assert.equal(sanitizeSticker({ shape: 'star', sizeCm: 6 }), null);
  assert.equal(sanitizeSticker({ shape: 'circle', sizeCm: 10 }), null);
  assert.equal(sanitizeSticker(null), null);
});

test('고객 디자인 정리: 이상한 값은 버리거나 범위 안으로', () => {
  const draft = sanitizeDraft({
    background: 'red;',
    fields: { sender: 'x'.repeat(100) },
    layers: [
      { type: 'image', src: 'javascript:alert(1)', x: 1, y: 1 },
      { type: 'image', src: 'upload', x: 'a', y: 1e9, width: 1200, height: 800, rotation: 10, scaleX: 99, scaleY: 1 },
      { type: 'text', text: 'y'.repeat(500), font: 'comic', color: '#ABCDEF', stroke: 'blue', shadow: 'yes', fontSize: 9999 },
      { type: 'script' },
      ...Array.from({ length: 20 }, () => ({ type: 'text', text: 'a' })),
    ],
  });
  assert.equal(draft.background, '#ffffff');
  assert.equal(draft.fields.sender.length, 30);
  assert.equal(draft.layers.length <= MAX_LAYERS, true);
  const [img, txt] = draft.layers;
  assert.equal(img.type, 'image');
  assert.equal(img.type === 'image' && img.src, 'upload');
  assert.equal(img.x, 500);
  assert.equal(img.y, 3000);
  assert.equal(img.scaleX, 20);
  assert.equal(txt.type, 'text');
  if (txt.type === 'text') {
    assert.equal(txt.text.length, 200);
    assert.equal(txt.font, 'sans');
    assert.equal(txt.color, '#ABCDEF');
    assert.equal(txt.stroke, null);
    assert.equal(txt.shadow, false);
    assert.equal(txt.fontSize, 400);
  }
});

test(`'사용'은 최대 ${MAX_ACTIVE}개: 이미 켜진 항목은 다시 저장할 수 있다`, () => {
  const items = Array.from({ length: MAX_ACTIVE }, (_, i) => ({ id: `a${i}`, active: true }));
  assert.equal(canActivate(items, 'new'), false);
  assert.equal(canActivate(items, 'a3'), true);
  assert.equal(canActivate([...items.slice(1), { id: 'a0', active: false }], 'new'), true);
});
