import { createServer } from 'node:http';
const args = process.argv.slice(2);
const value = key => args[args.indexOf(key) + 1];
createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ status: 'ok', model: value('-m') }));
}).listen(Number(value('--port')), value('--host'));
