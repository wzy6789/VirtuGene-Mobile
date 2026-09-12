// 验收用临时静态服务器：提供页面与打包结果，并把页面回传的结果打到 stdout
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.VERIFY_PORT || 17899);
const root = __dirname;

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      console.log('=====RESULT=====');
      console.log(body);
      console.log('=====END=====');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    return;
  }
  const file = path.join(root, decodeURIComponent((req.url || '/').split('?')[0]));
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'text/plain';
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`verify server listening on http://127.0.0.1:${PORT}/index.html`));
