import { evalRedis, initialStateLua, nyDay, dailyKey, dailyLinkKey, noStore, validateLink } from './_core.mjs';

const script = `
${initialStateLua()}
local active={}
for _,p in ipairs(state.profiles) do
  if p.active and type(p.url)=='string' and p.url~='' then table.insert(active,p) end
end
if #active==0 then return cjson.encode({ error='No active profiles' }) end
local cursor=redis.call('INCR', KEYS[2])
local chosen=active[((cursor-1)%#active)+1]
redis.call('HINCRBY',KEYS[3],chosen.id,1)
redis.call('HINCRBY',KEYS[7],chosen.id,1)
redis.call('EXPIRE',KEYS[7],86400*400)
-- Preserve the exact URL that received the redirect, even if this profile changes links.
redis.call('HINCRBY',KEYS[8],chosen.id..'|'..chosen.url,1)
redis.call('EXPIRE',KEYS[8],86400*400)
return cjson.encode({url=chosen.url,id=chosen.id})
`;
export default async () => {
  try {
    const result = JSON.parse(await evalRedis(script,{dayKeys:[dailyKey(nyDay()),dailyLinkKey(nyDay())]}));
    const destination = validateLink(result.url);
    if (!destination) throw new Error(result.error || 'Invalid rotation destination');
    return new Response(null,{status:302, headers:{...noStore,Location:destination, Pragma:'no-cache'}});
  } catch(e) {
    console.error('Rotation issue:',e);
    return new Response('No active destinations are available or the redirect service is offline.',{status:503,headers:{...noStore,'Content-Type':'text/plain; charset=utf-8'}});
  }
};
