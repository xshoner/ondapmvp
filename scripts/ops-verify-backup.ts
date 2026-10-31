// 네트워크/운영 DB에 쓰지 않는다. 검증한 백업에서 시험 복구용 SQL만 생성한다.
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { safeBackupPath, sha256, validateSnapshot, restoreSql, referencedFiles } from '../src/lib/backup.ts';
const target = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('검증할 백업 폴더를 지정해 주세요.');
const raw = readFileSync(join(target, 'snapshot.json'), 'utf8');
const manifest = JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8'));
if (!['20261027', '20261031'].includes(manifest.schemaVersion) || manifest.snapshotSha256 !== sha256(raw) || !Array.isArray(manifest.files)) throw new Error('스냅샷 검증 실패.');
const snapshot = JSON.parse(raw); validateSnapshot(snapshot);
if (manifest.schemaVersion !== snapshot.schemaVersion) throw new Error('백업 버전이 일치하지 않습니다.');
const saved = new Set<string>();
for (const item of manifest.files) {
  if (!safeBackupPath(item.path) || saved.has(item.path)) throw new Error('잘못되거나 중복된 파일 경로입니다.');
  const path = realpathSync(join(target, 'files', item.path));
  if (!path.startsWith(realpathSync(join(target,'files')) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('백업 폴더 밖의 파일입니다.');
  const bytes = readFileSync(path);
  if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) throw new Error('백업 파일 검증 실패.');
  saved.add(item.path);
}
if (typeof manifest.sourceUrl !== 'string') throw new Error('원본 프로젝트 주소가 없습니다.');
for (const file of referencedFiles(snapshot,manifest.sourceUrl)) if (!saved.has(file)) throw new Error('참조한 인쇄/포장 원본이 없습니다.');
const targetUrl = process.argv[3];
writeFileSync(join(target, 'restore-staging.sql'), restoreSql(snapshot, targetUrl ? {source:manifest.sourceUrl,target:targetUrl} : undefined), { flag: 'wx', mode: 0o600 });
console.log(`검증 완료: 파일 ${saved.size}개. restore-staging.sql을 새 시험 프로젝트에서 검토 후 실행하세요. 운영에는 적용하지 않았습니다.`);
