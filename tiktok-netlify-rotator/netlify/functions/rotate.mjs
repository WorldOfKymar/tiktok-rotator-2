import { redis, init, noStore, errorResponse } from './_redis.mjs';

const script = `
${init}
local links = cjson.decode(redis.call('GET', KEYS[1]))
if #links == 0 then return redis.error_reply('No active links') end
local sequence = redis.call('INCR', KEYS[2])
local index = ((sequence - 1) % #links) + 1
local target = links[index]
redis.call('HINCRBY', KEYS[3], target, 1)
return target
`;

export default async () => {
  try {
    const target = await redis(script);
    if (typeof target !== 'string' || !/^https:\/\/pro\.tiktok\.com\/t\//.test(target)) throw new Error('Invalid destination');
    return new Response(null, { status: 302, headers: { ...noStore, Location: target, Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer' } });
  } catch (err) {
    console.error('Rotation failed', err);
    return errorResponse('Redirect service temporarily unavailable.', 503);
  }
};
