import { spawn } from 'node:child_process';

const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-H', '127.0.0.1'], {
  stdio: 'inherit', env: { ...process.env, ONDAP_DATA_SOURCE: 'local' },
});
server.on('exit', (code) => { process.exitCode = code ?? 1; });
