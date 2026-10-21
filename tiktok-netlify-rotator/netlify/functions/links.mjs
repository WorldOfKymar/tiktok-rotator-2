import { redis, init, authorized, noStore, errorResponse } from './_redis.mjs';

const fetchScript = `${init}\nreturn redis.call('GET', KEYS[1])`;
const saveScript = `
${init}
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], 0)
return redis.call('GET', KEYS[1])
`;
export default async (request) => {
  if (!authorized(request)) return errorResponse('Unauthorized', 401);
  if (request.method !== 'GET' && request.method !== 'PUT') return errorResponse('Method not allowed', 405);
  try {
    if (request.method === 'GET') {
      return Response.json({ links: JSON.parse(await redis(fetchScript)) }, { headers: noStore });
    }
    const content = await request.text();
    if (content.length > 150000) return errorResponse('Too many links', 413);
    let input;
    try { input = JSON.parse(content); } catch { return errorResponse('Invalid JSON', 400); }
    if (!Array.isArray(input.links) || input.links.length < 1 || input.links.length > 300) return errorResponse('Provide between 1 and 300 links', 400);
    const links = input.links.map(v => typeof v === 'string' ? v.trim() : '');
    if (links.some(v => !/^https:\/\/pro\.tiktok\.com\/t\/[a-zA-Z0-9_-]+\/$/.test(v))) return errorResponse('Only TikTok Pro referral URLs in the expected format are accepted', 400);
    if (new Set(links).size !== links.length) return errorResponse('Remove duplicate links', 400);
    await redis(saveScript, [JSON.stringify(links)]);
    return Response.json({ saved: true, linkCount: links.length }, { headers: noStore });
  } catch (err) { console.error('Links request failed', err); return errorResponse('Link manager temporarily unavailable', 503); }
};
