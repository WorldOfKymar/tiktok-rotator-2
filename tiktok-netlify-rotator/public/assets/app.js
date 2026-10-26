(() => {
'use strict';
const $ = id => document.getElementById(id);
const state={key:'',data:null,view:'profiles',filter:'all',search:'',selected:new Set(),preview:null,locked:false,refreshing:false,reportDays:30,reportEnd:'',selectedDay:null};
const count = n => Number(n||0).toLocaleString('en-US');
const currency = n => Number(n||0).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const pointThreshold=750000;
const el=(tag,cls,content)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(content!==undefined)x.textContent=String(content);return x;};
function toast(message,error=false){const node=$('toast');node.textContent=message;node.className=error?'error':'';node.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.hidden=true,4500)}
function showView(name){state.view=name;for(const tab of ['profiles','import','activity']) $(tab+'View').hidden=(tab!==name);for(const btn of document.querySelectorAll('[data-view]'))btn.classList.toggle('active',btn.dataset.view===name);if(name==='activity')renderActivity();if(name==='daily')renderDaily()}
for(const btn of document.querySelectorAll('[data-view]'))btn.addEventListener('click',()=>showView(btn.dataset.view));
$('jumpImport').addEventListener('click',()=>showView('import'));
$('goImportLegacy').addEventListener('click',()=>showView('import'));
async function api(method='GET',payload=null){
  const path=method==='GET'?`/api/admin?days=${state.reportDays}${state.reportEnd?'&end='+encodeURIComponent(state.reportEnd):''}`:'/api/admin';
  const response=await fetch(path,{method,headers:{Authorization:'Bearer '+state.key,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),cache:'no-store'});
  let result;try{result=await response.json()}catch{throw new Error(`Server returned ${response.status}; check Netlify functions`)}
  if(!response.ok)throw new Error(result.error||`Request failed (${response.status})`);
  return result;
}
function busy(on){state.locked=on;for(const button of document.querySelectorAll('#appContent button'))if(button.id!=='refreshBtn'||on)button.disabled=on;}
async function refresh(silent=false){
  if(!state.key||state.refreshing||state.locked)return;
  state.refreshing=true;
  try{const data=await api();state.data=data;$('loginPanel').hidden=true;$('appContent').hidden=false;$('refreshBtn').disabled=false;renderAll();$('lastSync').textContent='Synced '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});if(!silent)toast('Statistics refreshed');}
  catch(err){if(!silent)toast(err.message,true);if(/admin key/i.test(err.message)){$('loginPanel').hidden=false;$('appContent').hidden=true;state.key='';}}
  finally{state.refreshing=false;}
}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();state.key=$('keyInput').value;if(!state.key)return;$('keyInput').value='';await refresh(true);if(state.data)toast('Dashboard connected');else toast('Could not load. Check your admin key and database settings.',true)});
$('refreshBtn').addEventListener('click',()=>refresh());$('refreshActivity').addEventListener('click',()=>refresh());
async function mutate(action, fields={}, silent=false){
  if(state.locked)return false;
  state.locked=true;
  try{const result=await api('POST',{action,...fields});if(!silent)toast('Saved');state.locked=false;await refresh(true);return result;}
  catch(e){state.locked=false;toast(e.message,true);return false;}
}
function profilesSorted(){return [...(state.data?.profiles||[])].sort((a,b)=>{const n=Number(a.id),m=Number(b.id);if(Number.isInteger(n)&&Number.isInteger(m))return n-m;if(Number.isInteger(n))return -1;if(Number.isInteger(m))return 1;return a.id.localeCompare(b.id)})}
function eligible(p){return Number(p.points)>=pointThreshold&&p.claimedDate!==state.data.today}
function currentProfile(p){const day=state.data.today;const q=state.search.toLowerCase();if(q&&!String(p.id).toLowerCase().includes(q)&&!p.url.toLowerCase().includes(q))return false;
  switch(state.filter){case 'active':return p.active;case 'inactive':return !p.active;case 'done':return p.doneDate===day;case 'notdone':return p.doneDate!==day;case 'claimable':return eligible(p);case 'claimed':return p.claimedDate===day;default:return true;}}
