// Run the API server and the web dev server together.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = ['server', 'web'].map((name) =>
  spawn(npm, ['run', name], { stdio: 'inherit', shell: process.platform === 'win32' }),
);

const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) { stop(); process.exit(code); } }));
