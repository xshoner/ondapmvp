// 실행 시에만 서버 키 사용. 백업은 개인정보를 포함할 수 있으므로 git 제외 디렉터리에 보관한다.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { loadEnv } from '../src/lib/env.ts';
import { createServiceClient } from '../src/lib/supabase/service.ts';
import { safeBackupPath, sha256, validateSnapshot, referencedFiles } from '../src/lib/backup.ts';

try { Object.assign(process.env, { ...loadEnv(), ...process.env }); } catch { /* 배포 환경변수만으로 실행 가능 */ }
const target = resolve(process.argv[2] ?? join('backups', new Date().toISOString().replace(/[:.]/g, '-')));
if (existsSync(target)) throw new Error('기존 폴더를 덮어쓰지 않습니다. 새 백업 폴더를 지정해 주세요.');
const db = createServiceClient();
const { data: snapshot, error } = await db.rpc('export_application_snapshot');
if (error) throw new Error('애플리케이션 스냅샷 조회 실패. DB 변경과 백업 키 권한을 확인해 주세요.');
validateSnapshot(snapshot);
mkdirSync(target, { recursive: true });
const json = JSON.stringify(snapshot);
writeFileSync(join(target, 'snapshot.json'), json, { flag: 'wx', mode: 0o600 });
const sourceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const files = referencedFiles(snapshot,sourceUrl);
const manifest: { schemaVersion: string; sourceUrl: string; snapshotSha256: string; files: { path: string; sha256: string; bytes: number }[] } = { schemaVersion: snapshot.schemaVersion, sourceUrl, snapshotSha256: sha256(json), files: [] };
for (const file of files) {
  if (!safeBackupPath(file)) throw new Error('안전하지 않은 저장소 경로입니다. 백업을 중단했습니다.');
  const [bucket, ...path] = file.split('/');
  const { data, error } = await db.storage.from(bucket).download(path.join('/'));
  if (error || !data) throw new Error('인쇄/포장 원본 다운로드 실패. 불완전한 백업은 복구에 사용하지 마세요.');
  const bytes = new Uint8Array(await data.arrayBuffer());
  const output = join(target, 'files', file);
  mkdirSync(join(output, '..'), { recursive: true });
  writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
  manifest.files.push({ path: file, sha256: sha256(bytes), bytes: bytes.length });
}
writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
console.log(`백업 완료: 표 ${Object.keys(snapshot.tables).length}개, 파일 ${manifest.files.length}개. manifest가 없는 폴더는 미완료입니다.`);
