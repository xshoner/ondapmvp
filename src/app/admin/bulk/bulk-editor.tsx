'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Catalog, ProductAttributes } from '@/engine/types.ts';
import { saveBlob } from '@/lib/device.ts';
import { attributeDiff, type FieldChange } from '@/data/attribute-diff.ts';
import { attributesCsv, parseAttributesCsv, type CsvImport } from '@/data/attributes-csv.ts';
import { saveAttributesBulkAction } from '../actions.ts';

// 엑셀은 'CSV UTF-8'이 아닌 일반 CSV를 한국어 윈도에서 EUC-KR로 저장한다 → UTF-8로 안 읽히면 EUC-KR로 다시 읽는다
function decode(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('euc-kr').decode(buf);
  }
}

export function BulkEditor({ catalog }: { catalog: Catalog }) {
  const router = useRouter();
  const [file, setFile] = useState<string | null>(null);
  const [parsed, setParsed] = useState<CsvImport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const names = useMemo(() => new Map(catalog.products.map((p) => [p.productNo, p.name])), [catalog]);
  const current = useMemo(() => new Map(catalog.attributes.map((a) => [a.productNo, a])), [catalog]);

  const changed = useMemo(() => {
    if (!parsed || parsed.errors.length) return [];
    return parsed.rows
      .map((row) => ({ row, changes: attributeDiff(current.get(row.productNo) ?? null, row, catalog.config), isNew: !current.has(row.productNo) }))
      .filter((x) => x.changes.length > 0);
  }, [parsed, current, catalog.config]);

  const download = () => {
    const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replaceAll('-', '');
    saveBlob(new Blob([attributesCsv(catalog)], { type: 'text/csv;charset=utf-8' }), `ondap-상품지표-${stamp}.csv`);
  };

  const read = async (f: File | undefined) => {
    setMessage(null);
    setParsed(null);
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return setMessage('파일이 너무 큽니다 (5MB까지).');
    setFile(f.name);
    setParsed(parseAttributesCsv(decode(await f.arrayBuffer()), catalog));
  };

  const save = () => start(async () => {
    const rows: ProductAttributes[] = changed.map((x) => x.row);
    const res = await saveAttributesBulkAction(rows);
    if (!res.ok) return setMessage(res.message);
    setMessage(`${res.saved}개 상품을 저장했습니다. 추천 결과에 바로 반영됩니다.`);
    setParsed(null);
    setFile(null);
    router.refresh();
  });

  return (
    <>
      <section className="panel bulk-steps">
        <ol>
          <li>
            <b>내려받기</b> — 지금 지표 전체를 엑셀에서 열 수 있는 파일로 받습니다.
            <div><button type="button" className="btn small" onClick={download}>CSV 내려받기 ({catalog.products.length}개 상품)</button></div>
          </li>
          <li>
            <b>엑셀에서 고치기</b> — 점수는 0~10 정수, 행사·관계는 쉼표로 나눠 화면의 이름 그대로(예: <code>장례, 회갑/칠순</code>),
            제외 행사는 <code>장례: 생물이라 대량 발송 부적합</code>처럼 ‘행사: 사유’를 세미콜론(;)으로 잇습니다. 첫 줄과 상품번호 칸은 고치지 마세요.
            저장할 때 ‘CSV UTF-8(쉼표로 분리)’을 고르면 가장 안전합니다(일반 CSV도 읽습니다).
          </li>
          <li>
            <b>올리기</b> — 바뀐 칸만 보여 드립니다. 확인하고 저장하면 한 번에 반영되고, 상품마다 변경 이력이 남아 되돌릴 수 있습니다.
            <div>
              <label className="btn ghost small file-pick">
                CSV 파일 고르기
                <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {file && <span className="small muted" style={{ marginLeft: 8 }}>{file}</span>}
            </div>
          </li>
        </ol>
      </section>

      {message && <p className="notice" role="status" style={{ margin: 0 }}>{message}</p>}

      {parsed && parsed.errors.length > 0 && (
        <section className="panel" role="alert">
          <b style={{ color: 'var(--danger)' }}>고칠 곳이 {parsed.errors.length}군데 있어 저장하지 않았습니다</b>
          <ul className="small" style={{ margin: '8px 0 0' }}>{parsed.errors.slice(0, 50).map((e) => <li key={e}>{e}</li>)}</ul>
          {parsed.errors.length > 50 && <p className="small muted">…외 {parsed.errors.length - 50}군데</p>}
        </section>
      )}

      {parsed && parsed.errors.length === 0 && (
        <section className="panel">
          <div className="spread">
            <b>{changed.length === 0 ? '바뀐 칸이 없습니다' : `${changed.length}개 상품이 바뀝니다`}</b>
            <button type="button" className="btn" disabled={changed.length === 0 || pending} onClick={save}>{pending ? '저장 중…' : `${changed.length}개 저장하기`}</button>
          </div>
          {parsed.ignoredColumns.length > 0 && <p className="small muted">모르는 칸은 건너뜁니다: {parsed.ignoredColumns.join(', ')}</p>}
          {changed.length > 0 && (
            <table className="data" style={{ marginTop: 12 }}>
              <thead><tr><th style={{ top: 0, width: 260 }}>상품</th><th style={{ top: 0 }}>바뀌는 칸</th></tr></thead>
              <tbody>
                {changed.map(({ row, changes, isNew }) => (
                  <tr key={row.productNo}>
                    <td>
                      <b>{names.get(row.productNo)}</b>
                      <div className="small muted">#{row.productNo}{isNew ? ' · 처음 입력' : ''}</div>
                    </td>
                    <td><ChangeList changes={changes} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}

function ChangeList({ changes }: { changes: FieldChange[] }) {
  return (
    <ul className="small change-list">
      {changes.map((c) => (
        <li key={c.label}><b>{c.label}</b> <span className="muted">{c.from || '(빈칸)'}</span> → {c.to || '(빈칸)'}</li>
      ))}
    </ul>
  );
}
