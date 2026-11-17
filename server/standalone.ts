import { createHost } from './host';
import { resolve } from 'node:path';
const host = await createHost({ dataDir: process.env.PRMTA_DATA_DIR || process.env.PRMPT_DATA_DIR || resolve('.prmpt'), staticDir: resolve('dist'), port: Number(process.env.PORT || 4317) });
console.log(`PRMTA Studio: ${host.url('admin')}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void host.close().then(() => process.exit()); });
