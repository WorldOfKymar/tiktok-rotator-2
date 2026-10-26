import { evalRedis, initialStateLua, authorized, reply, fail, parseProfilePaste, validateLink, normalizedId, nyDay, recentDays, isIsoDate, dailyKey, dailyLinkKey, POINTS_PER_CLAIM } from './_core.mjs';

// A single Redis read returns profile/day totals, true URL-at-time-of-redirect
// totals, and the fixed "today" counter regardless of the selected report period.
const readScript = `
${initialStateLua()}
local counts = redis.call('HGETALL',KEYS[3])
local countMap={}
for i=1,#counts,2 do countMap[counts[i]]=tonumber(counts[i+1]) end
local n=tonumber(ARGV[2])
local days={}
for i=1,n do
  local day=ARGV[i+2]
  local profileVals=redis.call('HGETALL',KEYS[5+2*i]); local profileMap={}
  for j=1,#profileVals,2 do profileMap[profileVals[j]]=tonumber(profileVals[j+1]) end
  local linkVals=redis.call('HGETALL',KEYS[6+2*i]); local linkMap={}
  for j=1,#linkVals,2 do linkMap[linkVals[j]]=tonumber(linkVals[j+1]) end
  days[#days+1]={day=day, counts=profileMap, links=linkMap}
end
local todayVals=redis.call('HGETALL',KEYS[7+2*n]);local todayCounts={}
for i=1,#todayVals,2 do todayCounts[todayVals[i]]=tonumber(todayVals[i+1]) end
local legacy=0
for _,v in ipairs(redis.call('HVALS',KEYS[6])) do legacy=legacy+tonumber(v) end
local events=redis.call('LRANGE',KEYS[4],0,149)
return cjson.encode({profiles=state.profiles, counts=countMap, days=days,
  todayCounts=todayCounts,events=events,legacyRedirects=legacy})
`;

// All mutations happen in one atomic Redis script, including points, claims, and profile changes.
const mutateScript = `
${initialStateLua()}
local event=cjson.decode(ARGV[2])
local action=event.action
local today=ARGV[3]
local stamp=ARGV[4]
local changed=false
local result={ok=true}
local function locate(id)
  for i,p in ipairs(state.profiles) do if p.id==id then return i,p end end
  return nil,nil
end
local function audit(kind,id,extra)
  redis.call('LPUSH',KEYS[4], cjson.encode({kind=kind, id=id, at=stamp,day=today,extra=extra or ''}))
  redis.call('LTRIM',KEYS[4],0,999)
end
if action=='import' then
  local seen={}
  for _,row in ipairs(event.rows) do
    seen[row.id]=true
    local pos,p=locate(row.id)
    if not p then
      table.insert(state.profiles,{id=row.id,url=row.url,active=true,points=0,doneDate='',claimedDate='',claims=0,updatedAt=stamp})
    else
      p.url=row.url
      p.active=true
      p.updatedAt=stamp
    end
  end
  if event.mode=='replaceActive' then
    for _,p in ipairs(state.profiles) do if not seen[p.id] then p.active=false end end
  end
  redis.call('SET',KEYS[2],0)
  audit('import','',tostring(#event.rows)..' profiles ('..event.mode..')')
  changed=true
elseif action=='toggle' or action=='daily' or action=='points' or action=='claim' or action=='undoClaim' or action=='updateLink' then
  local pos,p=locate(event.id)
  if not pos then return cjson.encode({error='Profile was not found'}) end
  if action=='toggle' then
    p.active=event.active; p.updatedAt=stamp
    redis.call('SET',KEYS[2],0)
  elseif action=='daily' then
    p.doneDate=event.checked and today or ''
  elseif action=='points' then
    p.points=event.points
  elseif action=='updateLink' then
    p.url=event.url;p.updatedAt=stamp
  elseif action=='claim' then
    if p.claimedDate==today then return cjson.encode({error='This profile already has a $50 claim recorded for today'}) end
    if p.points < 750000 then return cjson.encode({error='Insufficient points. Set the balance to at least 750,000 first'}) end
    p.points=p.points-750000
    p.claimedDate=today
    p.claims=(p.claims or 0)+1
    p.lastClaimAt=stamp
    audit('claim',p.id,'-750000 points / $50')
  elseif action=='undoClaim' then
    if p.claimedDate~=today then return cjson.encode({error='Only today’s claim can be undone'}) end
    p.points=p.points+750000
    p.claimedDate=''
    p.claims=math.max(0,(p.claims or 0)-1)
    audit('undoClaim',p.id,'+750000 points / -$50')
  end
  changed=true
elseif action=='bulkToggle' then
  local selected={}
  for _,id in ipairs(event.ids) do selected[id]=true end
  for _,p in ipairs(state.profiles) do if selected[p.id] then p.active=event.active; p.updatedAt=stamp end end
  redis.call('SET',KEYS[2],0)
  changed=true
else
  return cjson.encode({error='Unsupported action'})
end
if changed then redis.call('SET',KEYS[1],cjson.encode(state)) end
return cjson.encode(result)
`;

