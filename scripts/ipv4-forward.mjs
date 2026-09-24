#!/usr/bin/env node
/**
 * 只走 IPv4 的本地 HTTP CONNECT 转发 —— 给 git 当代理用（本机专用小工具）。
 *
 * ## 什么时候需要它
 * 这台机器到 GitHub 的 **IPv6 路径是坏的**：`curl -6 https://api.github.com` 直接失败，
 * `curl -4` 正常；而 git 的 libcurl 不会从 IPv6 回落到 IPv4，于是 `git push/fetch` 报
 * `schannel: failed to receive handshake` 或 `TLS connect error: unexpected eof while reading`。
 * 挂上这个转发后 git 就能正常推拉了（TLS 仍然是 git ↔ GitHub 端到端，转发只做 TCP）。
 *
 * ## 用法
 * ```powershell
 * # 1) 另开一个终端（或后台）跑转发，默认监听 127.0.0.1:8443
 * node scripts/ipv4-forward.mjs
 *
 * # 2) 之后所有 git 操作带上代理参数
 * git -c http.proxy=http://127.0.0.1:8443 push origin main
 * #    也可以只在本会话里设一次：
 * #    $env:GIT_CONFIG_COUNT=1; $env:GIT_CONFIG_KEY_0='http.proxy'; $env:GIT_CONFIG_VALUE_0='http://127.0.0.1:8443'
 * ```
 *
 * 注意：`~/.ssh/config` 里 github 的 ProxyCommand 指向 `connect -H 127.0.0.1:7897`，
 * 而那个本地代理端口目前不可用（HTTP/SOCKS 都不通），所以 SSH 方式推 GitHub 也不通；
 * 用本转发 + HTTPS 是目前唯一稳定的路径。若哪天 IPv6 恢复，可不再需要它。
 */
import { createServer, connect } from 'node:net';

const port = Number(process.argv[2] ?? 8443);
const server = createServer((client) => {
  let buffer = '';
  const onData = (chunk) => {
    buffer += chunk.toString('latin1');
    const end = buffer.indexOf('\r\n\r\n');
    if (end === -1) return;
    client.off('data', onData);
    const [requestLine] = buffer.split('\r\n');
    const [, target] = requestLine.split(' ');
    const [host, targetPort] = String(target).split(':');
    const upstream = connect({ host, port: Number(targetPort) || 443, family: 4 }, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      const rest = buffer.slice(end + 4);
      if (rest.length > 0) upstream.write(Buffer.from(rest, 'latin1'));
      client.pipe(upstream);
      upstream.pipe(client);
      console.log(`CONNECT ${host}:${targetPort} → IPv4 ${upstream.remoteAddress}`);
    });
    upstream.on('error', (error) => {
      console.log(`上游失败 ${host}:${targetPort} :: ${error.message}`);
      client.destroy();
    });
  };
  client.on('data', onData);
  client.on('error', () => client.destroy());
});
server.listen(port, '127.0.0.1', () => console.log(`IPv4 转发已监听 127.0.0.1:${port}`));