function renderAll(){const d=state.data;if(!d)return;
  $('dayIndicator').textContent=`New York date · ${d.today}`;
  $('metricRedirects').textContent=count(d.totals.totalRedirects+d.totals.legacyRedirects);
  $('metricLegacy').textContent=`${count(d.totals.totalRedirects)} since upgrade · ${count(d.totals.legacyRedirects)} historical`;
  $('metricActive').textContent=count(d.totals.active);$('metricProfiles').textContent=`${count(d.totals.profiles)} profiles loaded`;
  $('metricDone').textContent=`${count(d.totals.checkedToday)} / ${count(d.totals.profiles)}`;
  $('metricClaims').textContent=count(d.totals.claimedToday);$('metricClaimsTotal').textContent=`${currency(d.totals.claimCount*50)} recorded in all time`;
  $('migrationNote').hidden=!d.profiles.some(p=>p.id.startsWith('legacy-')&&p.active);
  renderRows();renderActivity();renderDaily();
}
function renderRows(){const d=state.data;if(!d)return;const filtered=profilesSorted().filter(currentProfile);$('tableCount').textContent=`${filtered.length} shown`;$('selectedCount').textContent=`${state.selected.size} selected`;
  $('selectAll').checked=filtered.length>0&&filtered.every(p=>state.selected.has(p.id));$('selectAll').indeterminate=filtered.some(p=>state.selected.has(p.id))&&!$('selectAll').checked;
  const tbody=$('profileRows');tbody.replaceChildren();if(!filtered.length){const tr=el('tr');const td=el('td','empty','No profiles match the current search or filter.');td.colSpan=8;tr.append(td);tbody.append(tr);return}
  const fragment=document.createDocumentFragment();for(const p of filtered){const tr=el('tr');tr.dataset.id=p.id;
    const done=el('td'),doneInput=el('input','daily-box');doneInput.type='checkbox';doneInput.checked=p.doneDate===d.today;doneInput.dataset.action='daily';doneInput.setAttribute('aria-label',`Mark GeeLark ${p.id} done for today`);done.append(doneInput);
    const profile=el('td'),flex=el('div','profile-cell'),avatar=el('span','avatar',/^\d+$/.test(p.id)?p.id:'L'),heading=el('div'),name=el('strong',null,/^\d+$/.test(p.id)?`#${p.id}`:p.id),sub=el('small',null,`↳ ${p.doneDate===d.today?'Completed today':'Not marked today'}`);heading.append(name,sub);flex.append(avatar,heading);profile.append(flex);
    const link=el('td','link-cell'),anchor=el('a',null,p.url),edit=el('button','edit-link','Edit link');anchor.href=p.url;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.title=p.url;edit.dataset.action='edit';link.append(anchor,edit);
    const status=el('td'),switchLabel=el('label','toggle-wrap'),toggle=el('input');toggle.type='checkbox';toggle.checked=Boolean(p.active);toggle.dataset.action='toggle';toggle.setAttribute('aria-label',`Make profile ${p.id} active`);switchLabel.append(toggle,el('span','switch'),el('span',null,p.active?'Active':'Paused'));status.append(switchLabel);
    const balance=el('td'),pts=el('input','points-input');pts.type='text';pts.inputMode='numeric';pts.value=String(p.points??0);pts.dataset.action='points';pts.setAttribute('aria-label',`Points balance for GeeLark ${p.id}`);const small=el('div','points-hint',`${Math.floor(Number(p.points||0)/pointThreshold)} × 750k claims available`);balance.append(pts,small);
    const claim=el('td');if(p.claimedDate===d.today){claim.append(el('div','claimed','✓ Claimed today'));const undo=el('button','undo-button',"Undo today\'s claim");undo.dataset.action='undoClaim';claim.append(undo)}else{const button=el('button','claim-button','Record $50 claim');button.dataset.action='claim';button.disabled=!eligible(p);button.title=eligible(p)?'Deduct 750,000 points and log this claim':'At least 750,000 points required';claim.append(button)}
    const traffic=el('td','redirect-cell');const today=Number(d.todayCounts?.[p.id]||0),all=Number(d.counts?.[p.id]||0);traffic.append(document.createTextNode(count(today)+' '),el('small',null,'/ '+count(all)));const history=el('button','history-link','View daily');history.dataset.action='history';traffic.append(history);
    const select=el('td'),selectInput=el('input','row-select');selectInput.type='checkbox';selectInput.checked=state.selected.has(p.id);selectInput.dataset.action='select';selectInput.setAttribute('aria-label',`Select GeeLark profile ${p.id}`);select.append(selectInput);
    tr.append(done,profile,link,status,balance,claim,traffic,select);fragment.append(tr)}tbody.append(fragment)}
