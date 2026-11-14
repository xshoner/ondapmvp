/*
 * 온답 포장 디자인 도우미 (카페24 쇼핑몰에서 실행)
 * 카페24 스마트디자인에 아래 한 줄을 넣는다 (PC·모바일 스킨 각각):
 *   - layout/basic/layout.html 의 </body> 바로 위 (상품 상세·로그인 화면)
 *   - order/orderform.html 맨 아래 (주문서는 다른 레이아웃을 써서 따로 넣어야 한다)
 *   - order/order_result.html 맨 아래 (주문 완료 시 기억한 코드를 즉시 비운다)
 *   <script src="https://dapcue.vercel.app/cafe24/ondap-helper.js" defer></script>
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
  var LABEL = '답례큐 포장 디자인 코드';
  var LABELS = ['답례큐 포장 디자인 코드', '온답 포장 디자인 코드'];
  var CODE = /^OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
  var TTL = 24 * 3600 * 1000;
  // 주문서에 넣은 뒤로는 1시간만 기억 (주문 완료 화면에 스크립트가 없어도 다음 주문에 남지 않게)
  var AFTER_FILL_TTL = 3600 * 1000;
  // 이 스크립트를 내려준 온답 주소 (운영 주소가 바뀌면 스킨의 한 줄만 바꾸면 된다)
  var APP = (function () {
    try { return new URL(document.currentScript.src).origin; } catch (e) { return 'https://dapcue.vercel.app'; }
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
    try {
      if (window.jQuery) {
        if (el.tagName === 'SELECT') {
          window.jQuery(el).trigger('change');
        } else {
          window.jQuery(el).trigger('keyup').trigger('input').trigger('change').trigger('blur');
        }
      } else {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } catch (e) {
      /* 카페24 내부 리스너 예외가 스크립트 실행을 중단시키지 않도록 방어 */
    }
  }

  function isCafe24Ready(productNo) {
    try {
      if (!window.jQuery) return false;
      if (window.CAFE24 && window.CAFE24.SHOP_FRONT_NEW_OPTION_DATA) {
        var num = Number(productNo || productNoHere());
        if (num && !window.CAFE24.SHOP_FRONT_NEW_OPTION_DATA.getProductStockData(num)) return false;
      }
      return true;
    } catch (e) {
      return false;
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

  var PACKAGING_OPT_REGEX = /포장\s*디자인|포장디자인|답례\s*포장|포장\s*신청|포장\s*서비스|선물\s*포장|스티커\s*제작/i;
  var NEGATIVE_OPT_REGEX = /신청\s*하지\s*않|안\s*함|않\s*음|미\s*신청|없\s*음|불\s*필요|제\s*외|취\s*소|선택\s*안|선택\s*하지\s*않|미\s*선택|원치\s*않|원하지\s*않|기본\s*포장\s*없음/i;
  var POSITIVE_OPT_REGEX = /포장\s*신청|포장디자인\s*신청|신청|추가|선물\s*포장|포장\s*포함/i;

  function isPackagingApplicationChoice(contextText, choiceText) {
    var full = (contextText + ' ' + choiceText).trim();
    if (NEGATIVE_OPT_REGEX.test(choiceText) || NEGATIVE_OPT_REGEX.test(full)) return false;
    var isPkgContext = PACKAGING_OPT_REGEX.test(contextText) || PACKAGING_OPT_REGEX.test(choiceText);
    if (!isPkgContext) return false;
    return POSITIVE_OPT_REGEX.test(choiceText);
  }

  function findAndSelectPackagingOption() {
    var selects = document.querySelectorAll('select');
    for (var i = 0; i < selects.length; i++) {
      var sel = selects[i];
      if (sel.disabled) continue;
      var row = sel.closest('tr');
      var optionName = (sel.getAttribute('option_title') || '') + ' ' + (row && row.querySelector('th') ? row.querySelector('th').textContent : '');
      for (var j = 0; j < sel.options.length; j++) {
        var opt = sel.options[j];
        var groupName = opt.parentElement && opt.parentElement.tagName === 'OPTGROUP' ? opt.parentElement.label : '';
        var context = (optionName + ' ' + groupName).trim();
        if (opt.value && opt.value !== '*' && opt.value !== '**' && !opt.disabled && isPackagingApplicationChoice(context, opt.text)) {
          if (sel.value !== opt.value) {
            sel.value = opt.value;
            fire(sel);
          }
          return opt.text.trim();
        }
      }
    }
    var radios = document.querySelectorAll('input[type="radio"]');
    for (var r = 0; r < radios.length; r++) {
      var radio = radios[r];
      var label = radio.closest('label') || document.querySelector('label[for="' + radio.id + '"]');
      var text = (label ? label.textContent : '') + ' ' + (radio.value || '');
      var row = radio.closest('tr');
      var context = (radio.getAttribute('option_title') || '') + ' ' + (row && row.querySelector('th') ? row.querySelector('th').textContent : '');
      if (isPackagingApplicationChoice(context, text)) {
        if (!radio.checked) {
          radio.checked = true;
          fire(radio);
        }
        return text.trim();
      }
    }
    return null;
  }

  // 카페24 상품 스크립트가 페이지 로딩 뒤 수량을 1로 다시 맞추므로, 로딩이 끝날 때까지 몇 번 더 맞춘다.
  // 옵션 품목 수량(.quantity_opt) 또는 기본 수량(#quantity)을 모두 지원하며, 고객이 수량을 직접 건드리면 그때부터는 손대지 않는다.
  function visibleOptionQuantities() {
    return [].slice.call(document.querySelectorAll('input.quantity_opt, input[name="quantity_opt[]"], input[id*="quantity_opt"]')).filter(function (el) {
      return el.offsetParent !== null && !el.disabled;
    });
  }

  function keepQuantity(n) {
    var touched = false;
    var stop = function () {
      touched = true;
      if (observer) observer.disconnect();
    };
    document.addEventListener('click', function (e) {
      if (e.target && (e.target.matches('.up, .down, [class*="QuantityUp"], [class*="QuantityDown"], [class*="quantity_opt_up"]') || e.target.closest('.up, .down, [class*="QuantityUp"], [class*="QuantityDown"]'))) {
        stop();
      }
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.target && (e.target.matches('input.quantity_opt, #quantity, input[name="quantity_opt[]"]'))) {
        stop();
      }
    }, true);

    var apply = function () {
      if (touched) return;
      var optInputs = visibleOptionQuantities();
      if (optInputs.length === 1) {
        for (var i = 0; i < optInputs.length; i++) {
          var inp = optInputs[i];
          if (inp.value !== String(n)) {
            inp.value = String(n);
            fire(inp);
          }
        }
      } else if (optInputs.length === 0) {
        // 옵션 선택 드롭다운이 없는 일반 단품 상품일 때만 기본 #quantity 수량을 조정한다
        var hasOptionSelects = document.querySelectorAll('select[id*="product_option_id"], select[name*="option"]').length > 0;
        if (!hasOptionSelects) {
          var baseQty = document.querySelector('#quantity');
          if (baseQty && baseQty.offsetParent !== null && baseQty.value !== String(n)) {
            baseQty.value = String(n);
            fire(baseQty);
          }
        }
      }
    };
    // 옵션 품목은 서버 응답 뒤 늦게 생길 수 있어, 생성 시점에도 수량을 맞춘다.
    var observer = typeof MutationObserver === 'function' ? new MutationObserver(apply) : null;
    if (observer) observer.observe(document.querySelector('#totalProducts') || document.body, { childList: true, subtree: true });
    apply();
    // 필수 상품 옵션을 고객이 나중에 선택하면 생성된 품목에도 전달 수량을 반영한다.
    document.addEventListener('change', function (e) {
      if (e.target && e.target.matches('select[id*="product_option_id"], select[name*="option"], input[type="radio"]')) {
        setTimeout(apply, 100);
        setTimeout(apply, 500);
      }
    });
    window.addEventListener('load', apply);
    [100, 300, 600, 1200, 2000, 3200].forEach(function (ms) { setTimeout(apply, ms); });
    return apply;
  }

  function isTargetQuantityApplied(qty) {
    var optInputs = visibleOptionQuantities();
    if (optInputs.length > 0) return optInputs.length === 1 && Number(optInputs[0].value) === qty;
    var baseQty = document.querySelector('#quantity');
    return Boolean(baseQty && baseQty.offsetParent !== null && Number(baseQty.value) === qty);
  }

  function onProductPage(state, fromLink) {
    var no = productNoHere(); // 짧은 상품 주소(/product/이름/11/)에서도 번호를 찾는다
    if (state.productNo && no && state.productNo !== no) return; // 다른 상품
    var qty = state.qty;
    var autoOptSelected = false;
    var manualPackagingChoice = false;

    var renderBanner = function () {
      var optInputs = visibleOptionQuantities();
      var hasOptRow = optInputs.length > 0;
      var qtyReady = isTargetQuantityApplied(qty);
      if (autoOptSelected && hasOptRow && qtyReady) {
        banner(
          '포장 디자인 ' + badge(state.code) + ' 저장 완료.<br>' +
          '<b>포장 디자인 옵션과 수량(' + qty + '개)을 자동으로 선택</b>하고 총 결제 금액을 맞췄어요.<br>' +
          '주문서에서 상품·수량·코드를 다시 확인해요.',
          [copyButton(state.code)]
        );
      } else {
        var qtyInfo = qtyReady ? ' 수량은 <b>' + qty + '개</b>로 맞춰 두었어요.' : ' 옵션을 고르고 수량 <b>' + qty + '개</b>를 확인해 주세요.';
        banner(
          '포장 디자인 ' + badge(state.code) + ' 저장 완료.' + qtyInfo + '<br>' +
          '포장 디자인 서비스가 자동 적용되지 않았어요. 쇼핑몰의 옵션과 추가 요금을 확인해 주세요.',
          [copyButton(state.code)]
        );
      }
    };

    if (state.code) {
      var applyQuantity = keepQuantity(qty);
      var trySelect = function () {
        if (manualPackagingChoice || !isCafe24Ready(no)) return;
        var optText = findAndSelectPackagingOption();
        if (optText) {
          if (!autoOptSelected) setTimeout(renderBanner, 300);
          autoOptSelected = true;
          applyQuantity();
          setTimeout(applyQuantity, 150);
        }
      };
      trySelect();
      [150, 300, 600, 1000, 1800, 2800, 4500, 6500].forEach(function (ms) { setTimeout(trySelect, ms); });
      window.addEventListener('load', trySelect);

      // 다른 필수 옵션(맛/사이즈 등)을 먼저 골라야 포장 옵션이 활성화되는 복합 옵션 스킨 대응
      document.addEventListener('change', function (e) {
        if (e.target && e.target.matches('select, input[type="radio"]')) {
          var row = e.target.closest('tr');
          var optionTitle = (e.target.getAttribute('option_title') || '') + ' ' + (row && row.querySelector('th') ? row.querySelector('th').textContent : '');
          var choiceText = '';
          if (e.target.tagName === 'SELECT') {
            var opt = e.target.options && e.target.selectedIndex >= 0 ? e.target.options[e.target.selectedIndex] : null;
            choiceText = opt ? opt.text : '';
          } else {
            var lbl = e.target.closest('label') || (e.target.id ? document.querySelector('label[for="' + e.target.id + '"]') : null);
            choiceText = (lbl ? lbl.textContent : '') + ' ' + (e.target.value || '');
          }
          if (e.isTrusted && PACKAGING_OPT_REGEX.test(optionTitle + ' ' + choiceText)) {
            if (isPackagingApplicationChoice(optionTitle, choiceText)) {
              manualPackagingChoice = false;
              autoOptSelected = true;
              setTimeout(function () {
                applyQuantity();
                renderBanner();
              }, 120);
            } else {
              manualPackagingChoice = true;
              autoOptSelected = false;
              setTimeout(renderBanner, 100);
            }
          }
          setTimeout(trySelect, 100);
        }
      });

      // 배너는 준비 상태 및 옵션 행 생성 확인 후 노출
      setTimeout(renderBanner, 500);
      setTimeout(renderBanner, 1500);
    } else if (fromLink) {
      keepQuantity(qty);
      var renderFromLinkBanner = function () {
        var baseQtyText = isTargetQuantityApplied(qty) ? ' 수량은 <b>' + qty + '개</b>로 맞춰 두었어요.' : ' 필요한 옵션을 고르고 수량 <b>' + qty + '개</b>를 확인해 주세요.';
        banner('답례큐에서 고른 상품이에요.' + baseQtyText);
      };
      renderFromLinkBanner();
      document.addEventListener('change', function (e) {
        if (e.target && e.target.matches('select, input[type="radio"]') && document.getElementById('ondap-banner')) {
          setTimeout(renderFromLinkBanner, 150);
        }
      });
    }
  }

  function productNoHere() {
    var m = location.pathname.match(/\/product\/[^/]+\/(\d+)/);
    return String(window.iProductNo || new URLSearchParams(location.search).get('product_no') || (m && m[1]) || '').replace(/\D/g, '');
  }

  function findPackagingOptionPriceText() {
    var selects = document.querySelectorAll('select');
    for (var i = 0; i < selects.length; i++) {
      var sel = selects[i];
      var row = sel.closest('tr');
      var optionName = (sel.getAttribute('option_title') || '') + ' ' + (row && row.querySelector('th') ? row.querySelector('th').textContent : '');
      for (var j = 0; j < sel.options.length; j++) {
        var opt = sel.options[j];
        var groupName = opt.parentElement && opt.parentElement.tagName === 'OPTGROUP' ? opt.parentElement.label : '';
        var context = (optionName + ' ' + groupName).trim();
        if (opt.value && opt.value !== '*' && opt.value !== '**' && !opt.disabled && isPackagingApplicationChoice(context, opt.text)) {
          var m = opt.text.match(/\(\s*([+-]?\s*[\d,]+)\s*원?\s*\)/);
          if (m) {
            var num = m[1].replace(/[+,\s]/g, '');
            if (/^\d+$/.test(num)) {
              return Number(num).toLocaleString('ko-KR') + '원/개';
            }
          }
        }
      }
    }
    return null;
  }

  function getPackagingBtnLabel(again) {
    if (again) return '포장 다시 꾸미기';
    var priceText = findPackagingOptionPriceText();
    return priceText ? '포장·스티커 꾸미기 (' + priceText + ')' : '포장·스티커 꾸미기(유료)';
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
    link.innerHTML = '<b style="font-size:15px;color:#1f4436 !important">' + getPackagingBtnLabel(again) + '</b>' +
      '<br><span style="font-size:12px;color:#5e6862 !important">포장지를 고르고 스티커에 문구·사진을 넣을 수 있어요</span>';

    var updateLabel = function () {
      var titleEl = link.querySelector('b');
      if (titleEl && !again) {
        titleEl.textContent = getPackagingBtnLabel(false);
      }
    };
    [300, 800, 1500, 3000].forEach(function (ms) { setTimeout(updateLabel, ms); });

    // 누르는 순간의 수량을 함께 넘긴다
    var go = function (e) {
      var options = visibleOptionQuantities();
      if (options.length > 1) {
        if (e) { e.preventDefault(); alert('포장할 상품 옵션을 하나만 선택해 주세요.'); }
        return;
      }
      var q = options[0] || document.querySelector('#quantity');
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

  function isMatchingCodeLabel(txt) {
    if (!txt || typeof txt !== 'string') return false;
    var clean = txt.replace(/\s+/g, ' ').trim();
    if (LABELS.some(function (l) { return clean.indexOf(l) !== -1; })) return true;
    var norm = clean.replace(/[\s\-_()]/g, '');
    return /답례큐.*(포장.*디자인.*코드|디자인.*코드|포장.*코드)|온답.*(포장.*디자인.*코드|디자인.*코드|포장.*코드)|포장디자인코드/i.test(norm);
  }

  function isValidTextField(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'TEXTAREA') return !el.disabled && !el.readOnly;
    if (el.tagName === 'INPUT') {
      var t = (el.type || 'text').toLowerCase();
      if (t === 'hidden' || t === 'radio' || t === 'checkbox' || t === 'submit' || t === 'button' || t === 'file' || t === 'image') return false;
      return !el.disabled && !el.readOnly;
    }
    return false;
  }

  // 항목 이름이 적힌 제목 칸(th·dt·label 등)을 찾고 연결된 입력칸을 모은다. PC·모바일 스킨의 다양한 마크업 구조를 지원한다.
  function findCodeFields() {
    var heads = document.querySelectorAll('th, dt, label, .title, [class*="title"], [class*="name"]');
    var found = [];
    for (var i = 0; i < heads.length; i++) {
      var head = heads[i];
      if (!isMatchingCodeLabel(head.textContent)) continue;

      // 1) label[for] 속성 연결
      if (head.tagName === 'LABEL' && head.htmlFor) {
        var forEl = document.getElementById(head.htmlFor);
        if (isValidTextField(forEl) && found.indexOf(forEl) === -1) {
          found.push(forEl);
          continue;
        }
      }

      // 2) 테이블 행 또는 입력 필드 컨테이너 내부 탐색
      var container = head.closest('tr, li, dl, .ec-base-table tr, [class*="item"], [class*="segment"], [class*="row"], .form-row');
      var field = container && container.querySelector('input[type="text"], input:not([type]), textarea');
      if (isValidTextField(field) && found.indexOf(field) === -1) {
        found.push(field);
        continue;
      }

      // 3) 인접 형제 요소 또는 부모 요소 탐색
      if (head.parentElement) {
        var next = head.nextElementSibling;
        field = next && (isValidTextField(next) ? next : next.querySelector('input[type="text"], input:not([type]), textarea'));
        if (!isValidTextField(field)) {
          field = head.parentElement.querySelector('input[type="text"], input:not([type]), textarea');
        }
        if (isValidTextField(field) && found.indexOf(field) === -1) {
          found.push(field);
          continue;
        }
      }
    }

    // 4) placeholder, title, aria-label, fw-label 직접 매칭 보완
    if (!found.length) {
      var allInputs = document.querySelectorAll('input[type="text"], input:not([type]), textarea');
      for (var k = 0; k < allInputs.length; k++) {
        var inp = allInputs[k];
        if (!isValidTextField(inp)) continue;
        var meta = (inp.getAttribute('placeholder') || '') + ' ' + (inp.getAttribute('title') || '') + ' ' + (inp.getAttribute('aria-label') || '') + ' ' + (inp.getAttribute('fw-label') || '');
        if (isMatchingCodeLabel(meta) && found.indexOf(inp) === -1) {
          found.push(inp);
        }
      }
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

  function extractProductNo(box) {
    if (!box) return null;
    var chk = box.querySelector('input[name^="chk_order_cancel_list"]');
    if (chk && chk.value) {
      var p = String(chk.value).split(':')[0];
      if (/^\d+$/.test(p)) return p;
    }
    if (box.dataset && box.dataset.productNo) return String(box.dataset.productNo);
    var links = box.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      try {
        var rawHref = links[i].getAttribute('href') || links[i].href || '';
        if (!rawHref) continue;
        var u = new URL(rawHref, location.href);
        var q = u.searchParams.get('product_no');
        if (q && /^\d+$/.test(q)) return q;
        var m = u.pathname.match(/\/product\/[^/]+\/(\d+)/);
        if (m && m[1]) return m[1];
      } catch (e) {}
    }
    return null;
  }

  function isOrderBoxVisible(box) {
    if (!box || box.nodeType !== 1) return false;
    if (box.closest && (box.closest('.displaynone') || box.closest('[hidden]'))) return false;
    if (box.getClientRects && box.getClientRects().length === 0) return false;
    if (box.offsetParent === null) {
      if (box.style && box.style.display === 'none') return false;
      if (typeof window !== 'undefined' && window.getComputedStyle) {
        var st = window.getComputedStyle(box);
        if (st && (st.display === 'none' || st.visibility === 'hidden')) return false;
      }
    }
    var hasProductLink = Boolean(extractProductNo(box));
    if (!hasProductLink) return false;
    var nameEl = box.querySelector('.prdName');
    var imgEl = box.querySelector('img');
    var hasName = nameEl && nameEl.textContent.trim().length > 0;
    var imgSrc = (imgEl && (imgEl.getAttribute('src') || imgEl.src)) || '';
    var hasImg = imgSrc && imgSrc.indexOf('img_product_big.gif') === -1 && !imgSrc.endsWith('/');
    if (!hasName && !hasImg && !box.querySelector('input[name^="chk_order_cancel_list"]')) return false;
    return true;
  }

  function activeOrderRows(productNo) {
    var boxes = document.querySelectorAll('.prdBox');
    var rows = [];
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      if (!isOrderBoxVisible(box)) continue;
      var pNo = extractProductNo(box);
      if (!pNo) continue;
      if (!productNo || pNo === String(productNo)) {
        rows.push({ el: box, productNo: pNo });
      }
    }
    return rows;
  }

  function orderRows(productNo) {
    return activeOrderRows(productNo).map(function (r) { return r.el; });
  }

  // 주문서의 활성 상품 상자(.prdBox)에서 주문 수량을 확인한다
  function orderQuantity(productNo) {
    var rows = activeOrderRows(productNo);
    if (!rows.length) return null;
    var total = 0;
    var found = false;
    for (var i = 0; i < rows.length; i++) {
      var box = rows[i].el;
      var rowQty = null;

      // 1) 카페24 옵션 품목별 수량 텍스트 (.optionItem 의 'n개')
      var optItems = box.querySelectorAll('.optionItem');
      for (var j = 0; j < optItems.length; j++) {
        var text = optItems[j].textContent.trim();
        var mOpt = text.match(/^(\d[\d,]*)\s*개$/);
        if (mOpt) {
          rowQty = parseInt(mOpt[1].replace(/,/g, ''), 10);
        }
      }

      // 2) 수량 입력 필드
      if (rowQty === null) {
        var qInput = box.querySelector('input[name*="quantity"], input[name*="qty"]');
        if (qInput && /^\d+$/.test(qInput.value)) {
          rowQty = parseInt(qInput.value, 10);
        }
      }

      if (rowQty !== null && Number.isFinite(rowQty) && rowQty > 0) {
        total += rowQty;
        found = true;
      }
    }
    return found ? total : null;
  }

  function orderOptionSnapshot(box) {
    var items = [].slice.call(box.querySelectorAll('.optionItem'));
    var option = box.querySelector('li[title="옵션"], .optionWrap');
    var controls = [].slice.call(box.querySelectorAll('select, input'));
    return JSON.stringify({
      text: option ? option.textContent.trim() : '',
      items: items.map(function (el) { return el.textContent.trim(); }),
      controls: controls.map(function (el) { return [el.name, el.value, el.checked]; }),
    });
  }

  // 주문서에서 내 포장 확인: 온답에서 포장지·스티커·수량을 받아 띠에 보여 준다 (코드를 아는 사람만 보는 공개 요약)
  function describe(state) {
    if (!window.fetch) return;
    fetch(APP + '/api/design/' + state.code).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || d.code !== state.code) return;
      var designQty = Number(d.quantity) || 0;
      var sticker = d.sticker ? Number(d.sticker.sizeCm) + 'cm ' + (d.sticker.shape === 'circle' ? '원형' : '사각') + ' 스티커' : '스티커 없음';
      if (d.card) sticker += ' · 카드(엽서) ' + esc(d.card.sizeMm) + 'mm';
      var qty = orderQuantity(String(d.productNo));
      var lines = ['포장 디자인 ' + badge(state.code) + ' · ' + esc(d.styleName) + ' 포장 · ' + sticker + ' · ' + designQty + '개'];
      if (d.status === 'canceled') {
        lines.push('<b>이 디자인은 취소된 접수예요.</b> 답례큐에서 다시 꾸며 새 코드를 받아 주세요.');
      } else if (qty !== null && qty !== designQty) {
        lines.push('<b>주문 수량(' + qty + '개)과 디자인 수량(' + designQty + '개)이 달라요.</b> 스티커는 ' + designQty + '개를 인쇄해요. 수량을 맞추거나 답례큐 ‘내 디자인’에서 수량을 바꿔 다시 주문해 주세요.');
      } else {
        lines.push('주문서 ‘' + LABEL + '’ 칸에 코드를 넣어 두었어요. 이대로 주문하시면 돼요.');
      }
      banner(lines.join('<br>'));
    }).catch(function () { /* 온답에 닿지 않으면 처음 띠를 그대로 둔다 */ });
  }

  // 코드가 있다는 이유만으로 채우지 않는다. 요약 조회·단일 주문행·동일 수량을 확인한 뒤 안전하게 입력한다.
  function onOrderFormAll(states) {
    if (!states || !states.length) return;
    var messages = {};
    var show = function (state, message) {
      messages[state.productNo + ':' + (state.code || 'nocode')] = message;
      banner(Object.keys(messages).map(function (key) { return messages[key]; }).join('<hr style="border:0;border-top:1px solid rgba(255,255,255,.3);margin:10px 0">'), state.code ? [copyButton(state.code)] : []);
    };

    var activeStates = states.filter(function (s) { return s && s.code && CODE.test(s.code); });
    if (!activeStates.length) return;

    // 카페24 주문서 조각(Jigsaw) 상품 목록 및 추가입력란 렌더링 대기
    waitFor(function () {
      var rows = activeOrderRows();
      return rows.length > 0 ? rows : null;
    }, function (activeRows) {
      activeStates.forEach(function (state) {
        var manual = function (reason) {
          show(state, '포장 디자인 ' + badge(state.code) + ': <b>' + reason + '</b> 상품·옵션별 코드를 직접 확인해 주세요. 자동 입력하지 않았어요.');
        };

        if (!activeRows || !activeRows.length) {
          return manual('주문 상품 정보를 확인할 수 없어요.');
        }

        var matchingRows = activeOrderRows(state.productNo);
        if (!matchingRows.length) {
          return manual('답례큐에서 포장한 상품과 다른 상품을 주문 중이에요.');
        }

        var sameState = activeStates.filter(function (s) { return s.productNo === state.productNo && s.code; });
        if (sameState.length > 1) {
          return manual('같은 상품에 여러 디자인 코드가 있어요.');
        }
        if (matchingRows.length > 1) {
          return manual('같은 상품의 옵션이 여러 개예요.');
        }

        waitFor(function () {
          return forProduct(findCodeFields(), state.productNo);
        }, function (fields) {
          if (!fields || !fields.length) {
            return manual('주문서 ‘' + LABEL + '’ 입력란을 찾을 수 없어요. 주문 전에 쇼핑몰 고객센터에 문의해 주세요.');
          }

          var isPerItemField = /\|\d+\]$/.test(fields[0].name || '');
          if (activeRows.length > 1 && !isPerItemField) {
            return manual('주문서에 여러 상품이 함께 담겨 있어요. 상품별 디자인 코드를 확인 후 직접 입력해 주세요.');
          }
          if (fields.length !== 1) {
            return manual('주문 항목 입력란을 정확히 구분할 수 없어요.');
          }

          var field = fields[0];
          var originalRow = matchingRows[0];
          var originalOption = orderOptionSnapshot(originalRow.el);
          var currentOrderMatches = function () {
            var rows = activeOrderRows();
            var matches = activeOrderRows(state.productNo);
            var currentFields = forProduct(findCodeFields(), state.productNo);
            return field.isConnected && currentFields && currentFields.length === 1 && currentFields[0] === field &&
              matches.length === 1 && matches[0].el === originalRow.el &&
              (rows.length === 1 || isPerItemField) && orderOptionSnapshot(matches[0].el) === originalOption;
          };

          // 고객이 직접 수동 입력한 기존 값 보호
          if (field.value.trim() && field.value.trim() !== state.code) {
            return manual('이미 다른 코드가 적혀 있어요. 입력하신 내용을 유지했어요.');
          }

          if (!window.fetch) return manual('디자인 상태를 확인할 수 없어요.');

          var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
          var timeout = setTimeout(function () { if (controller) controller.abort(); }, 8000);

          fetch(APP + '/api/design/' + state.code, controller ? { signal: controller.signal } : {}).then(function (r) {
            return r.ok ? r.json() : null;
          }).then(function (d) {
            if (!d || d.code !== state.code || String(d.productNo) !== state.productNo) {
              return manual('디자인과 주문 상품이 일치하지 않아요.');
            }
            if (d.status !== 'pending' && d.status !== 'received') {
              return manual('취소됐거나 이미 처리된 디자인이에요. 새 코드를 받아 주세요.');
            }

            if (!currentOrderMatches()) return manual('주문 내용이 바뀌었어요. 상품과 포장 옵션을 다시 확인해 주세요.');

            var qty = orderQuantity(state.productNo);
            if (qty === null || qty !== Number(d.quantity)) {
              return manual('주문 수량(' + (qty || '?') + '개)과 디자인 수량(' + d.quantity + '개)이 달라요. 스티커는 ' + d.quantity + '개 기준으로 제작돼요. 수량을 확인해 주세요.');
            }

            // 비동기 조회 중 고객이 입력한 값 보호
            if (field.value.trim() && field.value.trim() !== state.code) {
              return manual('이미 다른 코드가 적혀 있어요. 입력하신 내용을 유지했어요.');
            }

            // 코드 자동 입력 실행
            var wasEmpty = !field.value.trim();
            field.value = state.code;
            fire(field);

            // 실제 입력란 반영 여부 사후 검증
            if (field.value.trim() === state.code && currentOrderMatches() && orderQuantity(state.productNo) === Number(d.quantity)) {
              field.dataset.ondapAutoCode = state.code;
              field.style.outline = '2px solid #1f4436';
              if (!state.filledAt) save(Object.assign({}, state, { filledAt: Date.now() }));
              var sticker = d.sticker ? Number(d.sticker.sizeCm) + 'cm ' + (d.sticker.shape === 'circle' ? '원형' : '사각') + ' 스티커' : '스티커 없음';
              if (d.card) sticker += ' · 카드(엽서) ' + esc(d.card.sizeMm) + 'mm';
              show(state, '포장 디자인 ' + badge(state.code) + ' · ' + esc(d.styleName) + ' · ' + sticker + ' · ' + qty + '개<br>주문서 ‘' + LABEL + '’ 칸에 코드를 넣었어요. 이대로 주문하시면 돼요.');
            } else {
              if (wasEmpty && field.value === state.code) { field.value = ''; fire(field); }
              return manual('주문서 칸에 코드가 자동 반영되지 않았어요. &lsquo;코드 복사&rsquo;를 눌러 직접 붙여넣어 주세요.');
            }

            // 주문 내용 동적 변경 시 자동 입력값만 안전 회수
            var invalidated = false;
            var checkCurrent = function () {
              if (invalidated) return;
              var currentQty = orderQuantity(state.productNo);

              var stillValid = currentOrderMatches() &&
                currentQty === Number(d.quantity) &&
                field.value.trim() === state.code;

              if (stillValid) return;

              invalidated = true;
              if (field.dataset.ondapAutoCode === state.code && field.value === state.code) {
                field.value = '';
                delete field.dataset.ondapAutoCode;
                fire(field);
              }
              show(state, '포장 디자인 ' + badge(state.code) + ': <b>주문 내용이 바뀌었어요.</b> 자동 입력한 코드는 안전하게 회수했어요. 상품·옵션·수량과 코드를 다시 확인해 주세요.');
              if (observer) observer.disconnect();
              document.removeEventListener('input', onInput, true);
              document.removeEventListener('change', onInput, true);
            };

            var onInput = function (e) {
              if (e.target === field && (e.isTrusted || field.value !== state.code)) {
                delete field.dataset.ondapAutoCode;
              }
              if (e.target === field || (e.target.closest && e.target.closest('.prdBox'))) {
                checkCurrent();
              }
            };

            var observer = typeof MutationObserver !== 'undefined' ? new MutationObserver(function (records) {
              var relevant = records.some(function (r) {
                var target = r.target.nodeType === 1 ? r.target : r.target.parentElement;
                if (target && target.closest && target.closest('.prdBox, #ec-jigsaw-area-orderProduct, #ec-jigsaw-area-additionalInput')) return true;
                return [].slice.call(r.addedNodes).concat([].slice.call(r.removedNodes)).some(function (n) {
                  return n.nodeType === 1 && (n.matches('.prdBox') || n.querySelector('.prdBox'));
                });
              });
              if (relevant) checkCurrent();
            }) : null;

            if (observer) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
            document.addEventListener('input', onInput, true);
            document.addEventListener('change', onInput, true);
          }).catch(function () {
            manual('디자인 상태를 확인할 수 없어요.');
          }).finally(function () {
            clearTimeout(timeout);
          });
        }, 7000);
      });
    }, 7000);
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
