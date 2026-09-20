import http from 'node:http';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEFAULT_MODEL = process.env.DEEPSEEK_DEFAULT_MODEL || 'deepseek-chat';
const GATEWAY_TOKEN = process.env.VIRTUGENE_GATEWAY_TOKEN || '';
const AUTH_SECRET = process.env.GATEWAY_AUTH_SECRET || '';
const DATA_DIR = process.env.GATEWAY_DATA_DIR || '/opt/virtugene/data';
const USERS_FILE = join(DATA_DIR, 'users.json');
const ALLOW_ANONYMOUS = process.env.GATEWAY_ALLOW_ANONYMOUS === 'true';
const MAX_BODY_BYTES = 1_500_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = Number(process.env.GATEWAY_RATE_LIMIT || 20);
// Auxiliary work (emotion, settling and summaries) has its own minute bucket
// so background bookkeeping cannot starve an interactive chat request. The
// daily counter remains shared to keep the account-wide cost guard intact.
const AUX_RATE_LIMIT = Number(process.env.GATEWAY_AUX_RATE_LIMIT || Math.max(RATE_LIMIT, 40));
const DAILY_LIMIT = Number(process.env.GATEWAY_DAILY_LIMIT || 300);
const buckets = new Map();
const ACCESS_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function base64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

