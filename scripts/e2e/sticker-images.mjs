// 활성 스티커 이미지가 추천 설정이 없어도 직접 선택할 수 있는지 확인한다. 서버 데이터는 변경하지 않는다.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import sharp from 'sharp';
import { launch } from './cdp.mjs';

const base = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
for (const mobile of [true, false]) {
  const browser = await launch({ port: mobile ? 9363 : 9364, mobile });
  try {
    await browser.goto(`${base}/packaging?product=49&qty=30&event=wedding&relation=business`);
    await browser.waitFor(`window.Konva?.stages?.[0]?.find('Text').length > 0 && document.querySelector('.tab-body .sticker-grid button img')`, 30000);
    await browser.waitFor(`document.querySelector('.tab-body .sticker-grid button img')?.naturalWidth > 0`, 15000);
    const before = await browser.evaluate(`return {
      activeTab: document.querySelector('[role=tab][aria-selected=true]')?.textContent,
      headings: [...document.querySelectorAll('.tab-body .field-label')].map(e => e.textContent),
      visible: [...document.querySelectorAll('.tab-body .sticker-grid button')].filter(e => e.getClientRects().length).length,
      texts: window.Konva.stages[0].find('Text').map(t => t.text()).join(' '),
      images: window.Konva.stages[0].find('Image').length
    }`);
    assert.equal(before.activeTab, '이미지');
    assert.ok(before.visible > 0, '미확인 이미지를 펼치지 않아도 직접 고를 수 있어야 한다');
    assert.ok(before.headings.includes('등록된 이미지 직접 고르기'));
    assert.match(before.texts, /감사/);
    assert.equal(before.images, 0, '목적이 미확인된 이미지를 자동 적용하지 않는다');
    await browser.evaluate(`document.querySelector('.tab-body .sticker-grid button').click()`);
    await browser.waitFor(`window.Konva.stages[0].find('Image').length > 0`, 15000);
    await browser.waitFor(`window.Konva.stages[0].find('Text').length === 0`, 15000);
    assert.equal(await browser.evaluate(`return document.querySelector('.tab-body .sticker-grid button').getAttribute('aria-pressed')`), 'true');
    await browser.click('[role=tab]', '문구');
    assert.equal(await browser.evaluate(`return document.querySelector('[role=tab][aria-selected=true]')?.textContent`), '문구');
    await browser.click('button', '+ 문구 추가');
    await browser.waitFor(`window.Konva.stages[0].find('Text').some(t => t.text().includes('감사합니다'))`, 15000);
    await browser.click('[role=tab]', '이미지');
    await browser.evaluate(`document.querySelectorAll('.tab-body .sticker-grid button')[1].click()`);
    await browser.waitFor(`document.querySelectorAll('.tab-body .sticker-grid button')[1].getAttribute('aria-pressed') === 'true'`, 15000);
    assert.ok(await browser.evaluate(`return window.Konva.stages[0].find('Text').some(t => t.text().includes('감사합니다'))`), '두 번째 이미지 선택은 직접 추가한 문구를 보존해야 한다');

    // 새 편집에서 직접 올린 사진도 처음 한 번만 기본 문구를 지운다.
    await browser.evaluate(`localStorage.removeItem('ondap_editor_autosave')`);
    await browser.goto(`${base}/packaging?product=49&qty=30&event=wedding&relation=business`);
    await browser.waitFor(`window.Konva?.stages?.[0]?.find('Text').length > 0 && document.querySelector('input[type=file]')`, 30000);
    const temp = await mkdtemp(join(tmpdir(), 'ondap-sticker-upload-'));
    const photo = join(temp, 'photo.png');
    try {
      await sharp({ create: { width: 64, height: 64, channels: 3, background: '#338855' } }).png().toFile(photo);
      await browser.setFile('input[type=file]', photo);
      await browser.waitFor(`window.Konva.stages[0].find('Image').some(n => n.image()?.src?.startsWith('blob:')) && window.Konva.stages[0].find('Text').length === 0`, 15000);
    } finally {
      await unlink(photo).catch(() => {});
      await rmdir(temp);
    }
    // 기본 문구를 고객이 먼저 고쳤다면 첫 이미지에서도 보존한다.
    await browser.evaluate(`localStorage.clear()`);
    await browser.goto(`${base}/packaging?product=49&qty=30&event=wedding&relation=business`);
    await browser.waitFor(`window.Konva?.stages?.[0]?.find('Text').length > 0 && document.querySelector('.tab-body .sticker-grid button')`, 30000);
    await browser.click('[role=tab]', '문구');
    await browser.evaluate(`window.Konva.stages[0].find('Text')[0].fire('mousedown', { evt: { button: 0 } })`);
    await browser.waitFor(`document.querySelector('textarea[aria-label="문구"]')`, 15000);
    await browser.evaluate(`const el = document.querySelector('textarea[aria-label="문구"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, '직접 고친 문구'); el.dispatchEvent(new Event('input', { bubbles: true }));`);
    await browser.waitFor(`window.Konva.stages[0].find('Text').some(t => t.text().includes('직접 고친 문구'))`, 15000);
    await browser.click('[role=tab]', '이미지');
    await browser.evaluate(`document.querySelector('.tab-body .sticker-grid button').click()`);
    await browser.waitFor(`window.Konva.stages[0].find('Image').length > 0`, 15000);
    assert.ok(await browser.evaluate(`return window.Konva.stages[0].find('Text').some(t => t.text().includes('직접 고친 문구'))`), '고객이 수정한 기본 문구는 지우지 않는다');
    console.log(`통과: ${mobile ? '모바일' : 'PC'} 등록 이미지 표시·선택·문구 전환`);
  } finally {
    await browser.close();
  }
}
