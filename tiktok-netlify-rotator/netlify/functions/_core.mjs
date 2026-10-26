import { timingSafeEqual } from 'node:crypto';
import initialLinks from '../../links.json' with { type: 'json' };

export const PREFIX = 'tiktok-rotator';
export const ROOT_KEYS = [
  `${PREFIX}:v3:state`,
  `${PREFIX}:v3:rotation`,
  `${PREFIX}:v3:total`,
  `${PREFIX}:v3:events`,
  `${PREFIX}:live-links`,
  `${PREFIX}:link-counts`
];
export const dailyKey = date => `${PREFIX}:v3:daily:${date}`;
// URL-specific daily tallies, keyed by both GeeLark ID and actual link at redirect time.
export const dailyLinkKey = date => `${PREFIX}:v3:daily-links:${date}`;
export const noStore = { 'Cache-Control':'private, no-store, max-age=0', 'X-Robots-Tag':'noindex, nofollow', 'Referrer-Policy':'no-referrer' };
export const POINTS_PER_CLAIM = 750000;

export function nyDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}
export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function recentDays(count = 7, end = nyDay()) {
  if (!isIsoDate(end) || !Number.isSafeInteger(count) || count < 1 || count > 90)
    throw new Error('Invalid statistics date range');
  const [y,m,d] = end.split('-').map(Number);
  return Array.from({length: count}, (_,i) => new Date(Date.UTC(y,m-1,d-i,12)).toISOString().slice(0,10));
}
export function validateLink(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  return /^https:\/\/pro\.tiktok\.com\/t\/[a-zA-Z0-9_-]+\/?$/.test(trimmed)
    ? (trimmed.endsWith('/') ? trimmed : `${trimmed}/`) : null;
}
export function normalizedId(id) {
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const value = String(id).trim();
  return /^(?:[0-9]{1,6}|legacy-[0-9]{3})$/.test(value) ? value : null;
}
export function authorized(req) {
  const key = process.env.ADMIN_KEY || '';
  const supplied = req.headers.get('authorization') || '';
  if (!key || !supplied.startsWith('Bearer ')) return false;
  const a = Buffer.from(supplied.slice(7));
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a,b);
}
export function reply(data, status = 200) {
  return Response.json(data, { status, headers:noStore });
}
export function fail(message,status=400) { return reply({error: message},status); }
export function initialStateLua() {
  return `
    if redis.call('EXISTS', KEYS[1]) == 0 then
      local old = redis.call('GET', KEYS[5])
      local urls
      if old then
        local ok, parsed = pcall(cjson.decode, old)
        if ok and type(parsed) == 'table' then urls = parsed end
      end
      if not urls then urls = cjson.decode(ARGV[1]) end
      local rows = {}
      for i, url in ipairs(urls) do
        rows[i] = { id=string.format('legacy-%03d',i), url=url, active=true, points=0,
          doneDate='', claimedDate='', claims=0, updatedAt='' }
      end
      redis.call('SETNX', KEYS[1], cjson.encode({ version=3, profiles=rows }))
    end
    local state = cjson.decode(redis.call('GET',KEYS[1]))
  `;
}
export async function evalRedis(script, {args=[], dayKeys=[]} = {}) {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !token) throw new Error('Missing Upstash Redis settings');
  const keys = [...ROOT_KEYS,...dayKeys];
  const cmd = ['EVAL',script,String(keys.length), ...keys,JSON.stringify(initialLinks),...args.map(String)];
  const response = await fetch(redisUrl.replace(/\/$/,''), {
    method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify(cmd), signal:AbortSignal.timeout(9000)
  });
  if (!response.ok) throw new Error(`Upstash responded ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}
export function parseProfilePaste(text) {
  if (typeof text !== 'string' || text.length > 250000) throw new Error('Paste text must be under 250,000 characters');
  const s = text.replace(/\\:/g, ':').replace(/\\\//g, '/')
    .replace(/\[(https:\/\/pro\.tiktok\.com\/t\/[a-zA-Z0-9_-]+\/?)\]\(\s*https:\/\/pro\.tiktok\.com\/t\/[a-zA-Z0-9_-]+\/?(?:\s+"[^"]*")?\s*\)/g, '$1');
  const re = /https:\/\/pro\.tiktok\.com\/t\/[a-zA-Z0-9_-]+\/?/g;
  const rows = [], warnings = [], errors = [];
  const mapping = new Map();
  let previousEnd = 0, match;
  while ((match = re.exec(s)) !== null) {
    const before = s.slice(previousEnd,match.index);
    const numbers = [...before.matchAll(/(?:^|[\s([{:])([0-9]{1,6})(?=\s|$)/g)];
    if (!numbers.length) {
      errors.push(`A link at position ${match.index + 1} has no profile number immediately before it.`);
    } else {
      const id = numbers.at(-1)[1];
      const url = validateLink(match[0]);
      if (mapping.has(id)) {
        errors.push(`GeeLark profile ${id} appears more than once. Please keep one link per profile.`);
      } else if (url) { mapping.set(id,url); rows.push({id,url}); }
    }
    previousEnd = re.lastIndex;
  }
  if (!rows.length) errors.push('No GeeLark profile/link pairs found. Paste profile number followed by TikTok URL.');
  if (rows.length > 500) errors.push('Maximum 500 profiles per website.');
  const byUrl = new Map();
  for (const r of rows) {
    if (byUrl.has(r.url)) warnings.push(`Profiles ${byUrl.get(r.url)} and ${r.id} share the same TikTok URL; they will have separate traffic counters, but both lead to the same destination.`);
    else byUrl.set(r.url,r.id);
  }
  return {rows, warnings, errors};
}