function signToken(payload, ttlSeconds) {
  if (!AUTH_SECRET) throw Object.assign(new Error('missing_auth_secret'), { status: 503 });
  const now = Math.floor(Date.now() / 1000);
  const body = base64url({ ...payload, iat: now, exp: now + ttlSeconds });
  const head = base64url({ alg: 'HS256', typ: 'JWT' });
  const signature = createHmac('sha256', AUTH_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}

function verifyToken(value, expectedType) {
  if (!AUTH_SECRET || typeof value !== 'string') return null;
  const [head, body, signature] = value.split('.');
  if (!head || !body || !signature) return null;
  const expected = createHmac('sha256', AUTH_SECRET).update(`${head}.${body}`).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.sub || payload.type !== expectedType || Number(payload.exp) <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function loadUsers() {
  try {
    const users = JSON.parse(readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(users) ? users : [];
  } catch {
    return [];
  }
}

function saveUsers(users) {
  mkdirSync(dirname(USERS_FILE), { recursive: true, mode: 0o700 });
  const temp = `${USERS_FILE}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(users), { mode: 0o600 });
  renameSync(temp, USERS_FILE);
}

function normalizeUsername(value) {
  return text(value, 40).trim().toLowerCase();
}

function validUsername(value) {
  return value.length >= 2 && value.length <= 32 && !/[\s<>]/.test(value);
}

function passwordHash(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

function issueTokens(user) {
  return {
    accessToken: signToken({ sub: user.id, username: user.username, type: 'access' }, ACCESS_TOKEN_TTL_SECONDS),
    refreshToken: signToken({ sub: user.id, username: user.username, type: 'refresh' }, REFRESH_TOKEN_TTL_SECONDS),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

function registerAccount(body) {
  const username = normalizeUsername(body.username);
  const password = text(body.password, 256);
  if (!validUsername(username) || password.length < 6 || body.adultConfirmed !== true) throw Object.assign(new Error('invalid_request'), { status: 400 });
  const users = loadUsers();
  if (users.some((user) => user.username === username)) throw Object.assign(new Error('username_taken'), { status: 409 });
  const salt = randomBytes(16).toString('hex');
  const user = { id: randomBytes(16).toString('hex'), username, salt, passwordHash: passwordHash(password, salt), adultConfirmedAt: Date.now(), createdAt: Date.now() };
  users.push(user);
  saveUsers(users);
  return { user: { id: user.id, username: user.username }, ...issueTokens(user) };
}

function loginAccount(body) {
  const username = normalizeUsername(body.username);
  const password = text(body.password, 256);
  const users = loadUsers();
  const user = users.find((item) => item.username === username);
  if (!user || !password) throw Object.assign(new Error('invalid_credentials'), { status: 401 });
  const candidate = Buffer.from(passwordHash(password, user.salt), 'hex');
  const stored = Buffer.from(user.passwordHash, 'hex');
  if (candidate.length !== stored.length || !timingSafeEqual(candidate, stored)) throw Object.assign(new Error('invalid_credentials'), { status: 401 });
  if (body.adultConfirmed !== true) throw Object.assign(new Error('adult_confirmation_required'), { status: 400 });
  if (!user.adultConfirmedAt) {
    user.adultConfirmedAt = Date.now();
    saveUsers(users);
  }
  return { user: { id: user.id, username: user.username }, ...issueTokens(user) };
}

const json = (res, status, payload) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': process.env.GATEWAY_CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(payload));
};

function identity(req) {
  const auth = String(req.headers.authorization || '');
  const access = verifyToken(auth.startsWith('Bearer ') ? auth.slice(7).trim() : '', 'access');
  if (access) return `user:${access.sub}`;
  if (auth.startsWith('Bearer ') && auth.slice(7).trim()) return `token:${auth.slice(7).trim().slice(0, 24)}`;
  return `ip:${req.socket.remoteAddress || 'unknown'}`;
}

function authorized(req) {
  const auth = String(req.headers.authorization || '');
  const access = verifyToken(auth.startsWith('Bearer ') ? auth.slice(7).trim() : '', 'access');
  if (access && loadUsers().some((user) => user.id === access.sub)) return access;
  if (GATEWAY_TOKEN) {
    return auth === `Bearer ${GATEWAY_TOKEN}` ? { sub: 'legacy-gateway-token', type: 'access' } : null;
  }
  return ALLOW_ANONYMOUS ? { sub: `anonymous:${req.socket.remoteAddress || 'unknown'}`, type: 'access' } : null;
}

function deleteAccount(req) {
  const auth = String(req.headers.authorization || '');
  const access = verifyToken(auth.startsWith('Bearer ') ? auth.slice(7).trim() : '', 'access');
  if (!access) throw Object.assign(new Error('invalid_credentials'), { status: 401 });
  const users = loadUsers();
  if (!users.some((user) => user.id === access.sub)) throw Object.assign(new Error('invalid_credentials'), { status: 401 });
  saveUsers(users.filter((user) => user.id !== access.sub));
}

function allowed(key, kind = 'chat') {
  const now = Date.now();
  const current = buckets.get(key) || { minuteAt: now, minute: 0, auxMinute: 0, dayAt: now, day: 0 };
  if (!Number.isFinite(current.auxMinute)) current.auxMinute = 0;
  if (now - current.minuteAt >= RATE_WINDOW_MS) {
    current.minuteAt = now;
    current.minute = 0;
    current.auxMinute = 0;
  }
  if (now - current.dayAt >= 86_400_000) {
    current.dayAt = now;
    current.day = 0;
  }
  const minuteLimit = kind === 'aux' ? AUX_RATE_LIMIT : RATE_LIMIT;
  const minuteCount = kind === 'aux' ? current.auxMinute : current.minute;
  if (minuteCount >= minuteLimit || current.day >= DAILY_LIMIT) return false;
  if (kind === 'aux') current.auxMinute += 1;
  else current.minute += 1;
  current.day += 1;
  buckets.set(key, current);
  return true;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

function text(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function content(textValue, image) {
  if (!image || !String(image).startsWith('data:image/')) return textValue;
  return [{ type: 'text', text: textValue || '[图片]' }, { type: 'image_url', image_url: { url: image.slice(0, 2_500_000) } }];
}

function buildMessages(body) {
  const system = text(body.systemPrompt, 12_000);
  const instruction = '这是 VirtuGene 的拟人化互动。保持角色身份和关系，用自然口语短句回复，不写 Markdown、列表、动作括号或总结套话。不得声称自己是真实人类，不得诱导用户依赖、排斥现实关系、过度消费或服从角色；不得鼓励自伤、自杀、暴力或危险行为。遇到用户可能面临人身安全风险时，优先关心现实安全，鼓励立即联系可信任的人和当地紧急援助。';
  const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
  return [
    { role: 'system', content: `${system}\n\n${instruction}${body.retryHint ? `\n\n${text(body.retryHint, 500)}` : ''}` },
    ...history.map((item) => ({ role: item?.role === 'assistant' ? 'assistant' : 'user', content: content(text(item?.content, 1_200), item?.image) })),
    { role: 'user', content: content(text(body.message, 4_000), body.image) },
  ];
}

function safetyIntervention(message) {
  const value = text(message, 4_000);
  const imminentSelfHarm = /(我|自己).{0,8}(想|要|准备|打算).{0,8}(自杀|轻生|结束生命|伤害自己)|不想活了|活不下去/.test(value);
  if (!imminentSelfHarm) return null;
  return {
    content: '我先不继续角色对话了。你现在的安全最重要。请马上离开可能伤害自己的物品或地点，联系一位你信任的人陪着你；如果危险正在发生，请立即拨打当地急救或报警电话。你不需要独自处理这一刻。',
    truncated: false,
    modelId: 'virtugene-safety',
    safetyIntervention: true,
  };
}

function auxMessages(operation, payload) {
  const history = Array.isArray(payload?.history) ? payload.history.slice(-24) : [];
  const text = typeof payload?.text === 'string' ? payload.text.slice(0, 12_000) : '';
  const context = typeof payload?.context === 'string' ? payload.context.slice(0, 8_000) : '';
  const previousSummary = typeof payload?.previousSummary === 'string' ? payload.previousSummary.slice(0, 2_500) : '';
  const protectedMemories = Array.isArray(payload?.protectedMemories)
    ? payload.protectedMemories
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim().slice(0, 180))
      .filter(Boolean)
      .slice(0, 8)
    : [];
  const transcript = history.map((item) => `${item?.role === 'assistant' ? 'assistant' : 'user'}: ${String(item?.content || '').slice(0, 1_000)}`).join('\n');
  const prompts = {
    memory: '从对话中提取值得长期记住的用户事实。只记录用户明确说过或能直接确定的内容，不能把角色猜测当事实；注意时间范围和用户对旧事实的纠正。只输出 JSON 数组，例如 ["用户喜欢咖啡"]；没有就输出 []。',
    emotion: '分析 assistant 消息里的角色状态，只输出 JSON 对象：{"dimensions":{"valence":5,"arousal":5,"intimacy":5,"engagement":5,"expressiveness":5,"stability":5},"dominantEmotion":"","summary":""}。每个分数 1 到 10。',
    'context-settle': '同时提取用户长期事实并分析对话状态。memory 只收录用户明确说过的事实、偏好、约定和计划；如果用户纠正旧信息，只保留新说法，不要补猜测。只输出 JSON 对象：{"memories":[],"dimensions":{"valence":5,"arousal":5,"intimacy":5,"engagement":5,"expressiveness":5,"stability":5},"dominantEmotion":"","userEmotion":"","summary":""}。',
    'context-summary': '把新增对话与之前的压缩摘要合并成 3 到 6 句中文摘要。优先保留用户明确要求记住的事情、确认过的事实、重要约定和未完成事项；不要凭空补充，不要机械重复。只输出 JSON 对象：{"summary":""}。',
    diary: '完成日记辅助任务。根据 mode 输出 JSON：普通模式为 {"text":""}；auto、compile、combine、recall 为 {"title":"","content":"","tags":[]}；persona 为 {"persona":{"keywords":[],"topics":[],"emotion":"","summary":""}}。不要输出 Markdown。',
  };
  const operationPrompt = prompts[operation] || prompts.diary;
  const user = operation === 'diary'
    ? `mode=${String(payload?.mode || '')}\n内容：${text}\n上下文：${context}`
    : operation === 'context-summary' && previousSummary
      ? `之前的压缩摘要（保留其中仍然有效的事实）：\n${previousSummary}${protectedMemories.length > 0 ? `\n\n用户明确要求长期保留的记忆（必须逐条保留）：\n${protectedMemories.map((item) => `- ${item}`).join('\n')}` : ''}\n\n本次新增对话：\n${transcript || text}`
      : operation === 'context-summary' && protectedMemories.length > 0
        ? `用户明确要求长期保留的记忆（必须逐条保留）：\n${protectedMemories.map((item) => `- ${item}`).join('\n')}\n\n本次新增对话：\n${transcript || text}`
      : transcript || text;
  return [{ role: 'system', content: operationPrompt }, { role: 'user', content: user.slice(0, 20_000) }];
}

async function aux(operation, payload) {
  if (!DEEPSEEK_API_KEY) throw Object.assign(new Error('missing_provider_key'), { status: 503 });
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: DEFAULT_MODEL, messages: auxMessages(operation, payload), temperature: 0.3, max_tokens: operation === 'diary' ? 900 : operation === 'context-summary' ? 900 : 600, response_format: { type: 'json_object' } }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const error = new Error(`provider_${response.status}`);
    error.status = response.status === 401 ? 401 : response.status === 402 ? 402 : response.status === 429 ? 429 : 502;
    throw error;
  }
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '{}';
  try { return JSON.parse(raw.replace(/^```json?\s*/i, '').replace(/\s*```$/, '')); } catch { throw Object.assign(new Error('invalid_provider_json'), { status: 502 }); }
}

async function chat(body) {
  if (!DEEPSEEK_API_KEY) throw Object.assign(new Error('missing_provider_key'), { status: 503 });
  const requested = body.sessionModel?.model || body.character?.model?.model;
  const model = typeof requested === 'string' && requested.startsWith('deepseek-v') ? DEFAULT_MODEL : (requested || DEFAULT_MODEL);
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: buildMessages(body),
      temperature: Math.max(0, Math.min(1.2, Number(body.temperature ?? 0.8))),
      max_tokens: body.forceVision ? 900 : 700,
      thinking: { type: body.forceVision ? 'disabled' : 'enabled' },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const error = new Error(`provider_${response.status}`);
    error.status = response.status === 401 ? 401 : response.status === 402 ? 402 : response.status === 429 ? 429 : 502;
    throw error;
  }
  const data = await response.json();
  const choice = data.choices?.[0];
  const raw = choice?.message?.content;
  const result = Array.isArray(raw) ? raw.map((part) => typeof part === 'string' ? part : part?.text || '').join('') : String(raw || '');
  return {
    content: result,
    truncated: choice?.finish_reason === 'length',
    usage: data.usage ? { inputTokens: Number(data.usage.prompt_tokens || 0), outputTokens: Number(data.usage.completion_tokens || 0) } : undefined,
    modelId: model,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true, service: 'virtugene-gateway', auth: Boolean(AUTH_SECRET) });
  if (req.method === 'POST' && req.url === '/v1/auth/register') {
    if (!allowed(`register:${req.socket.remoteAddress || 'unknown'}`)) return json(res, 429, { error: 'rate:limited' });
    try {
      return json(res, 201, registerAccount(await readJson(req)));
    } catch (error) {
      const status = Number(error?.status || 500);
      const mapped = status === 409 ? 'auth:username_taken' : status === 400 ? 'invalid_request' : 'server:error';
      return json(res, status, { error: mapped });
    }
  }
  if (req.method === 'POST' && req.url === '/v1/auth/login') {
    if (!allowed(`login:${req.socket.remoteAddress || 'unknown'}`)) return json(res, 429, { error: 'rate:limited' });
    try {
      return json(res, 200, loginAccount(await readJson(req)));
    } catch (error) {
      const status = Number(error?.status || 500);
      const mapped = status === 401 ? 'auth:invalid_credentials' : status === 400 ? 'auth:adult_confirmation_required' : 'server:error';
      return json(res, status, { error: mapped });
    }
  }
  if (req.method === 'POST' && req.url === '/v1/auth/refresh') {
    const auth = String(req.headers.authorization || '');
    const refresh = verifyToken(auth.startsWith('Bearer ') ? auth.slice(7).trim() : '', 'refresh');
    if (!refresh) return json(res, 401, { error: 'auth:invalid_credentials' });
    const user = loadUsers().find((item) => item.id === refresh.sub);
    if (!user || !user.adultConfirmedAt) return json(res, 401, { error: 'auth:invalid_credentials' });
    try {
      return json(res, 200, { user: { id: user.id, username: user.username }, ...issueTokens(user) });
    } catch {
      return json(res, 503, { error: 'server:error' });
    }
  }
  if (req.method === 'DELETE' && req.url === '/v1/auth/account') {
    try {
      deleteAccount(req);
      return json(res, 200, { ok: true });
    } catch (error) {
      const status = Number(error?.status || 500);
      return json(res, status, { error: status === 401 ? 'auth:invalid_credentials' : 'server:error' });
    }
  }
  if (req.method !== 'POST' || !['/v1/chat', '/v1/aux'].includes(req.url)) return json(res, 404, { error: 'not_found' });
  if (!authorized(req)) return json(res, 401, { error: 'auth:invalid_key' });
  const endpointKind = req.url === '/v1/aux' ? 'aux' : 'chat';
  if (!allowed(identity(req), endpointKind)) return json(res, 429, { error: 'rate:limited' });
  try {
    const body = await readJson(req);
    if (req.url === '/v1/aux') {
      if (!['memory', 'emotion', 'context-settle', 'context-summary', 'diary'].includes(body.operation)) return json(res, 400, { error: 'invalid_request' });
      return json(res, 200, await aux(body.operation, body.payload || {}));
    }
    if (!text(body.message, 4_000).trim() || !text(body.systemPrompt, 12_000).trim()) return json(res, 400, { error: 'invalid_request' });
    const intervention = safetyIntervention(body.message);
    return json(res, 200, intervention || await chat(body));
  } catch (error) {
    const status = Number(error?.status || 502);
    const mapped = status === 401 ? 'auth:invalid_key' : status === 402 ? 'billing:insufficient' : status === 429 ? 'rate:limited' : 'server:error';
    return json(res, status >= 400 && status < 600 ? status : 502, { error: mapped });
  }
});

server.listen(PORT, HOST, () => console.log(`VirtuGene AI gateway listening on http://${HOST}:${PORT}`));
