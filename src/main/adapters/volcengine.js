// 火山方舟（volcengine）余额：无 Bearer API，走火山引擎签名 OpenAPI。
// GET https://open.volcengineapi.com/?Action=QueryBalanceAcct&Version=2022-01-01
// Service: billing，Region: cn-beijing，HMAC-SHA256 签名（火山版 SigV4，无 "AWS4" 前缀）。
// 签名规则见 https://www.volcengine.com/docs/6369/67269 ，实现已用该文档的官方测试向量验证。
// 凭证字段：monitor.auth.accessKey / monitor.auth.secretKey
const crypto = require('crypto');
const { requestJson, toNumber } = require('./api-balance');

const HOST = 'open.volcengineapi.com';
const SERVICE = 'billing';
const REGION = 'cn-beijing';
const VERSION = '2022-01-01';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function hmacHex(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

// 火山编码规则：仅 A-Za-z0-9-._~ 不编码，其余 %XX（大写），空格 %20
function uriEncode(value) {
  const bytes = Buffer.from(String(value), 'utf8');
  let out = '';
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    out += /[A-Za-z0-9\-._~]/.test(ch) ? ch : '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

function canonicalQuery(query) {
  return Object.keys(query || {})
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
    .join('&');
}

// Date → 20250329T180937Z
function toXDate(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// 纯函数：火山引擎版 SigV4 签名。
// 返回 { authorization, xDate, signature, signedHeaders, headers }；
// headers 为实际要发送的头（不含 Host——fetch 会从 URL 推导，且 Host 是 forbidden header）
function signVolc({ method, host, path: reqPath = '/', query = {}, headers = {}, body = '', service, region, ak, sk, date }) {
  const now = date ? new Date(date) : new Date();
  const xDate = toXDate(now);
  const shortDate = xDate.slice(0, 8);
  const payloadHash = sha256Hex(body || '');

  // 最小签名头集合：host + x-date（官方文档示例即此集合；调用方可经 headers 追加）
  const all = { host, 'x-date': xDate };
  for (const [k, v] of Object.entries(headers)) {
    all[k.toLowerCase()] = String(v).trim();
  }
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${all[n]}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    String(method || 'GET').toUpperCase(),
    reqPath || '/',
    canonicalQuery(query),
    canonicalHeaders, // 自带尾部 \n，join 后形成空行
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, scope, sha256Hex(canonicalRequest)].join('\n');

  // 派生链：HMAC(SK, date) → HMAC(·, region) → HMAC(·, service) → HMAC(·, "request")，无前缀
  const kDate = hmac(sk, shortDate);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'request');
  const signature = hmacHex(kSigning, stringToSign);

  const authorization = `HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const sendHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== 'host') sendHeaders[k] = v;
  }
  sendHeaders['X-Date'] = xDate;
  sendHeaders.Authorization = authorization;

  return { authorization, xDate, signature, signedHeaders, headers: sendHeaders };
}

// 纯函数：QueryBalanceAcct 响应 → {balance, currency}
function parseVolcBalance(resp) {
  const err = resp && resp.ResponseMetadata && resp.ResponseMetadata.Error;
  if (err && err.Code) {
    throw new Error(`火山引擎错误 ${err.Code}: ${err.Message || '未知错误'}`);
  }
  const r = resp && resp.Result;
  if (!r || r.AvailableBalance === undefined || r.AvailableBalance === null) {
    throw new Error('火山引擎响应缺少 Result.AvailableBalance');
  }
  return { balance: toNumber(r.AvailableBalance, 'Result.AvailableBalance'), currency: 'CNY' };
}

async function fetchBalance(monitor) {
  const auth = (monitor && monitor.auth) || {};
  if (!auth.accessKey || !auth.secretKey) {
    throw new Error('未配置火山引擎 accessKey / secretKey');
  }
  const endpoint = auth.baseUrl || `https://${HOST}/`;
  const u = new URL(endpoint);
  const query = { Action: 'QueryBalanceAcct', Version: VERSION };
  u.searchParams.forEach((v, k) => {
    if (!(k in query)) query[k] = v;
  });

  const signed = signVolc({
    method: 'GET',
    host: u.host,
    path: u.pathname || '/',
    query,
    service: SERVICE,
    region: REGION,
    ak: auth.accessKey,
    sk: auth.secretKey,
  });
  const url = `${u.origin}${u.pathname || '/'}?${canonicalQuery(query)}`;
  const json = await requestJson(url, { headers: signed.headers });
  return parseVolcBalance(json);
}

module.exports = {
  kind: 'balance',
  supportedKinds: ['balance'],
  fetchBalance,
  signVolc,
  parseVolcBalance,
  canonicalQuery,
  uriEncode,
};
