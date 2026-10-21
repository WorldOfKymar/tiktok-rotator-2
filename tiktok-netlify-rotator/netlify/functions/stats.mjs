import { redis, init, authorized, noStore, errorResponse } from './_redis.mjs';

const script = `
${init}
local links = cjson.decode(redis.call('GET', KEYS[1]))
local counts = {}
local total = 0
for i, url in ipairs(links) do
  local count = tonumber(redis.call('HGET', KEYS[3], url) or '0')
  counts[i] = { url = url, index = i, redirects = count }
end
local history = redis.call('HVALS', KEYS[3])
for _, n in ipairs(history) do total = total + tonumber(n) end
return cjson.encode({ totalRedirects = total, linkCount = #links, destinations = counts })
`;
export default async (request) => {
  if (!authorized(request)) return errorResponse('Unauthorized', 401);
  try {
    const raw = await redis(script);
    return Response.json(JSON.parse(raw), { headers: noStore });
  } catch (err) { console.error('Stats failed', err); return errorResponse('Stats unavailable', 503); }
};
