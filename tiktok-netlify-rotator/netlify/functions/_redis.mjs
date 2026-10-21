import initialLinks from '../../links.json' with { type: 'json' };

export const KEYS = ['tiktok-rotator:live-links', 'tiktok-rotator:rotation', 'tiktok-rotator:link-counts'];
export const DEFAULT_LINKS = JSON.stringify(initialLinks);
export const noStore = { 'Cache-Control': 'no-store, no-cache, must-revalidate, private', 'X-Robots-Tag': 'noindex, nofollow' };

export async function redis(script, args = []) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured');
  const response = await fetch(url.replace(/\/$/, ''), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['EVAL', script, KEYS.length.toString(), ...KEYS, DEFAULT_LINKS, ...args]),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`Redis: ${data.error}`);
  return data.result;
}

export const init = "redis.call('SETNX', KEYS[1], ARGV[1])";

export function authorized(req) {
  const key = process.env.ADMIN_KEY;
  return Boolean(key && req.headers.get('Authorization') === `Bearer ${key}`);
}
export function errorResponse(message, status) {
  return new Response(message, {status, headers: { ...noStore, 'Content-Type': 'text/plain; charset=utf-8' }});
}