function validateMutation(body) {
  const a = body?.action;
  if (a === 'preview' || a === 'import') {
    const parsed = parseProfilePaste(body.text);
    if (a === 'import' && parsed.errors.length) throw new Error(parsed.errors.join(' '));
    if (a === 'import' && !['merge','replaceActive'].includes(body.mode)) throw new Error('Invalid import mode');
    return { action:a, rows:parsed.rows, errors:parsed.errors, warnings:parsed.warnings, mode:body.mode };
  }
  if (a === 'bulkToggle') {
    if (!Array.isArray(body.ids) || body.ids.length>500 || body.ids.some(id=>!normalizedId(id)) || typeof body.active!=='boolean') throw new Error('Invalid bulk selection');
    return { action:a, ids:body.ids.map(String),active:body.active };
  }
  if (!['toggle','daily','points','claim','undoClaim','updateLink'].includes(a)) throw new Error('Unknown operation');
  const id = normalizedId(body.id);
  if (!id) throw new Error('Invalid GeeLark profile number');
  const event = {action:a,id};
  if (a==='toggle') {
    if (typeof body.active!=='boolean') throw new Error('Invalid active status');
    event.active=body.active;
  }
  if (a==='daily') {
    if (typeof body.checked!=='boolean') throw new Error('Invalid checkbox status');
    event.checked=body.checked;
  }
  if (a==='points') {
    if (!Number.isSafeInteger(body.points) || body.points<0 || body.points>1000000000000) throw new Error('Points must be a nonnegative whole number');
    event.points=body.points;
  }
  if (a==='updateLink') {
    const url = validateLink(body.url);
    if (!url) throw new Error('Only valid HTTPS TikTok Pro links are accepted');
    event.url=url;
  }
  return event;
}

export default async function(request) {
  if (!authorized(request)) return fail('Invalid admin key',401);
  try {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const period = Number(url.searchParams.get('days') || '30');
      if (![7,14,30,90].includes(period)) return fail('Choose a 7, 14, 30, or 90 day report period');
      const today = nyDay();
      const end = url.searchParams.get('end') || today;
      if (!isIsoDate(end) || end > today)
        return fail('Invalid report end date');
      // Allow inspecting historical reporting windows, but not beyond the retention policy.
      const earliestEnd = new Date(`${today}T12:00:00Z`);
      earliestEnd.setUTCDate(earliestEnd.getUTCDate()-364);
      if (end < earliestEnd.toISOString().slice(0,10)) return fail('Reports older than 365 days are unavailable');
      const dates=recentDays(period,end);
      const keys=dates.flatMap(date=>[dailyKey(date),dailyLinkKey(date)]);
      keys.push(dailyKey(today));
      const raw=JSON.parse(await evalRedis(readScript,{dayKeys:keys,args:[String(period),...dates]}));
      const days=(raw.days||[]).map(item=>({
        date:item.day, counts:item.counts || {},links:item.links || {}
      }));
      const totalNew=Object.values(raw.counts || {}).reduce((a,b)=>a+Number(b),0);
      const todayCounts=raw.todayCounts||{};
      const reportTotals=days.map(day=>Object.values(day.counts).reduce((a,b)=>a+Number(b),0));
      const report={days:period,from:dates[dates.length-1],through:end,
        redirects:reportTotals.reduce((a,b)=>a+b,0),
        averageDaily:reportTotals.reduce((a,b)=>a+b,0)/period,
        bestDay:Math.max(0,...reportTotals)};
      const totals={ profiles:raw.profiles.length,active:raw.profiles.filter(p=>p.active).length,
        checkedToday:raw.profiles.filter(p=>p.doneDate===today).length,
        claimedToday:raw.profiles.filter(p=>p.claimedDate===today).length,
        points:raw.profiles.reduce((s,p)=>s+(p.points||0),0),
        claimCount:raw.profiles.reduce((s,p)=>s+(p.claims||0),0),
        todayRedirects:Object.values(todayCounts).reduce((a,b)=>a+Number(b),0),
        totalRedirects:totalNew,legacyRedirects:raw.legacyRedirects||0 };
      return reply({today, timezone:'America/New_York', profiles:raw.profiles, counts:raw.counts,
        todayCounts, days, report,
        events:(raw.events||[]).map(v=>{try{return JSON.parse(v)}catch{return null}}).filter(Boolean),totals});
    }
    if (request.method !== 'POST') return fail('Method not allowed',405);
    const text=await request.text();
    if (text.length>260000) return fail('Request too large',413);
    let body;
    try { body=JSON.parse(text) } catch { return fail('Invalid JSON') }
    let event;
    try { event=validateMutation(body); } catch (error) { return fail(error.message,400); }
    if (event.action==='preview') return reply(event);
    const raw=JSON.parse(await evalRedis(mutateScript,{args:[JSON.stringify(event),nyDay(),new Date().toISOString()]}));
    if (raw.error) return fail(raw.error,409);
    return reply({saved:true,...(event.action==='import' ? {imported:event.rows.length, warnings:event.warnings}: {})});
  } catch(error) {
    if (error instanceof SyntaxError || /Invalid|Unknown|No GeeLark|Maximum|Paste text|Profile .*more than|immediately before/.test(error.message)) return fail(error.message,400);
    console.error('Admin service:',error);
    return fail('Service unavailable. Review Netlify Function logs and Redis settings.',503);
  }
}
