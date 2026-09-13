// 验收用临时静态服务器：提供页面与打包结果，并把页面回传的结果打到 stdout
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.VERIFY_PORT || 17899);
const root = __dirname;

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && (req.url || '').startsWith('/result')) {
    // 套件名优先取查询参数；老套件的 bundle 直接 POST /result，此时用 Referer 反推页面名
    const fromQuery = new URL(req.url, 'http://127.0.0.1').searchParams.get('suite');
    const fromReferer = (() => {
      const ref = req.headers.referer || '';
      const m = /([\w.-]+)\.html/.exec(ref);
      return m ? m[1] : '';
    })();
    const suite = fromQuery || fromReferer || 'unknown';
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      console.log('=====RESULT=====');
      console.log(`[suite=${suite}]`);
      console.log(body);
      console.log('=====END=====');
      // 落一份文件：批量回归时 PowerShell 轮询它就能按套件收结果（避免依赖管道 stdio）
      try {
        fs.writeFileSync(path.join(root, `.last-result-${suite}.txt`), body, 'utf8');
      } catch (error) {
        console.log(`写结果文件失败: ${String(error)}`);
      }
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
    // MIME 必须正确：worldD 会加载真实构建产物里的 CSS 来验证滚动布局，
    // 若把 css 当 text/plain 返回，Chrome 会直接拒绝应用样式表（"Refused to apply style"）。
    const type = file.endsWith('.js') ? 'text/javascript'
      : file.endsWith('.html') ? 'text/html'
      : file.endsWith('.css') ? 'text/css'
      : file.endsWith('.json') ? 'application/json'
      : 'text/plain';
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`verify server listening on http://127.0.0.1:${PORT}/index.html`));
