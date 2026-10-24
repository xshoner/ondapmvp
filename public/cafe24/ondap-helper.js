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

  function loadAll() {
    try {
      var stored = JSON.parse(localStorage.getItem(KEY) || 'null');
      var list = stored && stored.version === 2 ? stored.entries : stored ? [stored] : [];
      return Array.isArray(list) ? list.filter(function (v) {
        return v && /^\d+$/.test(String(v.productNo)) && (v.code === null || CODE.test(v.code)) && Number.isFinite(v.at) && Date.now() >= v.at && Date.now() - v.at < TTL && !(v.filledAt && Date.now() - v.filledAt > AFTER_FILL_TTL);
      }).slice(0, 30).map(function (v) { v.qty = Math.min(100000, Math.max(1, Math.round(Number(v.qty) || 1))); return v; }) : [];
    } catch (e) { /* 저장소를 못 쓰는 브라우저 */ }
    return [];
  }
  function save(v) {
    var list = loadAll().filter(function (old) { return old.productNo !== v.productNo || (v.code && old.code && old.code !== v.code); });
    try { localStorage.setItem(KEY, JSON.stringify({ version: 2, entries: [v].concat(list).slice(0, 30) })); } catch (e) { /* 무시 */ }
  }
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
    if (fromLink) {
      var qty = document.querySelector('#quantity');
      if (qty && qty.offsetParent !== null) {
        keepQuantity(qty, state.qty);
        qtyText = ' 수량은 <b>' + state.qty + '개</b>로 맞춰 두었어요.';
      } else {
        qtyText = ' 옵션을 고르고 수량 <b>' + state.qty + '개</b>를 선택해 주세요.';
      }
    }
    banner(state.code ? '포장 디자인 ' + badge(state.code) + ' 접수 완료.' + qtyText + '<br>옵션을 확인하고 구매해 주세요. 주문서에서 상품·수량·코드를 다시 확인해요.' : '온답에서 고른 상품이에요.' + qtyText + '<br>필요한 옵션을 고르고 주문 수량을 확인해 주세요.');
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
    var again = state && state.code && state.productNo === no;
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
    banner('회원가입 없이 아래 <b>‘비회원 구매’</b>로도 주문할 수 있어요.' + (state.code ? '<br>포장 디자인 ' + badge(state.code) + '를 주문서에서 확인해 주세요.' : ''));
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

  function orderRows(productNo) {
    return [].slice.call(document.querySelectorAll('.prdBox')).filter(function (box) {
      var chk = box.querySelector('input[name^="chk_order_cancel_list"]');
      var links = [].slice.call(box.querySelectorAll('a[href]'));
      return (chk && String(chk.value).split(':')[0] === productNo) || links.some(function (a) {
        try { var u = new URL(a.href, location.href); var m = u.pathname.match(/\/product\/[^/]+\/(\d+)/); return (u.searchParams.get('product_no') || (m && m[1])) === productNo; } catch(e) { return false; }
      });
    });
  }

  // 코드가 있다는 이유만으로 채우지 않는다. 요약 조회·단일 주문행·동일 수량을 확인한 뒤 한 칸만 쓴다.
  function onOrderFormAll(states) {
    var messages = {};
    var show = function (state, message) { messages[state.productNo + ':' + state.code] = message; banner(Object.keys(messages).map(function (key) { return messages[key]; }).join('<hr>')); };
    states.forEach(function (state) {
      if (!state.code || !orderRows(state.productNo).length) return;
      var same = states.filter(function (s) { return s.productNo === state.productNo && s.code; });
      var manual = function (reason) { show(state, '포장 디자인 ' + badge(state.code) + ': <b>' + reason + '</b> 상품·옵션별 코드를 직접 확인해 주세요. 자동 입력하지 않았어요.'); };
      if (same.length > 1 || orderRows(state.productNo).length !== 1) return manual('같은 상품의 옵션 또는 디자인이 여러 개예요.');
      waitFor(function () { return forProduct(findCodeFields(), state.productNo); }, function (fields) {
        if (!fields || fields.length !== 1 || (!/\|\d+\]$/.test(fields[0].name || '') && document.querySelectorAll('.prdBox').length !== 1)) return manual('주문 항목을 정확히 구분할 수 없어요.');
        var field = fields[0];
        if (field.value.trim() && field.value.trim() !== state.code) return manual('이미 다른 코드가 적혀 있어요.');
        if (!window.fetch) return manual('디자인 상태를 확인할 수 없어요.');
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timeout = setTimeout(function () { if (controller) controller.abort(); }, 8000);
        fetch(APP + '/api/design/' + state.code, controller ? { signal: controller.signal } : {}).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
          if (!d || d.code !== state.code || String(d.productNo) !== state.productNo) return manual('디자인과 상품을 확인할 수 없어요.');
          if (d.status !== 'received') return manual('취소됐거나 이미 주문 처리된 디자인이에요. 새 코드를 받아 주세요.');
          var qty = orderQuantity(state.productNo);
          if (qty === null || qty !== Number(d.quantity)) return manual('주문 수량과 디자인 수량이 달라요.');
          // 기다리는 사이 고객이 바꾼 입력도 덮어쓰지 않는다.
          if (field.value.trim() && field.value.trim() !== state.code) return manual('이미 다른 코드가 적혀 있어요.');
          field.value = state.code; fire(field);
          field.dataset.ondapAutoCode = state.code;
          field.style.outline = '2px solid #1f4436';
          if (!state.filledAt) save(Object.assign({}, state, { filledAt: Date.now() }));
          var sticker = d.sticker ? Number(d.sticker.sizeCm) + 'cm ' + (d.sticker.shape === 'circle' ? '원형' : '사각') + ' 스티커' : '스티커 없음';
          show(state, '포장 디자인 ' + badge(state.code) + ' · ' + esc(d.styleName) + ' · ' + sticker + ' · ' + qty + '개<br>주문서 ‘' + LABEL + '’ 칸에 코드를 넣어 두었어요. 이대로 주문하시면 돼요.');
          // 주문서가 수량/옵션/행을 바꾸면 자동으로 쓴 코드만 회수한다. 고객 입력은 지우지 않는다.
          var invalidated = false;
          var checkCurrent = function () {
            if (invalidated) return;
            var currentFields = forProduct(findCodeFields(), state.productNo);
            if (field.isConnected && currentFields && currentFields.length === 1 && currentFields[0] === field && orderRows(state.productNo).length === 1 && orderQuantity(state.productNo) === Number(d.quantity) && field.value.trim() === state.code) return;
            invalidated = true;
            if (field.dataset.ondapAutoCode === state.code && field.value === state.code) { field.value = ''; delete field.dataset.ondapAutoCode; fire(field); }
            show(state, '포장 디자인 ' + badge(state.code) + ': <b>주문 내용이 바뀌었어요.</b> 자동 입력한 코드는 회수했어요. 상품·옵션·수량과 코드를 다시 확인해 주세요.');
            if (observer) observer.disconnect();
            document.removeEventListener('input', onInput, true); document.removeEventListener('change', onInput, true);
          };
          var onInput = function (e) {
            if (e.target === field && (e.isTrusted || field.value !== state.code)) delete field.dataset.ondapAutoCode;
            if (e.target === field || (e.target.closest && e.target.closest('.prdBox'))) checkCurrent();
          };
          var observer = typeof MutationObserver !== 'undefined' ? new MutationObserver(function (records) {
            var relevant = records.some(function (r) {
              var target = r.target.nodeType === 1 ? r.target : r.target.parentElement;
              if (target && target.closest && target.closest('.prdBox')) return true;
              return [].slice.call(r.addedNodes).concat([].slice.call(r.removedNodes)).some(function (n) { return n.nodeType === 1 && (n.matches('.prdBox') || n.querySelector('.prdBox')); });
            });
            if (relevant) checkCurrent();
          }) : null;
          if (observer) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
          document.addEventListener('input', onInput, true); document.addEventListener('change', onInput, true);
        }).catch(function () { manual('디자인 상태를 확인할 수 없어요.'); }).finally(function () { clearTimeout(timeout); });
      });
    });
  }

  function run() {
    var params = new URLSearchParams(location.search);
    var linkCode = (params.get('ondap_code') || '').toUpperCase();
    var fromLink = CODE.test(linkCode) || params.get('ondap_order') === '1';
    var incoming = null;
    if (fromLink) {
      if (linkCode && !CODE.test(linkCode)) return;
      incoming = {
        code: linkCode || null,
        qty: Math.min(100000, Math.max(1, parseInt(params.get('ondap_qty'), 10) || 1)),
        productNo: productNoHere(),
        at: Date.now(),
      };
      if (incoming.productNo) save(incoming);
    }
    var states = loadAll();
    var matching = states.filter(function (s) { return s.productNo === productNoHere(); });
    var state = incoming || (matching.length === 1 ? matching[0] : null);
    var path = location.pathname;
    var productPage = /\/product\/detail\.html|\/product\/[^/]+\/\d+/.test(path);
    if (productPage) addPackagingButton(state);
    if (/order_result\.html/.test(path)) return clear();
    if (productPage && state) return onProductPage(state, fromLink);
    if (/\/member\/login\.html/.test(path) && states[0]) return onLoginPage(states[0]);
    if (/\/order\/orderform\.html/.test(path)) return onOrderFormAll(states);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
