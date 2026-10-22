// 상품 지표를 엑셀(CSV)로 내려받고, 고친 파일을 다시 읽는다 (순수 함수: 화면과 서버 액션이 함께 쓴다).
// 엑셀에서 고치기 쉽게 행사·관계는 한글 이름으로 쓴다. CSV에 없는 칸(선물의 의미 등)은 지금 값을 그대로 둔다.

import { eventIds, relationIds } from '../engine/labels.ts';
import type { Catalog, EngineConfig, EventType, ProductAttributes, Relation } from '../engine/types.ts';
import { csvCell } from '../packaging/design-filter.ts';

const COL = {
  no: '상품번호',
  name: '상품명(참고)',
  region: '산지',
  category: '분류',
  events: '어울리는 행사',
  relations: '어울리는 관계',
  excluded: '제외 행사',
  tags: '해시태그',
  story: '스토리',
  reviewed: '검토 완료',
};

const LIST_SEP = ','; // 행사·관계·태그 (행사 이름에 '/'가 있어 쉼표로 나눈다)
const EXCLUDED_SEP = ';'; // 제외 행사 '장례: 생물이라 부적합; 결혼: ...' (사유 안의 ;는 둔다: 다음 '행사 이름:' 앞에서만 끊는다)

export function emptyAttributes(config: EngineConfig, productNo: number): ProductAttributes {
  return {
    productNo, region: '국내', category: '', scores: Object.fromEntries(config.indicators.map((i) => [i.id, 5])),
    events: [], relations: [], excludedEvents: [], meanings: {}, tags: [], story: '', reviewed: false,
  };
}

export function attributesCsv(catalog: Catalog): string {
  const { config } = catalog;
  const byNo = new Map(catalog.attributes.map((a) => [a.productNo, a]));
  const evName = (id: EventType) => config.events[id].name;
  const head = [COL.no, COL.name, COL.region, COL.category, ...config.indicators.map((i) => i.name), COL.events, COL.relations, COL.excluded, COL.tags, COL.story, COL.reviewed];
  const rows = [...catalog.products].sort((a, b) => a.productNo - b.productNo).map((p) => {
    const a = byNo.get(p.productNo);
    if (!a) return [p.productNo, p.name, ...Array(head.length - 2).fill('')];
    return [
      p.productNo, p.name, a.region, a.category,
      ...config.indicators.map((i) => a.scores[i.id] ?? ''),
      eventIds(config).filter((id) => a.events.includes(id)).map(evName).join(`${LIST_SEP} `),
      relationIds(config).filter((id) => a.relations.includes(id)).map((id) => config.relations[id].name).join(`${LIST_SEP} `),
      a.excludedEvents.map((x) => `${evName(x.event)}: ${x.reason}`).join(`${EXCLUDED_SEP} `),
      a.tags.join(`${LIST_SEP} `),
      a.story,
      a.reviewed ? 'Y' : 'N',
    ];
  });
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// RFC 4180 CSV (따옴표 안의 쉼표·줄바꿈, "" 이스케이프). 엑셀이 붙이는 BOM은 뗀다
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface CsvImport {
  rows: ProductAttributes[]; // 지금 값에 CSV 내용을 덮어쓴 결과
  errors: string[]; // 하나라도 있으면 저장하지 않는다
  ignoredColumns: string[];
}

// '장례: 생물; 보관 어려움; 결혼: …' → ['장례: 생물; 보관 어려움', '결혼: …']
function splitExcluded(v: string, names: string[]): string[] {
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
  const boundary = new RegExp(`${EXCLUDED_SEP}\\s*(?=(?:${escaped.join('|')})\\s*:)`);
  return v.split(boundary).map((s) => s.trim()).filter(Boolean);
}

// 우리 CSV가 수식 방지로 붙인 ' 를 뗀다
const unguard = (v: string) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v).trim();

