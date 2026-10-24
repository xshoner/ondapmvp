import { createHash } from 'node:crypto';
export const BACKUP_TABLES = ['products','product_attributes','engine_config','scenario_expectations','packaging_styles','design_images','design_texts','designs','recommendation_logs','recommendation_feedback','product_attributes_history'] as const;
export type Snapshot = { schemaVersion: '20261027'; capturedAt: string; tables: Record<typeof BACKUP_TABLES[number], Record<string, unknown>[]> };
export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export function referencedFiles(snapshot: Snapshot, sourceUrl: string): string[] {
  const files = new Set<string>();
  for (const d of snapshot.tables.designs) if (typeof d.print_path === 'string') files.add('design-files/' + d.print_path);
  for (const table of ['packaging_styles','design_images'] as const) for (const asset of snapshot.tables[table]) {
    const url = String(asset.image_url ?? ''), prefix = `${sourceUrl}/storage/v1/object/public/packaging-assets/`;
    if (url.startsWith(prefix)) files.add('packaging-assets/' + url.slice(prefix.length));
  }
  for (const file of files) if (!safeBackupPath(file)) throw new Error('안전하지 않은 저장소 경로입니다.');
  return [...files];
}
export function safeBackupPath(path: string): boolean {
  return /^[A-Za-z0-9_./-]+$/.test(path) && !path.startsWith('/') && !path.split('/').some((p) => !p || p === '.' || p === '..');
}
export function validateSnapshot(value: unknown): asserts value is Snapshot {
  const s = value as Snapshot;
  if (s?.schemaVersion !== '20261027' || !Number.isFinite(Date.parse(s.capturedAt))) throw new Error('지원하지 않거나 잘못된 백업입니다.');
  for (const table of BACKUP_TABLES) if (!Array.isArray(s.tables?.[table])) throw new Error('백업 표가 누락됐습니다.');
  const designs = new Map(s.tables.designs.map((r) => [r.code, r]));
  for (const d of designs.values()) if (d.source_code && !designs.has(d.source_code)) throw new Error('재주문 원본 접수가 백업에 없습니다.');
}
export function restoreSql(snapshot: Snapshot, remap?: { source: string; target: string }): string {
  validateSnapshot(snapshot);
  const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
  const sql = ['-- 새 시험 프로젝트에서만 실행. 먼저 같은 코드의 setup.sql과 인증 사용자를 준비하세요.', '-- DB 자료만 복구합니다. 비공개/업로드 파일은 manifest 경로대로 별도 복구합니다.', 'begin;', 'set local standard_conforming_strings = on;'];
  for (const table of BACKUP_TABLES) sql.push(`alter table public.${table} disable trigger user;`);
  for (const table of [...BACKUP_TABLES].reverse()) sql.push(`delete from public.${table};`);
  for (const table of BACKUP_TABLES) {
    let rows = JSON.stringify(snapshot.tables[table]);
    if (remap) {
      for (const url of [remap.source,remap.target]) { const u = new URL(url); if(u.protocol !== 'https:' || u.origin !== url) throw new Error('복구 프로젝트 주소가 올바르지 않습니다.'); }
      rows = rows.replaceAll(remap.source + '/storage/', remap.target + '/storage/');
    }
    if (snapshot.tables[table].length) sql.push(`insert into public.${table} overriding system value select * from jsonb_populate_recordset(null::public.${table}, ${quote(rows)}::jsonb);`);
    if (['recommendation_logs','recommendation_feedback','product_attributes_history'].includes(table)) sql.push(`select setval(pg_get_serial_sequence('public.${table}','id'), greatest(coalesce((select max(id) from public.${table}),0)+1,1), false);`);
  }
  for (const table of BACKUP_TABLES) sql.push(`alter table public.${table} enable trigger user;`);
  sql.push('commit;');
  return sql.join('\n');
}
