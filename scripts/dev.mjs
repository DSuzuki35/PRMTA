import { spawn } from 'node:child_process';
const build = spawn(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
build.on('exit', code => {
  if (code) { process.exitCode = code; return; }
  const command = process.platform === 'win32' ? 'node_modules/electron/dist/electron.exe' : 'node_modules/.bin/electron';
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(command, ['.'], { stdio: 'inherit', env }); app.on('exit', code => process.exitCode = code ?? 0);
});