$('searchProfiles').addEventListener('input',e=>{state.search=e.target.value.trim();renderRows()});$('statusFilter').addEventListener('change',e=>{state.filter=e.target.value;renderRows()});
$('selectAll').addEventListener('change',e=>{for(const p of profilesSorted().filter(currentProfile)){if(e.target.checked)state.selected.add(p.id);else state.selected.delete(p.id)}renderRows()});
$('profileRows').addEventListener('change',async e=>{const input=e.target,row=input.closest('tr');if(!row)return;const id=row.dataset.id;const action=input.dataset.action;
  if(action==='select'){if(input.checked)state.selected.add(id);else state.selected.delete(id);$('selectedCount').textContent=state.selected.size+' selected';return}
  if(action==='toggle'){const result=await mutate('toggle',{id,active:input.checked});if(!result)input.checked=!input.checked}
  if(action==='daily'){const result=await mutate('daily',{id,checked:input.checked});if(!result)input.checked=!input.checked}
  if(action==='points')savePoints(input,id);
});
$('profileRows').addEventListener('keydown',e=>{if(e.target.dataset.action==='points'&&e.key==='Enter'){e.preventDefault();e.target.blur()}});
$('profileRows').addEventListener('focusout',e=>{if(e.target.dataset.action==='points'){const row=e.target.closest('tr');if(row)savePoints(e.target,row.dataset.id)}});
async function savePoints(input,id){const raw=input.value.trim().replace(/[\s,]/g,'');if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))){toast('Enter a nonnegative whole number of points',true);return}const points=Number(raw);const existing=state.data.profiles.find(p=>p.id===id);if(!existing||points===existing.points)return;await mutate('points',{id,points})}
$('profileRows').addEventListener('click',async e=>{const btn=e.target.closest('button[data-action]');if(!btn)return;const row=btn.closest('tr'),id=row?.dataset.id,p=state.data.profiles.find(x=>x.id===id);if(!p)return;
  if(btn.dataset.action==='history'){state.selectedDay=state.data.today;showView('daily');$('dailyLinkSearch').value=id;renderDayDetail();return}
  if(btn.dataset.action==='edit'){const url=prompt(`TikTok Pro link for GeeLark profile ${id}`,p.url);if(url===null||url===p.url)return;await mutate('updateLink',{id,url:url.trim()});}
  if(btn.dataset.action==='claim'){if(confirm(`Record today's $50 claim for GeeLark ${id}?\n\nThis deducts 750,000 points and can only be recorded once per New York day.`))await mutate('claim',{id})}
  if(btn.dataset.action==='undoClaim'){if(confirm(`Undo today's claim for GeeLark ${id}?\nThis restores 750,000 points and reverses the $50 bookkeeping entry.`))await mutate('undoClaim',{id})}
});
async function bulk(active){if(!state.selected.size){toast('Select profiles using the boxes on the far right.',true);return}if(!confirm(`${active?'Enable':'Pause'} ${state.selected.size} selected GeeLark profiles?`))return;const saved=await mutate('bulkToggle',{ids:[...state.selected],active});if(saved)state.selected.clear()}
$('bulkEnable').addEventListener('click',()=>bulk(true));$('bulkDisable').addEventListener('click',()=>bulk(false));
function download(filename,text,type){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const link=el('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),6000)}
function csvQuote(value){return '"'+String(value??'').replace(/"/g,'""')+'"'}
$('exportCsv').addEventListener('click',()=>{if(!state.data)return;const d=state.data,head=['profile_id','url','active','points','done_today','claimed_today','claim_count','redirects_today','redirects_in_selected_range','redirects_since_upgrade'];const rows=profilesSorted().map(p=>[p.id,p.url,p.active?'yes':'no',p.points,p.doneDate===d.today?'yes':'no',p.claimedDate===d.today?'yes':'no',p.claims||0,d.todayCounts?.[p.id]||0,d.days.reduce((sum,day)=>sum+(day.counts?.[p.id]||0),0),d.counts?.[p.id]||0]);download(`geelark-profiles-${d.today}.csv`,[head,...rows].map(r=>r.map(csvQuote).join(',')).join('\r\n'),'text/csv;charset=utf-8')});
$('backupJson').addEventListener('click',()=>{if(!state.data)return;download(`geelark-backup-${state.data.today}.json`,JSON.stringify({...state.data,backupCreatedAt:new Date().toISOString()},null,2),'application/json')});
$('pasteInput').addEventListener('input',()=>{state.preview=null;$('importPreview').hidden=true});
$('previewImport').addEventListener('click',async()=>{const text=$('pasteInput').value;if(!text.trim()){toast('Paste your profile numbers and URLs first.',true);return}try{const result=await api('POST',{action:'preview',text});state.preview=result;renderPreview(result)}catch(err){toast(err.message,true)}});
function renderPreview(result){$('importPreview').hidden=false;$('previewSummary').textContent=result.errors.length?`${result.rows.length} parsed, ${result.errors.length} problem(s) — fix before saving`:`✓ ${result.rows.length} GeeLark profile/link pairs identified`;
  $('previewWarnings').replaceChildren();for(const issue of [...result.errors,...result.warnings])$('previewWarnings').append(el('div',null,'• '+issue));$('saveImport').disabled=Boolean(result.errors.length);
  $('previewRows').replaceChildren();for(const row of result.rows){const tr=el('tr');tr.append(el('td',null,'#'+row.id),el('td',null,row.url));$('previewRows').append(tr)}
}
$('saveImport').addEventListener('click',async()=>{const parsed=state.preview;if(!parsed||parsed.errors?.length){toast('Preview and resolve errors first.',true);return}const mode=document.querySelector('input[name=importMode]:checked').value;const text=$('pasteInput').value;const extra=mode==='replaceActive'?' Other profiles will be paused, not deleted.':'';
  if(!confirm(`Import ${parsed.rows.length} profiles?${extra}\n\nExisting point balances, claims, and redirect stats will remain attached to each GeeLark profile number.`))return;
  const result=await mutate('import',{text,mode});if(result){$('pasteInput').value='';$('importPreview').hidden=true;state.preview=null;showView('profiles');toast(`Imported ${result.imported} profiles; rotation updated.`)}});
// Daily reporting: each date has a profile-count hash plus an exact-URL hash.
// For historical V3 days, subtract known URL counts from the day's profile total
// to show unattributed redirects rather than guessing which URL used to be active.
function dayTotal(day){return Object.values(day.counts||{}).reduce((sum,n)=>sum+Number(n||0),0)}
function dayEntries(day){
  if(!day)return [];
  const entries=[],byId={};
  for(const [pair,value] of Object.entries(day.links||{})){
    const divider=pair.indexOf('|');if(divider<0)continue;
    const id=pair.slice(0,divider),url=pair.slice(divider+1),amount=Number(value)||0;
    if(amount<=0)continue;
    entries.push({id,url,redirects:amount,attributed:true});
    byId[id]=(byId[id]||0)+amount;
  }
  for(const [id,value] of Object.entries(day.counts||{})){
    const unattributed=Math.max(0,(Number(value)||0)-(byId[id]||0));
    if(unattributed>0)entries.push({id,url:'URL not recorded (before daily link tracking)',redirects:unattributed,attributed:false});
  }
  return entries.sort((a,b)=>b.redirects-a.redirects||a.id.localeCompare(b.id,undefined,{numeric:true}));
}
function renderDaily(){
  const d=state.data;if(!d)return;
  $('reportDays').value=String(d.report.days);
  $('reportEnd').value=d.report.through;
  $('reportEnd').max=d.today;
  $('reportTotal').textContent=count(d.report.redirects);
  $('reportAverage').textContent=count(Math.round(d.report.averageDaily));
  $('reportBest').textContent=count(d.report.bestDay);
  $('reportPeriod').textContent=`${d.report.days} days`;
  if(!d.days.some(day=>day.date===state.selectedDay))state.selectedDay=d.days[0]?.date||null;
  const max=Math.max(1,...d.days.map(dayTotal));
  const graph=$('dailyTrafficChart');graph.replaceChildren();
  for(const day of [...d.days].reverse()){
    const total=dayTotal(day),group=el('button','daily-bar-group');group.type='button';
    group.dataset.day=day.date;group.title=`${day.date}: ${count(total)} redirects`;
    group.setAttribute('aria-label',`View ${day.date}, ${count(total)} redirect assignments`);
    if(day.date===state.selectedDay)group.classList.add('selected-day');
    const bar=el('span','daily-bar');bar.style.height=`${Math.max(3,Math.round(126*total/max))}px`;
    group.append(el('span','daily-bar-count',count(total)),bar,el('span','daily-bar-date',day.date.slice(5)));
    graph.append(group);
  }
  const body=$('dailyTotalsRows');body.replaceChildren();
  for(const day of d.days){
    const tr=el('tr');if(day.date===state.selectedDay)tr.classList.add('selected-day');
    const linkRecords=new Set(dayEntries(day).filter(entry=>entry.attributed).map(entry=>entry.url)).size;
    tr.append(el('td',null,day.date),el('td','num-cell',count(dayTotal(day))),
      el('td','num-cell',count(Object.values(day.counts).filter(n=>Number(n)>0).length)),
      el('td','num-cell',count(linkRecords)));
    const cell=el('td'),btn=el('button','day-view-button','View breakdown →');btn.type='button';btn.dataset.day=day.date;cell.append(btn);tr.append(cell);body.append(tr);
  }
  renderDayDetail();
}
function renderDayDetail(){
  const d=state.data;if(!d)return;
  const day=d.days.find(item=>item.date===state.selectedDay)||d.days[0];if(!day)return;
  $('dailyDetailTitle').textContent=`${day.date} · ${count(dayTotal(day))} redirects`;
  $('dailyDetailSubtitle').textContent='Per-profile and per-destination assignments for this New York calendar day';
  const q=$('dailyLinkSearch').value.trim().toLowerCase();
  const entries=dayEntries(day).filter(item=>!q||item.id.toLowerCase().includes(q)||item.url.toLowerCase().includes(q));
  const body=$('dailyDetailRows');body.replaceChildren();
  if(!entries.length){const tr=el('tr'),td=el('td','empty',dayTotal(day)?'No links matched this search.':'No redirects recorded for this date.');td.colSpan=3;tr.append(td);body.append(tr)}
  for(const item of entries){
    const tr=el('tr'),dest=el('td','history-url');
    if(item.attributed&&/^https:\/\/pro\.tiktok\.com\/t\//.test(item.url)){
      const a=el('a',null,item.url);a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';dest.append(a);
    }else dest.append(el('span','unattributed',item.url));
    tr.append(el('td','profile-id','#'+item.id),dest,el('td','num-cell',count(item.redirects)));body.append(tr);
  }
  for(const b of document.querySelectorAll('[data-day]'))b.classList.toggle('selected-day',b.dataset.day===day.date);
  for(const row of $('dailyTotalsRows').children){row.classList.toggle('selected-day',row.firstElementChild?.textContent===day.date)}
}
async function applyReport(){
  const days=Number($('reportDays').value),end=$('reportEnd').value;
  if(!end||end>state.data.today){toast('Choose an available New York calendar date.',true);return}
  state.reportDays=days;state.reportEnd=end;state.selectedDay=end;
  await refresh(true);
  if(state.data?.report?.through===end&&state.data.report.days===days)toast('Daily report updated');
}
$('applyReport').addEventListener('click',applyReport);
$('reportToday').addEventListener('click',async()=>{state.reportEnd='';state.selectedDay=state.data?.today||null;await refresh();});
$('dailyLinkSearch').addEventListener('input',renderDayDetail);
$('dailyTotalsRows').addEventListener('click',e=>{const btn=e.target.closest('button[data-day]');if(!btn)return;state.selectedDay=btn.dataset.day;renderDayDetail()});
$('dailyTrafficChart').addEventListener('click',e=>{const btn=e.target.closest('button[data-day]');if(!btn)return;state.selectedDay=btn.dataset.day;renderDayDetail()});
$('downloadDailyCsv').addEventListener('click',()=>{
  const d=state.data;if(!d)return;
  const rows=[['day_et','geelark_profile','destination_url_at_redirect','redirect_assignments','url_recorded']];
  for(const day of [...d.days].reverse()){
    const details=dayEntries(day);
    if(!details.length)rows.push([day.date,'','',0,'']);
    for(const item of details)rows.push([day.date,item.id,item.attributed?item.url:'',item.redirects,item.attributed?'yes':'no']);
  }
  const filename=`geelark-daily-redirects-${d.report.from}-to-${d.report.through}.csv`;
  download(filename,rows.map(row=>row.map(csvQuote).join(',')).join('\r\n'),'text/csv;charset=utf-8');
  toast(`Downloaded ${d.report.days}-day daily redirect report`);
});
function renderActivity(){if(!state.data)return;const d=state.data;$('sumPoints').textContent=count(d.totals.points);$('sumEligible').textContent=count(d.profiles.filter(eligible).length);$('sumClaims').textContent=count(d.totals.claimCount);$('sumValue').textContent=currency(d.totals.claimCount*50);
  const graph=$('trafficChart');graph.replaceChildren();const totals=d.days.slice(0,7).map(day=>({day:day.date,total:Object.values(day.counts).reduce((a,b)=>a+Number(b),0)})).reverse();const max=Math.max(1,...totals.map(i=>i.total));for(const item of totals){const g=el('div','bar-group');const bar=el('div','bar-height');bar.style.height=`${Math.max(2,Math.round(item.total/max*120))}px`;g.append(el('span','bar-count',count(item.total)),bar,el('span','bar-label',item.day.slice(5)));graph.append(g)}
  const activity=$('activityList');activity.replaceChildren();if(!d.events.length){activity.append(el('div','empty','No recorded claims or imports yet.'));return}for(const event of d.events.slice(0,60)){const row=el('div','activity-item'),main=el('div'),description=el('span','activity-kind',event.kind==='claim'?'$50 claim recorded':event.kind==='undoClaim'?'Claim undone':event.kind==='import'?'Bulk profile import':event.kind);main.append(description,el('small',null,`${event.id?`Profile #${event.id} · `:''}${event.extra||''}`));row.append(main,el('time',null,new Date(event.at).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})));activity.append(row)}
}
// Midnight New York resets automatically because daily state is keyed by the current New York date.
// Poll only when the admin tab is visible and the operator is not editing a points field.
setInterval(()=>{if(document.visibilityState!=='visible'||state.locked||document.activeElement?.dataset?.action==='points')return;if(state.data)refresh(true)},60000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.data)refresh(true)});
})();