export function parseAttributesCsv(text: string, catalog: Catalog): CsvImport {
  const { config } = catalog;
  const table = parseCsv(text);
  const errors: string[] = [];
  if (table.length === 0) return { rows: [], errors: ['내용이 없는 파일입니다.'], ignoredColumns: [] };

  const head = table[0].map((h) => h.trim());
  const at = (name: string) => head.indexOf(name);
  const indicatorCols = config.indicators.map((ind) => ({ ind, i: head.findIndex((h) => h === ind.name || h === ind.id) }));
  const known = new Set<string>([...Object.values(COL), ...config.indicators.flatMap((i) => [i.name, i.id])]);
  const ignoredColumns = head.filter((h) => h && !known.has(h));
  if (at(COL.no) === -1) return { rows: [], errors: [`첫 줄에 '${COL.no}' 칸이 없습니다. 내려받은 파일의 첫 줄을 그대로 두세요.`], ignoredColumns };

  const eventByName = new Map<string, EventType>(eventIds(config).flatMap((id) => [[config.events[id].name, id], [id, id]] as [string, EventType][]));
  const relByName = new Map<string, Relation>(relationIds(config).flatMap((id) => [[config.relations[id].name, id], [id, id]] as [string, Relation][]));
  const products = new Set(catalog.products.map((p) => p.productNo));
  const current = new Map(catalog.attributes.map((a) => [a.productNo, a]));
  const seen = new Set<number>();
  const rows: ProductAttributes[] = [];

  table.slice(1).forEach((cells, n) => {
    const line = n + 2;
    const get = (name: string) => (at(name) === -1 ? null : unguard(cells[at(name)] ?? ''));
    const fail = (msg: string) => errors.push(`${line}번째 줄: ${msg}`);
    const no = Number(get(COL.no));
    if (!Number.isInteger(no) || no <= 0) return fail(`상품번호 '${get(COL.no)}'가 숫자가 아닙니다.`);
    if (!products.has(no)) return fail(`상품번호 ${no}는 쇼핑몰 상품 목록에 없습니다.`);
    if (seen.has(no)) return fail(`상품번호 ${no}가 두 번 나옵니다.`);
    seen.add(no);
    // 지표를 아직 안 넣은 상품의 빈 줄은 건너뛴다 (내려받은 파일을 그대로 올려도 오류가 나지 않게)
    const filled = head.some((h, i) => h !== COL.no && h !== COL.name && unguard(cells[i] ?? '') !== '');
    if (!current.has(no) && !filled) return;

    const next: ProductAttributes = structuredClone(current.get(no) ?? emptyAttributes(config, no));
    const region = get(COL.region);
    if (region !== null) next.region = region.slice(0, 30) || '국내';
    const category = get(COL.category);
    if (category !== null) next.category = category.slice(0, 30);

    for (const { ind, i } of indicatorCols) {
      if (i === -1) continue;
      const raw = unguard(cells[i] ?? '');
      const v = Number(raw);
      if (raw === '' || !Number.isInteger(v) || v < 0 || v > ind.max) fail(`${ind.name} '${raw}'는 0~${ind.max} 사이 정수여야 합니다.`);
      else next.scores[ind.id] = v;
    }

    const names = (v: string) => v.split(LIST_SEP).map((s) => s.trim()).filter(Boolean);
    const events = get(COL.events);
    if (events !== null) {
      const ids = names(events).map((s) => eventByName.get(s) ?? (fail(`어울리는 행사 '${s}'를 모릅니다.`), null)).filter((x): x is EventType => x !== null);
      next.events = eventIds(config).filter((id) => ids.includes(id));
    }
    const relations = get(COL.relations);
    if (relations !== null) {
      const ids = names(relations).map((s) => relByName.get(s) ?? (fail(`어울리는 관계 '${s}'를 모릅니다.`), null)).filter((x): x is Relation => x !== null);
      next.relations = relationIds(config).filter((id) => ids.includes(id));
    }
    const excluded = get(COL.excluded);
    if (excluded !== null) {
      next.excludedEvents = [];
      for (const part of splitExcluded(excluded, [...eventByName.keys()])) {
        const k = part.indexOf(':');
        const ev = eventByName.get((k === -1 ? part : part.slice(0, k)).trim());
        const reason = k === -1 ? '' : part.slice(k + 1).trim();
        if (!ev) fail(`제외 행사 '${part}'의 행사 이름을 모릅니다.`);
        else if (!reason) fail(`제외 행사 '${part}'에 사유가 없습니다. 예: 장례: 생물이라 대량 발송 부적합`);
        else if (!next.excludedEvents.some((x) => x.event === ev)) next.excludedEvents.push({ event: ev, reason: reason.slice(0, 100) });
      }
    }
    const both = next.excludedEvents.filter((x) => next.events.includes(x.event));
    if (both.length) fail(`${both.map((x) => config.events[x.event].name).join(', ')}이(가) 어울리는 행사와 제외 행사에 함께 있습니다.`);

    const tags = get(COL.tags);
    if (tags !== null) next.tags = names(tags).map((t) => t.replace(/^#/, '').slice(0, 20)).filter(Boolean).slice(0, 10);
    const story = get(COL.story);
    if (story !== null) next.story = story.slice(0, 2000);
    const reviewed = get(COL.reviewed);
    if (reviewed !== null && reviewed !== '') {
      if (/^(y|yes|예|o|true|1)$/i.test(reviewed)) next.reviewed = true;
      else if (/^(n|no|아니오|x|false|0)$/i.test(reviewed)) next.reviewed = false;
      else fail(`검토 완료 '${reviewed}'는 Y 또는 N으로 적어 주세요.`);
    }
    rows.push(next);
  });

  return { rows, errors, ignoredColumns };
}
