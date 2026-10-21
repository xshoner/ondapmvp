// 카페24 쇼핑몰에 붙일 코드를 온답 주소에 맞춰 만든다 (주소가 바뀌거나 다른 몰로 옮길 때).
// 사용법: npm run cafe24:snippets -- https://새주소.vercel.app
// 결과: cafe24/out/ 에 메인 버튼 블록과 붙이는 곳 안내(git 제외). 무엇을 어디에 붙이는지는 docs/CLONE.md 5장.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from '../src/lib/paths.ts';

const DEFAULT_ORIGIN = 'https://ondapmvp.vercel.app';
const arg = process.argv[2] ?? DEFAULT_ORIGIN;
let origin: string;
try {
  const u = new URL(arg);
  if (u.protocol !== 'https:') throw new Error('https 주소여야 합니다 (카페24는 https 페이지라 http 스크립트를 막는다)');
  origin = u.origin;
} catch (e) {
  console.error(`주소가 올바르지 않습니다: ${arg}\n${(e as Error).message}`);
  process.exit(1);
}

const out = join(projectRoot, 'cafe24', 'out');
mkdirSync(out, { recursive: true });

const cta = readFileSync(join(projectRoot, 'cafe24', 'ondap-cta.html'), 'utf8').replaceAll(`${DEFAULT_ORIGIN}/`, `${origin}/`);
writeFileSync(join(out, 'ondap-cta.html'), cta);

const script = `<script src="${origin}/cafe24/ondap-helper.js" defer></script>`;
const guide = `온답 카페24 붙이기 안내 (${origin})
=====================================================

1) 메인 버튼 — PC·모바일 메인 index.html, 메인 배너 바로 아래
   cafe24/out/ondap-cta.html 내용을 통째로 붙인다 (예전 온답 버튼 블록이 있으면 통째로 바꾼다)

2) 포장 도우미 스크립트 — 아래 한 줄을 네 곳에 (PC 스킨, 모바일 스킨 각각)
   - layout/basic/layout.html : </body> 바로 위
   - order/orderform.html     : 맨 아래 (주문서는 다른 레이아웃이라 따로 넣어야 한다)

   ${script}

3) 주문서 추가 항목 — 쇼핑몰 설정 > 주문 설정 > 주문서 추가 항목 관리
   항목명: 온답 포장 디자인 코드   (글자 그대로. 도우미가 이 이름으로 칸을 찾는다)
   입력 형식: 텍스트 박스(한 줄) / 적용 상품: 전체 상품 / 필수 여부: 선택

4) 확인 — 상품 상세에 '포장·스티커 꾸미기' 버튼이 보이고, 온답에서 디자인 코드를 받아 주문하러 가면
   주문서의 '온답 포장 디자인 코드' 칸이 자동으로 채워지면 끝.
`;
writeFileSync(join(out, 'README.txt'), guide);

console.log(guide);
console.log(`만든 파일: cafe24/out/ondap-cta.html, cafe24/out/README.txt`);
