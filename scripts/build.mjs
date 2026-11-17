import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
await viteBuild();
await build({ entryPoints: ['server/standalone.ts'], outfile: 'dist-server/standalone.mjs', bundle: true, platform: 'node', target: 'node24', format: 'esm', packages: 'external', sourcemap: true });
// Desktop bundles are added when the Electron entry points are present.
const { existsSync } = await import('node:fs');
if (existsSync('electron/main.ts')) {
  await build({ entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs', bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['electron'], packages: 'external', sourcemap: true });
  await build({ entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
}
