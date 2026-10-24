// 이번 과제의 연결 검증: 모바일 이동, 관리자 포장 적용 대상, 고객 목적, 운영 점검 경계.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './cdp.mjs';
const root = process.argv[2], BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
const results=[];
const check=(name,ok)=>{results.push(ok);console.log(`${ok?'OK ':'NG '} ${name}`);};
const b=await launch({port:9355,mobile:true});
try {
  await b.goto(`${BASE}/result?event=wedding&relation=peer&qty=10&budget=50000`);
  await b.waitFor(`document.querySelector('.pick-actions a')`);
  const links=await b.evaluate(`return [...document.querySelectorAll('.pick-actions a,.alt a')].filter(a=>a.href.includes('cafe24.com')).map(a=>a.href)`);
  check('모바일: 추천 상품 링크 모두 /m/·수량 10·코드 없는 주문 초안',links.length>=3&&links.every(h=>h.includes('/m/product/')&&h.includes('ondap_qty=10')&&h.includes('ondap_order=1')&&!h.includes('ondap_code')));
  const images=await b.evaluate(`return {main:document.querySelector('.pick-media img').getAttribute('srcset'),lazy:[...document.querySelectorAll('.alt img')].every(i=>i.loading==='lazy')}`);
  check('결과 이미지: 반응형 소스와 하단 지연 로딩',Boolean(images.main)&&images.lazy);

  await b.goto(`${BASE}/admin/packaging?tab=styles`);
  await b.waitFor(`document.querySelector('.asset-card input[aria-label="이름"]')`,40000);
  const card=`[...document.querySelectorAll('.asset-card')].find(c=>c.querySelector('input[aria-label="이름"]')?.value==='모란 연분홍')`;
  await b.evaluate(`const c=${card};c.querySelector('details').open=true;const select=c.querySelector('select[aria-label="추천 목적"]');select.value='return';select.dispatchEvent(new Event('change',{bubbles:true}));return true`);
  await b.sleep(200);
  await b.evaluate(`const c=${card};[...c.querySelectorAll('label')].find(l=>l.textContent.trim()==='결혼').querySelector('input').click();return true`);
  await b.sleep(200);
  await b.evaluate(`const c=${card};const field=c.querySelector('input[aria-label="적용 상품번호"]');field.value='45';field.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));return true`);
  await b.sleep(200);
  await b.evaluate(`const c=${card};[...c.querySelectorAll('button')].find(x=>x.textContent==='저장').click();return true`);
  await b.waitFor(`![...document.querySelectorAll('.asset-card')].find(c=>c.querySelector('input[aria-label="이름"]')?.value==='모란 연분홍')?.querySelector('button.btn:not(.ghost)')`,10000);
  const style=JSON.parse(readFileSync(join(root,'data/packaging.json'),'utf8')).styles.find(s=>s.name==='모란 연분홍');
  check('관리자 추천 대상: 목적·행사·상품번호 저장',style.targeting?.purposes.includes('return')&&style.targeting?.events.includes('wedding')&&style.targeting?.productNos.includes(45));

  await b.goto(`${BASE}/packaging?product=45&qty=10&event=wedding`);
  await b.waitFor(`window.Konva?.stages?.[0]?.find('Text').length>0`,40000);
  const preset=await b.evaluate(`return {style:document.querySelector('.style-grid [aria-pressed=true]')?.textContent,text:window.Konva.stages[0].find('Text').map(t=>t.text()).join(' ')}`);
  check('관리자 적용 대상이 고객의 기본 포장·감사 문구에 연결',preset.style==='모란 연분홍'&&preset.text.includes('감사')&&!preset.text.includes('기념일'));
  await b.click('button','축하 선물');
  await b.waitFor(`window.Konva.stages[0].find('Text').some(t=>t.text().includes('축하드립니다'))`);
  check('감사 답례와 축하 선물의 기본 문구 구분',true);
  await b.click('button','+ 문구 추가');
  await b.sleep(200);
  const before=await b.evaluate(`return window.Konva.stages[0].find('Text').map(t=>t.text()).join('|')`);
  await b.evaluate(`window.confirm=()=>false;return true`);
  await b.click('button','감사 답례');
  check('고객이 변경을 거절하면 직접 꾸민 문구 보존',before===await b.evaluate(`return window.Konva.stages[0].find('Text').map(t=>t.text()).join('|')`));

  await b.goto(`${BASE}/packaging?product=49&qty=10&event=wedding`);
  await b.waitFor(`document.querySelector('.style-grid')`);
  check('적용 상품이 다르면 해당 포장을 보여 주지 않음',!(await b.evaluate(`return [...document.querySelectorAll('.style-grid button')].some(b=>b.textContent==='모란 연분홍')`)));
  await b.goto(`${BASE}/admin/health`);
  await b.waitFor(`document.querySelector('h1')?.textContent==='운영 상태'`);
  check('관리자 운영 상태 화면 열림',await b.evaluate(`return document.body.textContent.includes('로컬 시험 모드')`));
  check('예약 작업은 인증 없이 실행하지 않음',[401,503].includes((await fetch(`${BASE}/api/cron/sync-products`)).status)&&(await fetch(`${BASE}/api/cron/health`)).status===401);
  check('통계 CSV의 잘못된 날짜는 거절',(await fetch(`${BASE}/admin/stats/export?from=2026-02-30&to=2026-03-01`)).status===400);
  check('지표 수집은 잘못된 항목을 거절',(await fetch(`${BASE}/api/metrics`,{method:'POST',body:JSON.stringify({name:'secret',page:'home',value:1})})).status===400);
} catch(e){check('통합 흐름 중단: '+e.message,false);} finally {console.log('--- 콘솔 오류:',b.logs.length?b.logs.join('\n'):'없음');await b.close();}
console.log(`${results.filter(Boolean).length}/${results.length} 통과`);process.exitCode=results.every(Boolean)?0:1;
