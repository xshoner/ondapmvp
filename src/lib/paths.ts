import { join } from 'node:path';

// npm 스크립트, 테스트, Next 서버 모두 프로젝트 루트에서 실행된다.
// (Next는 서버 코드를 .next/로 번들하므로 import.meta.url 기준 경로를 쓸 수 없다)
export const projectRoot = process.cwd();
export const dataDir = join(projectRoot, 'data');
