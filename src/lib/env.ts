import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from './paths.ts';

export function loadEnv(file = join(projectRoot, '.env.local')): Record<string, string> {
  const env: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`환경 파일을 찾을 수 없습니다: ${file}`);
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}
