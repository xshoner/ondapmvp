/*
 * 온답 포장 디자인 도우미 (카페24 쇼핑몰에서 실행)
 * 카페24 스마트디자인 레이아웃의 </body> 바로 위에 한 줄만 넣는다 (PC·모바일 스킨 각각):
 *   <script src="https://ondapmvp.vercel.app/cafe24/ondap-helper.js" defer></script>
 *
 * 1) 온답 '주문하러 가기' 주소의 ondap_code·ondap_qty를 이 브라우저에 24시간 기억
 * 2) 상품 상세: 수량을 맞추고 안내 띠를 보여 준다
 * 3) 로그인 화면: 비회원 구매도 된다고 알려 준다
 * 4) 주문서: '온답 포장 디자인 코드' 칸에 코드를 자동으로 넣는다 (칸이 없으면 복사 버튼)
 * 5) 주문 완료: 기억한 코드를 지운다
 */
(function () {
  'use strict';

  var KEY = 'ondap_packaging';
  var LABEL = '온답 포장 디자인 코드';
  var CODE = /^OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
  var TTL = 24 * 3600 * 1000;

  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && CODE.test(v.code) && Date.now() - v.at < TTL) return v;
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

  function banner(html, actions) {
    var old = document.getElementById('ondap-banner');
    if (old) old.remove();
    var bar = document.createElement('div');
    bar.id = 'ondap-banner';
    bar.setAttribute('role', 'status');
    bar.style.cssText = [
      'position:fixed', 'left:12px', 'right:12px', 'bottom:12px', 'z-index:2147483000', 'max-width:720px', 'margin:0 auto',
      'background:linear-gradient(135deg,#4a7d6b,#2f5a4b 55%,#1f3f34)', 'color:#fff', 'border-radius:14px',
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

  var badge = function (code) {
    return '<b style="font-family:Consolas,monospace;letter-spacing:.04em;background:rgba(255,255,255,.18);padding:1px 6px;border-radius:6px">' + code + '</b>';
  };

  function onProductPage(state, fromLink) {
    var no = String(window.iProductNo || new URLSearchParams(location.search).get('product_no') || '');
    if (state.productNo && no && state.productNo !== no) return; // 다른 상품
    var qtyText = '';
    if (fromLink && state.qty > 1) {
      var qty = document.querySelector('#quantity');
      if (qty && qty.offsetParent !== null) {
        qty.value = String(state.qty);
        fire(qty);
        qtyText = ' 수량은 <b>' + state.qty + '개</b>로 맞춰 두었어요.';
      } else {
        qtyText = ' 옵션을 고르고 수량 <b>' + state.qty + '개</b>를 선택해 주세요.';
      }
    }
    banner('🎀 포장 디자인 ' + badge(state.code) + ' 접수 완료.' + qtyText +
      '<br>‘바로 구매’를 누르면 주문서에 코드가 자동으로 들어가요.');
  }

  function onLoginPage(state) {
    if (!/noMember=1/.test(location.search)) return;
    banner('🎀 회원가입 없이 아래 <b>‘비회원 구매’</b>로도 주문할 수 있어요.<br>포장 디자인 ' + badge(state.code) + '는 주문서에 자동으로 들어가요.');
  }

  // 항목 이름이 적힌 칸(th·label 등)을 찾고, 같은 줄(tr·li)의 입력칸을 돌려준다. 스킨마다 구조가 달라 이름으로 찾는다
  function findCodeField() {
    var heads = document.querySelectorAll('th, label, dt, strong, span, p');
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      if (h.textContent.indexOf(LABEL) === -1 || h.textContent.length > LABEL.length + 20) continue;
      var row = h.closest('tr, li, dl, .ec-base-table') || h.parentElement;
      var field = row && row.querySelector('input[type="text"], input:not([type]), textarea');
      if (field) return field;
    }
    return null;
  }

  function onOrderForm(state) {
    waitFor(findCodeField, function (field) {
      if (field) {
        if (!field.value.trim()) {
          field.value = state.code;
          fire(field);
        }
        field.style.outline = '2px solid #2f5a4b';
        // 안내 띠에는 검증된 코드만 넣는다 (입력칸 값은 고객이 바꿀 수 있으므로 HTML에 쓰지 않음)
        banner('🎀 주문서 ‘' + LABEL + '’ 칸에 포장 디자인 코드 ' + badge(state.code) + '를 넣어 두었어요. 이대로 주문하시면 돼요.');
      } else {
        banner('🎀 포장 디자인 ' + badge(state.code) + '를 주문서 요청 칸에 적어 주세요.', [copyButton(state.code)]);
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
        productNo: params.get('product_no') || '',
        at: Date.now(),
      });
    }
    var state = load();
    if (!state) return;

    var path = location.pathname;
    if (/order_result\.html/.test(path)) return clear();
    if (/\/product\/detail\.html|\/product\/[^/]+\/\d+/.test(path)) return onProductPage(state, fromLink);
    if (/\/member\/login\.html/.test(path)) return onLoginPage(state);
    if (/\/order\/orderform\.html/.test(path)) return onOrderForm(state);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
