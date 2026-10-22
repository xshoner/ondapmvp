/*
 * 온답 포장 디자인 도우미 (카페24 쇼핑몰에서 실행)
 * 카페24 스마트디자인에 아래 한 줄을 넣는다 (PC·모바일 스킨 각각):
 *   - layout/basic/layout.html 의 </body> 바로 위 (상품 상세·로그인 화면)
 *   - order/orderform.html 맨 아래 (주문서는 다른 레이아웃을 써서 따로 넣어야 한다)
 *   <script src="https://ondapmvp.vercel.app/cafe24/ondap-helper.js" defer></script>
 *
 * 0) 상품 상세: 구매 버튼 아래 '포장·스티커 꾸미기' 버튼 (추천을 거치지 않은 고객도 바로 꾸밀 수 있게)
 * 1) 온답 '주문하러 가기' 주소의 ondap_code·ondap_qty를 이 브라우저에 24시간 기억
 * 2) 상품 상세: 수량을 맞추고 안내 띠를 보여 준다
 * 3) 로그인 화면: 비회원 구매도 된다고 알려 준다
 * 4) 주문서: '온답 포장 디자인 코드' 칸에 코드를 자동으로 넣는다 (칸이 없으면 복사 버튼).
 *    온답에서 포장 내용(포장지·스티커·수량)을 받아 보여 주고, 주문 수량이 디자인 수량과 다르면 알린다
 * 5) 주문 완료(스크립트가 있을 때): 기억한 코드를 지운다. 없어도 주문서에 넣은 뒤 1시간이면 잊는다
 */
