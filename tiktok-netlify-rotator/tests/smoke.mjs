import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseProfilePaste, nyDay, recentDays, validateLink, isIsoDate} from '../netlify/functions/_core.mjs';
import admin from '../netlify/functions/admin.mjs';
import rotate from '../netlify/functions/rotate.mjs';

const sample=readFileSync(new URL('../sample-import.txt',import.meta.url),'utf8');
const parsed=parseProfilePaste(sample);
assert.equal(parsed.rows.length,13);
assert.deepEqual(parsed.errors,[]);
assert.ok(parsed.warnings.some(w=>w.includes('196')&&w.includes('195')));
assert.equal(parsed.rows[0].id,'235');
assert.equal(parsed.rows[3].id,'196');
assert.equal(parsed.rows[4].id,'195');
assert.equal(parseProfilePaste('1. 235 [https://pro.tiktok.com/t/abc-123/](https://pro.tiktok.com/t/abc-123/ "https://pro.tiktok.com/t/abc-123/")').rows[0].id,'235');
assert.equal(parseProfilePaste('235 https\\://pro.tiktok.com/t/abc-123/').rows[0].id,'235');
assert.equal(parseProfilePaste('235 https://pro.tiktok.com/t/AAA/ 235 https://pro.tiktok.com/t/BBB/').errors.length,1);
assert.equal(validateLink('https://phishing-site.example/t/abc'),null);
assert.equal(validateLink('https://pro.tiktok.com/t/AAA'),'https://pro.tiktok.com/t/AAA/');
assert.equal(nyDay(new Date('2026-11-01T03:59:00Z')),'2026-10-31');
assert.equal(nyDay(new Date('2026-11-01T04:00:00Z')),'2026-11-01');
assert.equal(recentDays().length,7);
assert.equal(recentDays(7,'2026-11-03').at(-1),'2026-10-28');
assert.equal(recentDays(7,'2026-03-01')[1],'2026-02-28');
assert.ok(isIsoDate('2026-10-25'));
assert.equal(isIsoDate('2026-02-30'),false);
assert.equal(isIsoDate('2026-13-01'),false);
assert.throws(()=>recentDays(91));

process.env.ADMIN_KEY='test-only-never-deploy';
const req=(method,body,authorized=true)=>new Request('https://test.netlify.app/.netlify/functions/admin',{method,headers:{...(authorized?{'Authorization':'Bearer test-only-never-deploy'}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
assert.equal((await admin(req('GET',null,false))).status,401);
const preview=await admin(req('POST',{action:'preview',text:sample}));
assert.equal(preview.status,200);
assert.equal((await preview.json()).rows.length,13);
const bad=await admin(req('POST',{action:'points',id:'235',points:-5}));
assert.equal(bad.status,400);
const badHost=await admin(req('POST',{action:'updateLink',id:'235',url:'https://example.com'}));
assert.equal(badHost.status,400);

process.env.UPSTASH_REDIS_REST_URL='https://placeholder.test';
process.env.UPSTASH_REDIS_REST_TOKEN='testtoken';
let calls=[];
const realFetch=globalThis.fetch;
globalThis.fetch=async (url,options)=>{
 const request=JSON.parse(options.body);calls.push(request);
 if(request[0]!=='EVAL')throw Error('Expected eval');
 if(String(request[1]).includes('No active profiles'))return new Response(JSON.stringify({result:JSON.stringify({url:'https://pro.tiktok.com/t/abc123/',id:'235'})}),{status:200});
 return new Response(JSON.stringify({result:JSON.stringify({ok:true})}),{status:200});
};
const redirect=await rotate();
assert.equal(redirect.status,302);
assert.equal(redirect.headers.get('location'),'https://pro.tiktok.com/t/abc123/');
assert.equal(calls[0][0],'EVAL');
assert.equal(calls[0][2],'8');
assert.ok(calls[0][10].includes('daily-links:'));
assert.ok(String(calls[0][1]).includes('chosen.id..'|'..chosen.url'));
const dailyRead=async(days,end)=>{
  const url=`https://test.netlify.app/.netlify/functions/admin?days=${days}${end?'&end='+end:''}`;
  return admin(new Request(url,{headers:{Authorization:'Bearer test-only-never-deploy'}}));
};
// The API should reject bad date windows before any external Redis call.
assert.equal((await dailyRead(91)).status,400);
assert.equal((await dailyRead(7,'2026-02-30')).status,400);
const today=nyDay();
const earlier=new Date(today+'T12:00:00Z');earlier.setUTCDate(earlier.getUTCDate()-400);
assert.equal((await dailyRead(7,earlier.toISOString().slice(0,10))).status,400);
globalThis.fetch=async (url,options)=>{
 const req=JSON.parse(options.body);calls.push(req);
 if(req[0]!=='EVAL')throw Error('Expected eval');
 if(String(req[1]).includes('local todayVals')){
   const days=Array.from({length:30},(_,i)=>({day:recentDays(30)[i],
      counts:i===0?{'235':4,'196':2}:{},links:i===0?{'235|https://pro.tiktok.com/t/abc123/':3}:{}}));
   const result={profiles:[{id:'235',url:'https://pro.tiktok.com/t/abc123/',active:true,points:750000,doneDate:'',claimedDate:'',claims:0}],
     counts:{'235':26,'196':7},days,todayCounts:{'235':4,'196':2},events:[],legacyRedirects:55};
   return new Response(JSON.stringify({result:JSON.stringify(result)}),{status:200});
 }
 return new Response(JSON.stringify({result:JSON.stringify({ok:true})}),{status:200});
};
const report=await dailyRead(30);
assert.equal(report.status,200);
const parsedReport=await report.json();
assert.equal(parsedReport.totals.todayRedirects,6);
assert.equal(parsedReport.report.redirects,6);
assert.equal(parsedReport.days[0].links['235|https://pro.tiktok.com/t/abc123/'],3);
assert.equal(parsedReport.totals.legacyRedirects,55);
assert.equal(calls.at(-1)[2],'67'); // 6 permanent keys + 2 * 30 days + 1 today key
assert.equal(calls.at(-1)[3], 'tiktok-rotator:v3:state');
assert.ok(calls.at(-1).includes('tiktok-rotator:v3:daily-links:'+today));
const save=await admin(req('POST',{action:'import',text:sample,mode:'replaceActive'}));
assert.equal(save.status,200);
assert.equal((await save.json()).imported,13);
assert.equal(calls.at(-1)[2],'6');
const ev=JSON.parse(calls.at(-1).at(-3));
assert.equal(ev.action,'import');
assert.equal(ev.rows.length,13);
const claim=await admin(req('POST',{action:'claim',id:'235'}));
assert.equal(claim.status,200);
globalThis.fetch=realFetch;
console.log('PASS: import parsing; EST/EDT day boundaries; 7/14/30/90 day API shape and query validation; profile/day/URL redis keys; pre-V4 compatibility; redirect and claim mutations.');
