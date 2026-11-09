import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 가상 DOM 및 브라우저 환경 모의(Mock) 구현
class MockElement {
  nodeType = 1;
  tagName: string;
  id: string = '';
  name: string = '';
  type: string = 'text';
  value: string = '';
  textContent: string = '';
  innerHTML: string = '';
  htmlFor: string = '';
  disabled: boolean = false;
  readOnly: boolean = false;
  offsetParent: MockElement | null = null;
  parentElement: MockElement | null = null;
  children: MockElement[] = [];
  attributes: Record<string, string> = {};
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className: string = '';

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.offsetParent = this; // 기본 가시(visible) 상태
  }

  get isConnected(): boolean {
    let p: MockElement | null = this;
    while (p) {
      if (p.tagName === 'BODY' || p.tagName === 'HTML') return true;
      p = p.parentElement;
    }
    return false;
  }

  get nextElementSibling(): MockElement | null {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    return idx >= 0 && idx + 1 < this.parentElement.children.length ? this.parentElement.children[idx + 1] : null;
  }

  setAttribute(k: string, v: string) {
    this.attributes[k] = v;
    if (k === 'id') this.id = v;
    if (k === 'name') this.name = v;
    if (k === 'type') this.type = v;
    if (k === 'for') this.htmlFor = v;
    if (k === 'class') this.className = v;
    if (k === 'value') this.value = v;
  }

  getAttribute(k: string): string | null {
    if (k === 'id') return this.id || null;
    if (k === 'name') return this.name || null;
    if (k === 'type') return this.type || null;
    if (k === 'for') return this.htmlFor || null;
    if (k === 'class') return this.className || null;
    if (k === 'value') return this.value || null;
    return this.attributes[k] !== undefined ? this.attributes[k] : null;
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  closest(selector: string): MockElement | null {
    let cur: MockElement | null = this;
    while (cur) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  matches(selector: string): boolean {
    const parts = selector.split(',').map((s) => s.trim());
    return parts.some((sel) => {
      let targetSel = sel;

      let reqTag = '';
      const tagMatch = targetSel.match(/^([a-zA-Z0-9_-]+)/);
      if (tagMatch) {
        reqTag = tagMatch[1].toLowerCase();
        targetSel = targetSel.slice(reqTag.length);
      }
      if (reqTag && this.tagName.toLowerCase() !== reqTag) {
        return false;
      }
      if (!targetSel) return true;

      if (targetSel.includes(':not([type])')) {
        if (this.attributes.type) return false;
        targetSel = targetSel.replace(':not([type])', '');
      }

      const classMatches = targetSel.match(/\.([a-zA-Z0-9_-]+)/g);
      if (classMatches) {
        const classes = this.className.split(/\s+/).filter(Boolean);
        for (const cm of classMatches) {
          const cName = cm.slice(1);
          if (!classes.includes(cName)) return false;
        }
        targetSel = targetSel.replace(/\.([a-zA-Z0-9_-]+)/g, '');
      }

      const idMatch = targetSel.match(/#([a-zA-Z0-9_-]+)/);
      if (idMatch) {
        if (this.id !== idMatch[1]) return false;
        targetSel = targetSel.replace(/#([a-zA-Z0-9_-]+)/, '');
      }

      const attrRegex = /\[([a-zA-Z0-9_-]+)(?:([\^$*]?=)(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
      let am;
      while ((am = attrRegex.exec(targetSel)) !== null) {
        const attrName = am[1];
        const op = am[2];
        const attrVal = am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : am[5] || '';
        const actual = this.getAttribute(attrName);
        if (actual === null) return false;
        if (!op) continue;
        if (op === '=' && actual !== attrVal) return false;
        if (op === '^=' && !actual.startsWith(attrVal)) return false;
        if (op === '$=' && !actual.endsWith(attrVal)) return false;
        if (op === '*=' && !actual.includes(attrVal)) return false;
      }

      return true;
    });
  }

  querySelector(selector: string): MockElement | null {
    const list = this.querySelectorAll(selector);
    return list.length ? list[0] : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const walk = (el: MockElement) => {
      for (const child of el.children) {
        if (child.matches(selector)) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  dispatchEvent(_event: unknown) {
    return true;
  }
}

class MockDocument {
  body: MockElement;
  readyState = 'complete';
  private listeners: Record<string, ((e: unknown) => void)[]> = {};

  constructor() {
    this.body = new MockElement('body');
  }

  createElement(tag: string): MockElement {
    return new MockElement(tag);
  }

  getElementById(id: string): MockElement | null {
    const find = (el: MockElement): MockElement | null => {
      if (el.id === id) return el;
      for (const c of el.children) {
        const found = find(c);
        if (found) return found;
      }
      return null;
    };
    return find(this.body);
  }

  querySelector(selector: string): MockElement | null {
    if (this.body.matches(selector)) return this.body;
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector: string): MockElement[] {
    const list = this.body.querySelectorAll(selector);
    if (this.body.matches(selector)) list.unshift(this.body);
    return list;
  }

  addEventListener(event: string, handler: (e: unknown) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener(event: string, handler: (e: unknown) => void) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
  }

  trigger(event: string, data?: unknown) {
    for (const h of this.listeners[event] || []) {
      h(data || {});
    }
  }
}

class MockLocalStorage {
  private store: Record<string, string> = {};
  getItem(k: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null;
  }
  setItem(k: string, v: string) {
    this.store[k] = String(v);
  }
  removeItem(k: string) {
    delete this.store[k];
  }
  clear() {
    this.store = {};
  }
}

// 카페24 원터치 주문서 DOM 트리 구성 헬퍼
function createCafe24OrderDom(opts: {
  isMobile?: boolean;
  activeProducts?: { productNo: number; qty: number; optionText?: string }[];
  fieldLabel?: string;
  fieldName?: string;
  initialFieldValue?: string;
}) {
  const doc = new MockDocument();
  const root = doc.body;

  // 카페24 스킨 공통: 10개의 더미 템플릿 prdBox (displaynone)
  for (let i = 0; i < 10; i++) {
    const dummyArea = doc.createElement('div');
    dummyArea.className = 'orderArea displaynone';
    dummyArea.offsetParent = null; // 숨김 상태

    const dummyBox = doc.createElement('div');
    dummyBox.className = 'prdBox';
    dummyBox.offsetParent = null;

    const dummyThumb = doc.createElement('div');
    dummyThumb.className = 'thumbnail';
    const dummyLink = doc.createElement('a');
    dummyLink.setAttribute('href', opts.isMobile ? '/m/product/detail.html' : '/product/detail.html');
    dummyThumb.appendChild(dummyLink);
    dummyBox.appendChild(dummyThumb);

    const dummyDesc = doc.createElement('div');
    dummyDesc.className = 'description';
    const dummyName = doc.createElement('strong');
    dummyName.className = 'prdName';
    dummyName.textContent = ''; // 더미 템플릿은 상품명 없음
    dummyDesc.appendChild(dummyName);
    dummyBox.appendChild(dummyDesc);

    dummyArea.appendChild(dummyBox);
    root.appendChild(dummyArea);
  }

  // 실제 활성 주문 상품 행 생성
  const activeProducts = opts.activeProducts || [{ productNo: 11, qty: 10, optionText: '포장신청 (+200원)' }];
  const activeArea = doc.createElement('div');
  activeArea.className = 'orderArea'; // visible

  for (const prod of activeProducts) {
    const box = doc.createElement('div');
    box.className = 'prdBox';

    const thumb = doc.createElement('div');
    thumb.className = 'thumbnail';
    const link = doc.createElement('a');
    link.setAttribute('href', (opts.isMobile ? '/m' : '') + `/product/detail.html?product_no=${prod.productNo}&cate_no=24`);
    const img = doc.createElement('img');
    img.setAttribute('src', 'https://ecimg.cafe24img.com/sample.jpg');
    link.appendChild(img);
    thumb.appendChild(link);
    box.appendChild(thumb);

    const desc = doc.createElement('div');
    desc.className = 'description';
    const nameEl = doc.createElement('strong');
    nameEl.className = 'prdName';
    nameEl.textContent = `테스트 상품 ${prod.productNo}`;
    desc.appendChild(nameEl);

    const infoUl = doc.createElement('ul');
    infoUl.className = 'info';
    const optLi = doc.createElement('li');
    optLi.setAttribute('title', '옵션');

    const optWrap = doc.createElement('div');
    optWrap.className = 'optionWrap';

    if (prod.optionText) {
      const optItemText = doc.createElement('div');
      optItemText.className = 'optionItem';
      optItemText.textContent = prod.optionText;
      optWrap.appendChild(optItemText);
    }

    const optItemQty = doc.createElement('div');
    optItemQty.className = 'optionItem';
    optItemQty.textContent = `${prod.qty}개`;
    optWrap.appendChild(optItemQty);

    optLi.appendChild(optWrap);
    infoUl.appendChild(optLi);
    desc.appendChild(infoUl);
    box.appendChild(desc);

    activeArea.appendChild(box);
  }
  root.appendChild(activeArea);

  // 추가입력란 영역 생성
  if (opts.fieldLabel !== 'none') {
    const addInputArea = doc.createElement('div');
    addInputArea.setAttribute('id', 'ec-jigsaw-area-additionalInput');

    const table = doc.createElement('table');
    const tbody = doc.createElement('tbody');
    tbody.className = 'xans-element- xans-order xans-order-ordadd';

    const tr = doc.createElement('tr');
    const th = doc.createElement('th');
    th.textContent = opts.fieldLabel || '답례큐 포장 디자인 코드';

    const td = doc.createElement('td');
    const input = doc.createElement('input');
    input.setAttribute('type', 'text');
    input.setAttribute('name', opts.fieldName || 'oa_content[1]');
    input.value = opts.initialFieldValue || '';

    td.appendChild(input);
    tr.appendChild(th);
    tr.appendChild(td);
    tbody.appendChild(tr);
    table.appendChild(tbody);
    addInputArea.appendChild(table);
    root.appendChild(addInputArea);
  }

  return { doc, root };
}

// ondap-helper 스크립트 비동기 실행 및 완료 대기 헬퍼
async function runHelper(ctx: {
  document: MockDocument;
  location: { pathname: string; search: string; href: string };
  localStorage: MockLocalStorage;
  fetchFn?: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
}) {
  const scriptContent = readFileSync(resolve('public/cafe24/ondap-helper.js'), 'utf8');

  const customFetch = ctx.fetchFn || (async (url: string) => {
    if (url.includes('/api/design/')) {
      const code = url.split('/api/design/')[1];
      return {
        ok: true,
        json: async () => ({
          code,
          productNo: 11,
          productName: '테스트 상품 11',
          quantity: 10,
          styleName: '보자기',
          sticker: { sizeCm: 5, shape: 'circle' },
          status: 'pending',
        }),
      };
    }
    return { ok: false, json: async () => ({ error: 'not_found' }) };
  });

  let virtualTime = Date.now();
  class MockDate extends Date {
    constructor(...args: any[]) {
      if (args.length === 0) super(virtualTime);
      else super(...(args as [any]));
    }
    static now() {
      return virtualTime;
    }
  }

  const sandbox = {
    document: ctx.document,
    location: ctx.location,
    localStorage: ctx.localStorage,
    window: {
      fetch: customFetch,
      jQuery: null,
      location: ctx.location,
      document: ctx.document,
      localStorage: ctx.localStorage,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    fetch: customFetch,
    navigator: {
      clipboard: {
        writeText: async () => {},
      },
    },
    setTimeout: (fn: () => void, delay?: number) => {
      virtualTime += (delay || 200);
      queueMicrotask(fn);
      return 1;
    },
    clearTimeout: () => {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    Event: class {
      type: string;
      constructor(t: string) { this.type = t; }
    },
    Date: MockDate,
  };

  const fn = new Function('window', 'document', 'location', 'localStorage', 'fetch', 'navigator', 'setTimeout', 'clearTimeout', 'MutationObserver', 'Event', 'Date', scriptContent);
  fn(sandbox.window, sandbox.document, sandbox.location, sandbox.localStorage, sandbox.fetch, sandbox.navigator, sandbox.setTimeout, sandbox.clearTimeout, sandbox.MutationObserver, sandbox.Event, sandbox.Date);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

test('1. PC 비회원 단일 상품 주문 시 주문서에 디자인 코드가 정상 자동 입력된다', async () => {
  const { doc } = createCafe24OrderDom({ isMobile: false, activeProducts: [{ productNo: 11, qty: 10 }] });
  const storage = new MockLocalStorage();
  storage.setItem('ondap_packaging', JSON.stringify({
    version: 2,
    entries: [{ productNo: '11', code: 'OD-A2B3-C4D5', qty: 10, at: Date.now() }],
  }));

  await runHelper({
    document: doc,
    location: { pathname: '/order/orderform.html', search: '', href: 'https://axopenlab.cafe24.com/order/orderform.html' },
    localStorage: storage,
  });

  const input = doc.querySelector('input[name="oa_content[1]"]') as MockElement;
  assert.ok(input, '추가입력란이 존재해야 함');
  assert.equal(input.value, 'OD-A2B3-C4D5', '디자인 코드가 자동 입력되어야 함');
  assert.equal(input.dataset.ondapAutoCode, 'OD-A2B3-C4D5', '자동 입력 플래그가 설정되어야 함');

  const banner = doc.getElementById('ondap-banner');
  assert.ok(banner, '안내 띠 배너가 표시되어야 함');
  assert.ok(banner.innerHTML.includes('코드를 넣었어요'), '성공 안내 문구가 표시되어야 함');
});

test('2. 모바일 비회원 단일 상품 주문 시 /m/ 주문서에서도 동일하게 자동 입력된다', async () => {
  const { doc } = createCafe24OrderDom({ isMobile: true, activeProducts: [{ productNo: 11, qty: 10 }] });
  const storage = new MockLocalStorage();
  storage.setItem('ondap_packaging', JSON.stringify({
    version: 2,
    entries: [{ productNo: '11', code: 'OD-M2B3-C4D5', qty: 10, at: Date.now() }],
  }));

  await runHelper({
    document: doc,
    location: { pathname: '/m/order/orderform.html', search: '', href: 'https://axopenlab.cafe24.com/m/order/orderform.html' },
    localStorage: storage,
  });

  const input = doc.querySelector('input[name="oa_content[1]"]') as MockElement;
  assert.ok(input, '모바일 주문서에 입력란이 존재해야 함');
  assert.equal(input.value, 'OD-M2B3-C4D5', '모바일에서도 코드가 정상 자동 입력되어야 함');

  const banner = doc.getElementById('ondap-banner');
  assert.ok(banner?.innerHTML.includes('코드를 넣었어요'), '모바일에서도 성공 안내가 나와야 함');
});

test('3. 회원 주문 경로에서도 비회원과 동일하게 자동 입력된다', async () => {
  const { doc } = createCafe24OrderDom({ isMobile: false, activeProducts: [{ productNo: 11, qty: 10 }] });
  const storage = new MockLocalStorage();
  storage.setItem('ondap_packaging', JSON.stringify({
    version: 2,
    entries: [{ productNo: '11', code: 'OD-USER-2345', qty: 10, at: Date.now() }],
  }));

  await runHelper({
    document: doc,
    location: { pathname: '/order/orderform.html', search: '', href: 'https://axopenlab.cafe24.com/order/orderform.html' },
    localStorage: storage,
  });

  const input = doc.querySelector('input[name="oa_content[1]"]') as MockElement;
  assert.ok(input, '입력란이 존재해야 함');
  assert.equal(input.value, 'OD-USER-2345', '회원 주문에서도 정상 입력되어야 함');
});

test('4. 다른 상품 주문 시에는 잘못된 코드 자동 입력을 금지하고 안내한다', async () => {
  const { doc } = createCafe24OrderDom({ isMobile: false, activeProducts: [{ productNo: 20, qty: 10 }] });
  const storage = new MockLocalStorage();
  storage.setItem('ondap_packaging', JSON.stringify({
    version: 2,
    entries: [{ productNo: '11', code: 'OD-DF22-PRD2', qty: 10, at: Date.now() }],
  }));

  await runHelper({
    document: doc,
    location: { pathname: '/order/orderform.html', search: '', href: 'https://axopenlab.cafe24.com/order/orderform.html' },
    localStorage: storage,
  });

  const input = doc.querySelector('input[name="oa_content[1]"]') as MockElement;
  assert.ok(input, '입력란이 존재해야 함');
  assert.equal(input.value, '', '다른 상품 주문 시 자동 입력되지 않아야 함');

  const banner = doc.getElementById('ondap-banner');
  assert.ok(banner?.innerHTML.includes('다른 상품'), '다른 상품 안내 문구가 표시되어야 함');
});

test('5. 수량 불일치 시 잘못된 코드 자동 입력을 금지하고 수량 확인 안내를 제공한다', async () => {
  const { doc } = createCafe24OrderDom({ isMobile: false, activeProducts: [{ productNo: 11, qty: 5 }] });
  const storage = new MockLocalStorage();
  storage.setItem('ondap_packaging', JSON.stringify({
    version: 2,
    entries: [{ productNo: '11', code: 'OD-DF22-QTY2', qty: 10, at: Date.now() }],
  }));

  await runHelper({
    document: doc,
    location: { pathname: '/order/orderform.html', search: '', href: 'https://axopenlab.cafe24.com/order/orderform.html' },
    localStorage: storage,
  });

  const input = doc.querySelector('input[name="oa_content[1]"]') as MockElement;
  assert.ok(input, '입력란이 존재해야 함');
  assert.equal(input.value, '', '수량 불일치 시 자동 입력되지 않아야 함');

  const banner = doc.getElementById('ondap-banner');
  assert.ok(banner?.innerHTML.includes('주문 수량') && (banner?.innerHTML.includes('달라') || banner?.innerHTML.includes('다르')), '수량 불일치 안내가 나와야 함');
});

test('6. 복수 상품 주문 시 공통 입력란에는 자동 입력을 중단하고 수동 입력을 안내한다', async () => {
  const { doc } = createCafe24OrderDom({
    isMobile: false,
    activeProducts: [
      { productNo: 11, qty: 10 },
      { productNo: 20, qty: 5 },
    ],
    fieldName: 'oa_content[1]',
  });
  const storage = new MockLocalStorage();
  storage.setItem('ondap_packaging', JSON.stringify({
    version: 2,
    entries: [{ productNo: '11', code: 'OD-MULT-PRD2', qty: 10, at: Date.now() }],
  }));

  await runHelper({
    document: doc,
    location: { pathname: '/order/orderform.html', search: '', href: 'https://axopenlab.cafe24.com/order/orderform.html' },
    localStorage: storage,
  });

  const input = doc.querySelector('input[name="oa_content[1]"]') as MockElement;
  assert.ok(input, '입력란이 존재해야 함');
  assert.equal(input.value, '', '복수 상품 공통란에는 자동 입력하지 않아야 함');

  const banner = doc.getElementById('ondap-banner');
  assert.ok(banner?.innerHTML.includes('여러 상품이 함께 담겨 있어요'), '복수 상품 안내가 나와야 함');
});

test('7. 고객이 직접 입력한 기존 다른 코드는 덮어쓰지 않고 유지한다', async () => {
  const { doc } = createCafe24OrderDom({
    isMobile: false,
    activeProducts: [{ productNo: 11, qty: 10 }],
    initialFieldValue: 'MY-CUSTOM-CODE',
  });
  const storage = new MockLocalStorage();
  storage.setItem('ondap_packaging', JSON.stringify({
    version: 2,
    entries: [{ productNo: '11', code: 'OD-AUT2-CD22', qty: 10, at: Date.now() }],
  }));

  await runHelper({
    document: doc,
    location: { pathname: '/order/orderform.html', search: '', href: 'https://axopenlab.cafe24.com/order/orderform.html' },
    localStorage: storage,
  });

  const input = doc.querySelector('input[name="oa_content[1]"]') as MockElement;
  assert.ok(input, '입력란이 존재해야 함');
  assert.equal(input.value, 'MY-CUSTOM-CODE', '고객의 기존 입력값이 그대로 유지되어야 함');

  const banner = doc.getElementById('ondap-banner');
  assert.ok(banner?.innerHTML.includes('이미 다른 코드가 적혀 있어요'), '기존 입력 유지 안내가 나와야 함');
});

test('8. 디자인 조회 API 실패 시 주문을 방해하지 않고 수동 안내 및 복사 버튼을 제공한다', async () => {
  const { doc } = createCafe24OrderDom({ isMobile: false, activeProducts: [{ productNo: 11, qty: 10 }] });
  const storage = new MockLocalStorage();
  storage.setItem('ondap_packaging', JSON.stringify({
    version: 2,
    entries: [{ productNo: '11', code: 'OD-AP2F-FAL2', qty: 10, at: Date.now() }],
  }));

  await runHelper({
    document: doc,
    location: { pathname: '/order/orderform.html', search: '', href: 'https://axopenlab.cafe24.com/order/orderform.html' },
    localStorage: storage,
    fetchFn: async () => ({
      ok: false,
      json: async () => ({ error: 'unavailable' }),
    }),
  });

  const input = doc.querySelector('input[name="oa_content[1]"]') as MockElement;
  assert.ok(input, '입력란이 존재해야 함');
  assert.equal(input.value, '', 'API 실패 시 입력되지 않아야 함');

  const banner = doc.getElementById('ondap-banner');
  assert.ok(banner?.innerHTML.includes('디자인 상태를 확인할 수 없어요') || banner?.innerHTML.includes('디자인과 주문 상품이 일치하지 않아요'), 'API 실패 시 친절한 수동 안내 노출');
});

test('9. 주문서에 입력란이 설치되지 않은 경우 오류 없이 복사 수동 입력을 안내한다', async () => {
  const { doc } = createCafe24OrderDom({
    isMobile: false,
    activeProducts: [{ productNo: 11, qty: 10 }],
    fieldLabel: 'none',
  });
  const storage = new MockLocalStorage();
  storage.setItem('ondap_packaging', JSON.stringify({
    version: 2,
    entries: [{ productNo: '11', code: 'OD-NFL2-FLD2', qty: 10, at: Date.now() }],
  }));

  await runHelper({
    document: doc,
    location: { pathname: '/order/orderform.html', search: '', href: 'https://axopenlab.cafe24.com/order/orderform.html' },
    localStorage: storage,
  });

  const banner = doc.getElementById('ondap-banner');
  assert.ok(banner?.innerHTML.includes('입력란을 찾을 수 없어요'), '입력란 부재 안내 표시');
});

test('10. 취소된 디자인 코드는 자동 입력하지 않고 새 코드 발급을 안내한다', async () => {
  const { doc } = createCafe24OrderDom({ isMobile: false, activeProducts: [{ productNo: 11, qty: 10 }] });
  const storage = new MockLocalStorage();
  storage.setItem('ondap_packaging', JSON.stringify({
    version: 2,
    entries: [{ productNo: '11', code: 'OD-CNCL-LED2', qty: 10, at: Date.now() }],
  }));

  await runHelper({
    document: doc,
    location: { pathname: '/order/orderform.html', search: '', href: 'https://axopenlab.cafe24.com/order/orderform.html' },
    localStorage: storage,
    fetchFn: async () => ({
      ok: true,
      json: async () => ({
        code: 'OD-CNCL-LED2',
        productNo: 11,
        quantity: 10,
        status: 'canceled',
      }),
    }),
  });

  const input = doc.querySelector('input[name="oa_content[1]"]') as MockElement;
  assert.ok(input, '입력란이 존재해야 함');
  assert.equal(input.value, '', '취소된 디자인 코드는 자동 입력되지 않아야 함');

  const banner = doc.getElementById('ondap-banner');
  assert.ok(banner?.innerHTML.includes('취소'), '취소 상태 안내가 나와야 함');
});

test('디자인 조회 중 입력란이 교체되면 이전 입력란에 성공 처리하지 않는다', async () => {
  const { doc } = createCafe24OrderDom({ activeProducts: [{ productNo: 11, qty: 10 }] });
  const storage = new MockLocalStorage();
  const code = 'OD-A2B3-C4D5';
  storage.setItem('ondap_packaging', JSON.stringify({ version: 2, entries: [{ productNo: '11', code, qty: 10, at: Date.now() }] }));
  const input = doc.querySelector('input[name="oa_content[1]"]')!;
  await runHelper({ document: doc, location: { pathname: '/order/orderform.html', search: '', href: 'https://axopenlab.cafe24.com/order/orderform.html' }, localStorage: storage,
    fetchFn: async () => { input.remove(); return { ok: true, json: async () => ({ code, productNo: 11, quantity: 10, status: 'pending' }) }; } });
  assert.equal(input.value, '');
  assert.ok(!doc.getElementById('ondap-banner')?.innerHTML.includes('코드를 넣었어요'));
});

test('포장 옵션 변경 시 자동 입력한 코드만 지운다', async () => {
  const { doc } = createCafe24OrderDom({ activeProducts: [{ productNo: 11, qty: 10, optionText: '포장신청' }] });
  const storage = new MockLocalStorage();
  const code = 'OD-A2B3-C4D5';
  storage.setItem('ondap_packaging', JSON.stringify({ version: 2, entries: [{ productNo: '11', code, qty: 10, at: Date.now() }] }));
  await runHelper({ document: doc, location: { pathname: '/order/orderform.html', search: '', href: 'https://axopenlab.cafe24.com/order/orderform.html' }, localStorage: storage });
  const input = doc.querySelector('input[name="oa_content[1]"]')!;
  assert.equal(input.value, code);
  const option = doc.querySelectorAll('.optionItem')[0];
  option.textContent = '신청안함';
  doc.trigger('change', { target: option });
  assert.equal(input.value, '');
});

test('옵션명 2개입을 주문 수량으로 오인하지 않는다', async () => {
  const { doc } = createCafe24OrderDom({ activeProducts: [{ productNo: 11, qty: 10, optionText: '2개입' }] });
  doc.querySelectorAll('.optionItem')[1].remove();
  const storage = new MockLocalStorage();
  const code = 'OD-A2B3-C4D5';
  storage.setItem('ondap_packaging', JSON.stringify({ version: 2, entries: [{ productNo: '11', code, qty: 2, at: Date.now() }] }));
  await runHelper({ document: doc, location: { pathname: '/order/orderform.html', search: '', href: 'https://axopenlab.cafe24.com/order/orderform.html' }, localStorage: storage,
    fetchFn: async () => ({ ok: true, json: async () => ({ code, productNo: 11, quantity: 2, status: 'pending' }) }) });
  assert.equal(doc.querySelector('input[name="oa_content[1]"]')?.value, '');
});
