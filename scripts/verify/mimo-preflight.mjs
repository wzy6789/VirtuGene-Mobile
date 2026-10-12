import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('.tmp-preview/voice-call', { recursive: true });
let result;
try {
  const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
    method: 'OPTIONS', headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' }, signal: AbortSignal.timeout(15000),
  });
  result = { status: response.status, headers: Object.fromEntries([...response.headers].filter(([name]) => name.startsWith('access-control'))), modelRequests: 0 };
  await response.body?.cancel();
} catch (error) { result = { error: error.name, cause: error.cause?.code, modelRequests: 0 }; }
writeFileSync('.tmp-preview/voice-call/mimo-preflight-node.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