(function () {
  'use strict';

  var KEY = 'ondap_packaging';
  var LABEL = '온답 포장 디자인 코드';
  var CODE = /^OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
  var TTL = 24 * 3600 * 1000;
  // 주문서에 넣은 뒤로는 1시간만 기억 (주문 완료 화면에 스크립트가 없어도 다음 주문에 남지 않게)
  var AFTER_FILL_TTL = 3600 * 1000;
  // 이 스크립트를 내려준 온답 주소 (운영 주소가 바뀌면 스킨의 한 줄만 바꾸면 된다)
  var APP = (function () {
    try { return new URL(document.currentScript.src).origin; } catch (e) { return 'https://ondapmvp.vercel.app'; }
  })();

  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && CODE.test(v.code) && Date.now() - v.at < TTL && !(v.filledAt && Date.now() - v.filledAt > AFTER_FILL_TTL)) {
        v.qty = Math.min(100000, Math.max(1, Number(v.qty) || 1)); // 화면 문구에 들어가므로 숫자로 고정
        return v;
      }
    } catch (e) { /* 저장소를 못 쓰는 브라우저 */ }
    return null;
  }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* 무시 */ } }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ } }

  function fire(el) {
    if (window.jQuery) window.jQuery(el).trigger('input').trigger('change');
    else {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // 조건을 만족할 때까지 잠깐 기다린다 (카페24 화면 일부는 늦게 그려진다)
  function waitFor(find, done, ms) {
    var until = Date.now() + (ms || 5000);
    (function tick() {
      var found = find();
      if (found || Date.now() > until) return done(found || null);
      setTimeout(tick, 200);
    })();
  }

  // 화면 위쪽에 띄운다 (모바일 스킨은 아래쪽에 구매 버튼이 고정돼 있어 가리지 않도록)
  function banner(html, actions) {
    var old = document.getElementById('ondap-banner');
    if (old) old.remove();
    var bar = document.createElement('div');
    bar.id = 'ondap-banner';
    bar.setAttribute('role', 'status');
    bar.style.cssText = [
      'position:fixed', 'left:12px', 'right:12px', 'top:12px', 'z-index:2147483000', 'max-width:720px', 'margin:0 auto',
      'background:#1f4436', 'border-left:4px solid #b08a4a', 'color:#fff', 'border-radius:10px',
      'box-shadow:0 8px 24px rgba(0,0,0,.25)', 'padding:14px 44px 14px 16px', 'font-size:14px', 'line-height:1.5',
      "font-family:'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif", 'text-align:left',
    ].join(';');
    bar.innerHTML = html;
    (actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.label;
      b.style.cssText = 'margin:8px 8px 0 0;padding:6px 12px;border:1px solid rgba(255,255,255,.7);border-radius:999px;background:transparent;color:#fff;font-size:13px;cursor:pointer';
      b.onclick = function () { a.run(b); };
      bar.appendChild(b);
    });
    var x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', '닫기');
    x.textContent = '×';
    x.style.cssText = 'position:absolute;top:6px;right:10px;border:0;background:transparent;color:#fff;font-size:22px;cursor:pointer;line-height:1';
    x.onclick = function () { bar.remove(); };
    bar.appendChild(x);
    document.body.appendChild(bar);
  }

  function copyButton(code) {
    return {
      label: '코드 복사',
      run: function (b) {
        var ok = function () { b.textContent = '복사됨'; };
        if (navigator.clipboard) navigator.clipboard.writeText(code).then(ok, function () { b.textContent = code; });
        else b.textContent = code;
      },
    };
  }

  var esc = function (v) {
    return String(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };

  var badge = function (code) {
    return '<b style="font-family:Consolas,monospace;letter-spacing:.04em;background:rgba(255,255,255,.18);padding:1px 6px;border-radius:6px">' + code + '</b>';
  };

  // 카페24 상품 스크립트가 페이지 로딩 뒤 수량을 1로 다시 맞추므로, 로딩이 끝날 때까지 몇 번 더 맞춘다.
  // 고객이 수량을 직접 건드리면 그때부터는 손대지 않는다.
  function keepQuantity(input, n) {
    var touched = false;
    var stop = function () { touched = true; };
    var box = input.closest('.quantity, td, li') || input.parentElement;
    box.addEventListener('click', stop, true);
    input.addEventListener('keydown', stop);
    var apply = function () {
      if (touched || input.value === String(n)) return;
      input.value = String(n);
      fire(input);
    };
    apply();
    window.addEventListener('load', apply);
    [300, 800, 1500, 2500, 4000].forEach(function (ms) { setTimeout(apply, ms); });
  }

  function onProductPage(state, fromLink) {
    var no = productNoHere(); // 짧은 상품 주소(/product/이름/11/)에서도 번호를 찾는다
    if (state.productNo && no && state.productNo !== no) return; // 다른 상품
    var qtyText = '';
    if (fromLink && state.qty > 1) {
      var qty = document.querySelector('#quantity');
      if (qty && qty.offsetParent !== null) {
        keepQuantity(qty, state.qty);
        qtyText = ' 수량은 <b>' + state.qty + '개</b>로 맞춰 두었어요.';
      } else {
        qtyText = ' 옵션을 고르고 수량 <b>' + state.qty + '개</b>를 선택해 주세요.';
      }
    }
    banner('포장 디자인 ' + badge(state.code) + ' 접수 완료.' + qtyText +
      '<br>‘바로 구매’(모바일은 ‘구매하기’)를 누르면 주문서에 코드가 자동으로 들어가요.');
  }

  function productNoHere() {
    var m = location.pathname.match(/\/product\/[^/]+\/(\d+)/);
    return String(window.iProductNo || new URLSearchParams(location.search).get('product_no') || (m && m[1]) || '').replace(/\D/g, '');
  }

  // 구매 버튼 묶음 바로 아래에 둔다. 화면 아래에 고정되는 구매 막대(#orderFixArea 등)에는 넣지 않는다
  function addPackagingButton(state) {
    var no = productNoHere();
    if (!no || document.getElementById('ondap-pack-btn')) return;
    var buy = [].slice.call(document.querySelectorAll('a, button')).filter(function (a) {
      return /product_submit\(1/.test(a.getAttribute('onclick') || '') && !a.closest('#orderFixArea, .gFixed');
    })[0];
    var anchor = buy && (buy.closest('.xans-product-action') || buy.parentElement);
    if (!anchor) return;
    var again = state && state.productNo === no;
    var link = document.createElement('a');
    link.id = 'ondap-pack-btn';
    link.style.cssText = [
      'display:block', 'margin:10px 0', 'padding:12px 14px', 'border:1px solid #1f4436', 'border-radius:8px', 'background:#ffffff',
      'color:#1f4436 !important', 'text-align:center', 'text-decoration:none', 'line-height:1.4',
      "font-family:'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif",
    ].join(';');
    link.innerHTML = '<b style="font-size:15px;color:#1f4436 !important">' + (again ? '포장 다시 꾸미기' : '포장·스티커 꾸미기 (무료)') + '</b>' +
      '<br><span style="font-size:12px;color:#5e6862 !important">포장지를 고르고 스티커에 문구·사진을 넣을 수 있어요</span>';
    // 누르는 순간의 수량을 함께 넘긴다
    var go = function () {
      var q = document.querySelector('#quantity');
      var n = Math.min(100000, Math.max(1, parseInt(q && q.value, 10) || 1));
      link.href = APP + '/packaging?product=' + no + '&qty=' + n + '&from=cafe24';
    };
    go();
    link.addEventListener('click', go);
    anchor.insertAdjacentElement('afterend', link);
  }

  function onLoginPage(state) {
    if (!/noMember=1/.test(location.search)) return;
    banner('회원가입 없이 아래 <b>‘비회원 구매’</b>로도 주문할 수 있어요.<br>포장 디자인 ' + badge(state.code) + '는 주문서에 자동으로 들어가요.');
  }

  // 항목 이름이 적힌 제목 칸(th·dt·label)을 찾고, 같은 줄(tr·li·dl)의 입력칸을 모은다. 스킨마다 구조가 달라 이름으로 찾는다.
  // 카페24는 이 항목을 상품마다 하나씩 그린다(oa_content[항목|상품번호]) → 장바구니 상품이 여럿이면 칸도 여럿
  function findCodeFields() {
    var heads = document.querySelectorAll('th, dt, label');
    var found = [];
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].textContent.indexOf(LABEL) === -1) continue;
      var row = heads[i].closest('tr, li, dl');
      var field = row && row.querySelector('input[type="text"], input:not([type]), textarea');
      if (field && found.indexOf(field) === -1) found.push(field);
    }
    return found.length ? found : null;
  }

  // 칸 이름에 상품번호가 있으면(oa_content[1|27]) 코드를 받은 상품의 칸만 쓴다. 다른 상품 주문에 엉뚱한 코드가 들어가지 않도록
  function forProduct(fields, productNo) {
    if (!fields || !productNo) return fields;
    var mine = fields.filter(function (f) { return new RegExp('\\|' + productNo + '\\]$').test(f.name || ''); });
    var numbered = fields.some(function (f) { return /\|\d+\]$/.test(f.name || ''); });
    return numbered ? (mine.length ? mine : null) : fields;
  }

  // 주문서의 상품 상자(.prdBox)에서 이 상품의 주문 수량('옵션' 칸의 'n개')을 더한다. 못 찾으면 null (스킨마다 다를 수 있다)
  function orderQuantity(productNo) {
    var total = 0;
    var found = false;
    [].slice.call(document.querySelectorAll('.prdBox')).forEach(function (box) {
      var link = box.querySelector('a[href*="product_no=' + productNo + '&"], a[href$="product_no=' + productNo + '"]');
      var chk = box.querySelector('input[name^="chk_order_cancel_list"]');
      if (!link && !(chk && String(chk.value).split(':')[0] === productNo)) return;
      var opt = box.querySelector('li[title="옵션"]');
      var m = opt && opt.textContent.match(/(\d[\d,]*)\s*개/);
      if (m) { total += parseInt(m[1].replace(/,/g, ''), 10); found = true; }
    });
    return found ? total : null;
  }

  // 주문서에서 내 포장 확인: 온답에서 포장지·스티커·수량을 받아 띠에 보여 준다 (코드를 아는 사람만 보는 공개 요약)
  function describe(state) {
    if (!window.fetch) return;
    fetch(APP + '/api/design/' + state.code).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || d.code !== state.code) return;
      var designQty = Number(d.quantity) || 0;
      var sticker = d.sticker ? Number(d.sticker.sizeCm) + 'cm ' + (d.sticker.shape === 'circle' ? '원형' : '사각') + ' 스티커' : '스티커 없음';
      var qty = orderQuantity(String(d.productNo));
      var lines = ['포장 디자인 ' + badge(state.code) + ' · ' + esc(d.styleName) + ' 포장 · ' + sticker + ' · ' + designQty + '개'];
      if (d.status === 'canceled') {
        lines.push('<b>이 디자인은 취소된 접수예요.</b> 온답에서 다시 꾸며 새 코드를 받아 주세요.');
      } else if (qty !== null && qty !== designQty) {
        lines.push('<b>주문 수량(' + qty + '개)과 디자인 수량(' + designQty + '개)이 달라요.</b> 스티커는 ' + designQty + '개를 인쇄해요. 수량을 맞추거나 온답 ‘내 디자인’에서 수량을 바꿔 다시 주문해 주세요.');
      } else {
        lines.push('주문서 ‘' + LABEL + '’ 칸에 코드를 넣어 두었어요. 이대로 주문하시면 돼요.');
      }
      banner(lines.join('<br>'));
    }).catch(function () { /* 온답에 닿지 않으면 처음 띠를 그대로 둔다 */ });
  }

  function onOrderForm(state) {
    waitFor(function () { return forProduct(findCodeFields(), state.productNo); }, function (fields) {
      if (fields) {
        if (!state.filledAt) save(Object.assign({}, state, { filledAt: Date.now() }));
        fields.forEach(function (field) {
          if (!field.value.trim()) {
            field.value = state.code;
            fire(field);
          }
          field.style.outline = '2px solid #1f4436';
        });
        // 안내 띠에는 검증된 코드만 넣는다 (입력칸 값은 고객이 바꿀 수 있으므로 HTML에 쓰지 않음)
        banner('주문서 ‘' + LABEL + '’ 칸에 포장 디자인 코드 ' + badge(state.code) + '를 넣어 두었어요. 이대로 주문하시면 돼요.');
        describe(state);
      } else if (!findCodeFields()) {
        // 항목 칸 자체가 없을 때만 복사 안내 (칸은 있는데 다른 상품 주문이면 조용히 넘어감)
        banner('포장 디자인 ' + badge(state.code) + '를 주문서 요청 칸에 적어 주세요.', [copyButton(state.code)]);
      }
    });
  }

  function run() {
    var params = new URLSearchParams(location.search);
    var linkCode = (params.get('ondap_code') || '').toUpperCase();
    var fromLink = CODE.test(linkCode);
    if (fromLink) {
      save({
        code: linkCode,
        qty: Math.min(100000, Math.max(1, parseInt(params.get('ondap_qty'), 10) || 1)),
        productNo: (params.get('product_no') || '').replace(/\D/g, ''),
        at: Date.now(),
      });
    }
    var state = load();
    var path = location.pathname;
    var productPage = /\/product\/detail\.html|\/product\/[^/]+\/\d+/.test(path);
    if (productPage) addPackagingButton(state);
    if (!state) return;

    if (/order_result\.html/.test(path)) return clear();
    if (productPage) return onProductPage(state, fromLink);
    if (/\/member\/login\.html/.test(path)) return onLoginPage(state);
    if (/\/order\/orderform\.html/.test(path)) return onOrderForm(state);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
