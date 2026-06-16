document.addEventListener('DOMContentLoaded', () => {

  const SUPABASE_URL = "https://gbewpiujdqnqswdbrigt.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiZXdwaXVqZHFucXN3ZGJyaWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2ODExMzAsImV4cCI6MjA5NjI1NzEzMH0.VdrJCmvGZzc-_GJF6m9drxdgsdeb5a1eb9AOIRxTWYQ";
  const SB_HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates'
  };

  // ── AUDIO ──────────────────────────────────────────────
  let audioCtx = null, audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    try { audioCtx = new (window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==='suspended') audioCtx.resume(); audioUnlocked=true; } catch(e) {}
  }
  document.addEventListener('click', unlockAudio, {once:true});
  document.addEventListener('keydown', unlockAudio, {once:true});
  document.addEventListener('touchstart', unlockAudio, {once:true});

  function playAlertChime() {
    if (!audioUnlocked||!audioCtx) return;
    try {
      const osc=audioCtx.createOscillator(), gain=audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.type='sine';
      osc.frequency.setValueAtTime(587.33,audioCtx.currentTime);
      osc.frequency.setValueAtTime(880.00,audioCtx.currentTime+0.15);
      gain.gain.setValueAtTime(0.3,audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01,audioCtx.currentTime+0.4);
      osc.start(); osc.stop(audioCtx.currentTime+0.4);
    } catch(e) {}
  }

  if (Notification.permission==='default') Notification.requestPermission();

  // ── CONFIRM ────────────────────────────────────────────
  function showConfirm(title, message) {
    return new Promise(resolve => {
      const modal=document.getElementById('confirmModal');
      document.getElementById('confirmModalTitle').textContent=title;
      document.getElementById('confirmModalText').textContent=message;
      modal.style.display='flex';
      const ok=document.getElementById('confirmModalOk'), cancel=document.getElementById('confirmModalCancel');
      function cleanup(r){modal.style.display='none';ok.removeEventListener('click',onOk);cancel.removeEventListener('click',onCancel);resolve(r);}
      function onOk(){cleanup(true);} function onCancel(){cleanup(false);}
      ok.addEventListener('click',onOk); cancel.addEventListener('click',onCancel);
    });
  }

  // ── DATE HELPERS ───────────────────────────────────────
  function toDateStr(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function getToday(){return toDateStr(new Date());}
  function getSaturdayAnchor(fromDate){const d=new Date(fromDate+'T12:00:00');const day=d.getDay();const diff=day===6?0:(day+1);d.setDate(d.getDate()-diff);return toDateStr(d);}
  function getWeekDays(satStr){
    const labels=['SAT','SUN','MON','TUE','WED','THU','FRI'],keys=['sat','sun','mon','tue','wed','thu','fri'];
    const sat=new Date(satStr+'T12:00:00');
    return keys.map((key,i)=>{const d=new Date(sat);d.setDate(sat.getDate()+i);return{key,label:labels[i],date:toDateStr(d)};});
  }
  function buildWeekOptions(){
    const today=new Date(),weeks=[];
    for(let i=0;i<8;i++){const d=new Date(today);d.setDate(d.getDate()-(i*7));const sat=getSaturdayAnchor(toDateStr(d));if(!weeks.includes(sat))weeks.push(sat);}
    return weeks;
  }
  function getYesterdayStr(){const d=new Date();d.setDate(d.getDate()-1);return toDateStr(d);}
  function scopedStateId(id,weekKey=currentWeekKey){return `${weekKey}__${id}`;}
  function unscopedStateId(id,weekKey=currentWeekKey){
    const prefix=`${weekKey}__`;
    return typeof id==='string'&&id.startsWith(prefix)?id.slice(prefix.length):id;
  }
  function isScopedStateId(id,weekKey=currentWeekKey){return typeof id==='string'&&id.startsWith(`${weekKey}__`);}

  // ── STATE ──────────────────────────────────────────────
  let state={completions:{},counters:{},skipped:{},deleted:{},order:{}};
  let customTasks=[],recurringTasks=[],taskNotes={},archivedTasks=[];
  let weeklyNotes='';
  let brainDumpNotes=[],brainDumpSuggestions=[],selectedBrainDumpBrand='general',activeBrainDumpTab='capture';
  let openDrawerTaskId=null;
  let weeklyNotesSaveTimer=null;
  let editingTaskContext=null;
  const ALERTED_KEY='enigma_alerted_session_v2';
  const MISSED_DISMISSED_KEY='enigma_missed_dismissed';
  const SYNC_QUEUE_KEY='enigma_sync_queue_v3';
  const NTFY_TOPIC_KEY='enigma_ntfy_topic_v1', NTFY_ENABLED_KEY='enigma_ntfy_enabled_v1';
  let alertedTasks=(()=>{try{return JSON.parse(sessionStorage.getItem(ALERTED_KEY))||{};}catch{return{};}})();
  let ntfyTopic=localStorage.getItem(NTFY_TOPIC_KEY)||'';
  let ntfyEnabled=localStorage.getItem(NTFY_ENABLED_KEY)==='true';
  let selectedBrandFilter='all',currentLayoutView='week',activeDayTab='sat';
  let summaryLayoutVisible=false,isReadOnly=false;
  let currentWeekKey=getSaturdayAnchor(getToday()),isOnline=navigator.onLine,realtimeConnected=false;
  let missedBannerDismissed=false;
  let historyAnalytics=[];

  const todayDayObj=getWeekDays(currentWeekKey).find(d=>d.date===getToday());
  if(todayDayObj) activeDayTab=todayDayObj.key;

  // ── WEEK PICKER ────────────────────────────────────────
  function buildWeekPicker(){
    const picker=document.getElementById('weekPicker');picker.innerHTML='';
    const todayWeek=getSaturdayAnchor(getToday());
    buildWeekOptions().forEach(sat=>{
      const opt=document.createElement('option');opt.value=sat;
      const days=getWeekDays(sat);
      const f=new Date(sat+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
      const l=new Date(days[6].date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
      opt.textContent=sat===todayWeek?`This week (${f})`:`${f} – ${l}`;
      picker.appendChild(opt);
    });
    picker.value=currentWeekKey;
  }

  document.getElementById('weekPicker').addEventListener('change',async(e)=>{
    currentWeekKey=e.target.value;isReadOnly=currentWeekKey!==getSaturdayAnchor(getToday());
    state={completions:{},counters:{},skipped:{},deleted:{},order:{}};customTasks=[];taskNotes={};weeklyNotes='';brainDumpNotes=[];brainDumpSuggestions=[];openDrawerTaskId=null;
    missedBannerDismissed=false;
    closeWeeklyNotesDrawer();updateWeeklyNotesDrawer();
    showLoadingGrid();await fetchCloudState();fetchHistoryAnalytics();
  });

  // ── SYNC ───────────────────────────────────────────────
  let syncQueue=loadSyncQueue();
  let isFlushingQueue=false;
  function loadSyncQueue(){
    try{const q=JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY)||'[]');return Array.isArray(q)?q:[];}catch{return[];}
  }
  function persistSyncQueue(){
    localStorage.setItem(SYNC_QUEUE_KEY,JSON.stringify(syncQueue));
  }
  function setSyncStatus(status){
    const dot=document.getElementById('syncDot'),lbl=document.getElementById('syncLabel');
    dot.className='sync-dot '+(status==='idle'?'':status);
    const labels={pending:'Syncing…',ok:'Synced',fail:syncQueue.length?`Queued ${syncQueue.length}`:'Sync failed',idle:'Idle'};
    lbl.textContent=labels[status]||'Synced';
    if(status==='ok') setTimeout(()=>{dot.className='sync-dot';lbl.textContent='Synced';},2500);
  }
  function updateOnlineStatus(){
    isOnline=navigator.onLine;
    const banner=document.getElementById('offlineBanner');
    banner.classList.toggle('visible',!isOnline||syncQueue.length>0);
    banner.textContent=!isOnline
      ? `You are offline — ${syncQueue.length} change${syncQueue.length===1?'':'s'} saved locally`
      : (syncQueue.length?`${syncQueue.length} saved change${syncQueue.length===1?'':'s'} waiting to sync`:'');
    updateSettingsPanel();
    if(isOnline&&syncQueue.length>0&&!isFlushingQueue) flushSyncQueue();
  }
  window.addEventListener('online',updateOnlineStatus);window.addEventListener('offline',updateOnlineStatus);
  async function flushSyncQueue(){
    if(isFlushingQueue)return;
    isFlushingQueue=true;
    const queue=[...syncQueue];syncQueue=[];
    persistSyncQueue();
    for(const item of queue){try{await sendSyncPayload(item);}catch(e){syncQueue.push(item);}}
    persistSyncQueue();
    if(syncQueue.length===0) setSyncStatus('ok');
    else setSyncStatus('fail');
    isFlushingQueue=false;
    updateOnlineStatus();
  }

  // ── SUPABASE ───────────────────────────────────────────
  async function fetchCloudState(){
    setSyncStatus('pending');
    try{
      const res=await fetch(`${SUPABASE_URL}/rest/v1/tracker_state?week_key=eq.${currentWeekKey}&select=*`,{headers:SB_HEADERS});
      const data=await res.json();
      state={completions:{},counters:{},skipped:{},deleted:{},order:{}};
      customTasks=[];recurringTasks=[];taskNotes={};archivedTasks=[];weeklyNotes='';brainDumpNotes=[];brainDumpSuggestions=[];
      if(Array.isArray(data)){
        data.slice().sort((a,b)=>Number(isScopedStateId(a.id))-Number(isScopedStateId(b.id))).forEach(row=>{
          const rawId=row.id;
          const id=unscopedStateId(rawId);
          if(id===`blob_custom_tasks_${currentWeekKey}`){try{const p=JSON.parse(row.text_val);if(Array.isArray(p))customTasks=p;}catch{}return;}
          if(id==='blob_recurring_tasks'){try{const p=JSON.parse(row.text_val);if(Array.isArray(p))recurringTasks=p;}catch{}return;}
          if(id===`blob_task_notes_${currentWeekKey}`){try{const p=JSON.parse(row.text_val);if(p&&typeof p==='object'&&!Array.isArray(p))taskNotes=p;}catch{}return;}
          if(id===`blob_weekly_notes_${currentWeekKey}`){weeklyNotes=row.text_val||'';return;}
          if(id===`blob_brain_dump_notes_${currentWeekKey}`){try{const p=JSON.parse(row.text_val);if(Array.isArray(p))brainDumpNotes=p;}catch{}return;}
          if(id===`blob_archived_tasks_${currentWeekKey}`){try{const p=JSON.parse(row.text_val);if(Array.isArray(p))archivedTasks=p;}catch{}return;}
          if(id.startsWith('skip_day_')){state.skipped[id.replace('skip_day_','')]=Boolean(row.is_done);return;}
          if(id.startsWith('deleted_')){state.deleted[id.replace('deleted_','')]=Boolean(row.is_done);return;}
          if(id.startsWith('order_')){try{state.order[id.replace('order_','')]=JSON.parse(row.text_val);}catch{}return;}
          if(row.counter_val!==null&&row.counter_val!==undefined){state.counters[id]=Number(row.counter_val);}
          else{state.completions[id]=Boolean(row.is_done);}
        });
      }
      const recRes=await fetch(`${SUPABASE_URL}/rest/v1/tracker_state?id=eq.blob_recurring_tasks&select=*`,{headers:SB_HEADERS});
      const recData=await recRes.json();
      if(Array.isArray(recData)&&recData.length>0&&recData[0].text_val){try{const p=JSON.parse(recData[0].text_val);if(Array.isArray(p))recurringTasks=p;}catch{}}
      setSyncStatus('ok');
    }catch(e){console.error('Cloud pull error:',e);setSyncStatus('fail');}
    finally{updateWeeklyNotesDrawer();executeRenderCycles();}
  }

  async function fetchHistoryAnalytics(){
    const weeks=buildWeekOptions();
    try{
      const query=weeks.map(w=>`"${w}"`).join(',');
      const res=await fetch(`${SUPABASE_URL}/rest/v1/tracker_state?week_key=in.(${query})&select=*`,{headers:SB_HEADERS});
      const rows=await res.json();
      if(!Array.isArray(rows))return;
      historyAnalytics=weeks.map(weekKey=>summarizeWeekRows(weekKey,rows.filter(r=>r.week_key===weekKey))).filter(Boolean);
      if(summaryLayoutVisible)renderSummary();
    }catch(e){console.warn('History analytics unavailable:',e);}
  }

  async function syncRow(payload){
    if(payload.week_key!=='global') payload.week_key=currentWeekKey;
    if(!isOnline){syncQueue.push(payload);persistSyncQueue();setSyncStatus('fail');updateOnlineStatus();return;}
    setSyncStatus('pending');
    try{await sendSyncPayload(payload);setSyncStatus('ok');}
    catch(e){syncQueue.push(payload);persistSyncQueue();setSyncStatus('fail');updateOnlineStatus();}
  }

  async function sendSyncPayload(payload){
    const res=await fetch(`${SUPABASE_URL}/rest/v1/tracker_state`,{method:'POST',headers:SB_HEADERS,body:JSON.stringify(payload)});
    if(!res.ok)throw new Error('sync failed');
  }

  async function syncCompletion(id,val){await syncRow({id:scopedStateId(id),is_done:Boolean(val),counter_val:null,updated_at:new Date().toISOString()});}
  async function syncCounter(id,val){await syncRow({id:scopedStateId(id),is_done:false,counter_val:Number(val),updated_at:new Date().toISOString()});}
  async function syncSkip(dayKey,val){await syncRow({id:scopedStateId(`skip_day_${dayKey}`),is_done:Boolean(val),counter_val:null,updated_at:new Date().toISOString()});}
  async function syncDeleted(id){await syncRow({id:scopedStateId(`deleted_${id}`),is_done:true,counter_val:null,updated_at:new Date().toISOString()});}
  async function syncCustomTasks(){await syncRow({id:`blob_custom_tasks_${currentWeekKey}`,is_done:false,counter_val:null,text_val:JSON.stringify(customTasks),updated_at:new Date().toISOString()});}
  async function syncRecurringTasks(){await syncRow({id:'blob_recurring_tasks',week_key:'global',is_done:false,counter_val:null,text_val:JSON.stringify(recurringTasks),updated_at:new Date().toISOString()});}
  async function syncNotes(){await syncRow({id:`blob_task_notes_${currentWeekKey}`,is_done:false,counter_val:null,text_val:JSON.stringify(taskNotes),updated_at:new Date().toISOString()});}
  async function syncWeeklyNotes(){await syncRow({id:`blob_weekly_notes_${currentWeekKey}`,is_done:false,counter_val:null,text_val:weeklyNotes,updated_at:new Date().toISOString()});}
  async function syncBrainDumpNotes(){await syncRow({id:`blob_brain_dump_notes_${currentWeekKey}`,is_done:false,counter_val:null,text_val:JSON.stringify(brainDumpNotes),updated_at:new Date().toISOString()});}
  async function syncArchivedTasks(){await syncRow({id:`blob_archived_tasks_${currentWeekKey}`,is_done:false,counter_val:null,text_val:JSON.stringify(archivedTasks),updated_at:new Date().toISOString()});}
  async function syncOrder(dayKey){await syncRow({id:scopedStateId(`order_${dayKey}`),is_done:false,counter_val:null,text_val:JSON.stringify(state.order[dayKey]||[]),updated_at:new Date().toISOString()});}
  async function clearCurrentWeekCloud(){setSyncStatus('pending');try{await fetch(`${SUPABASE_URL}/rest/v1/tracker_state?week_key=eq.${currentWeekKey}`,{method:'DELETE',headers:SB_HEADERS});setSyncStatus('ok');}catch(e){setSyncStatus('fail');}}

  function updateWeeklyNotesDrawer(){
    const title=document.getElementById('weeklyNotesTitle');
    const input=document.getElementById('weeklyNotesInput');
    const status=document.getElementById('weeklyNotesStatus');
    if(!input)return;
    const days=getWeekDays(currentWeekKey);
    const start=new Date(currentWeekKey+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
    const end=new Date(days[6].date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
    title.textContent=`${start} - ${end}`;
    input.value=weeklyNotes;
    input.disabled=isReadOnly;
    document.getElementById('saveBrainDumpBtn').disabled=isReadOnly;
    document.getElementById('extractTasksBtn').disabled=isReadOnly;
    status.textContent=isReadOnly?'Past week notes are read-only.':'Auto-saves with this week.';
    setBrainDumpTab(activeBrainDumpTab);
  }

  function openWeeklyNotesDrawer(){
    updateWeeklyNotesDrawer();
    document.getElementById('weeklyNotesOverlay').classList.add('visible');
    document.getElementById('weeklyNotesHandle').classList.add('hidden');
    const drawer=document.getElementById('weeklyNotesDrawer');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden','false');
    if(!isReadOnly)setTimeout(()=>document.getElementById('weeklyNotesInput').focus(),80);
  }

  function closeWeeklyNotesDrawer(){
    const overlay=document.getElementById('weeklyNotesOverlay');
    const drawer=document.getElementById('weeklyNotesDrawer');
    if(overlay)overlay.classList.remove('visible');
    const handle=document.getElementById('weeklyNotesHandle');
    if(handle)handle.classList.remove('hidden');
    if(drawer){drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');}
  }

  function queueWeeklyNotesSave(){
    const status=document.getElementById('weeklyNotesStatus');
    if(status)status.textContent='Saving...';
    clearTimeout(weeklyNotesSaveTimer);
    weeklyNotesSaveTimer=setTimeout(async()=>{
      await syncWeeklyNotes();
      const nextStatus=document.getElementById('weeklyNotesStatus');
      if(nextStatus)nextStatus.textContent='Saved with this week.';
    },450);
  }

  function setBrainDumpTab(tab){
    activeBrainDumpTab=tab;
    document.querySelectorAll('.notes-drawer-tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.notesTab===tab));
    document.getElementById('notesCapturePanel').style.display=tab==='capture'?'flex':'none';
    document.getElementById('notesSavedPanel').style.display=tab==='saved'?'block':'none';
    if(tab==='saved')renderBrainDumpNotes();
  }

  function renderBrainDumpNotes(){
    const list=document.getElementById('brainDumpNotesList');
    if(!list)return;
    list.innerHTML='';
    if(!brainDumpNotes.length){
      const empty=document.createElement('div');empty.className='notes-empty';empty.textContent='No saved notes yet.';
      list.appendChild(empty);return;
    }
    brainDumpNotes.forEach(note=>{
      const row=document.createElement('div');row.className='brain-note-entry';
      const head=document.createElement('div');head.className='brain-note-head';
      const meta=document.createElement('div');meta.className='brain-note-meta';
      const brand=document.createElement('span');brand.className=`brain-note-brand brand-${note.brand||'general'}`;brand.textContent=note.brand==='general'?'General':(BRAND_LABELS[note.brand]||note.brand);
      const time=document.createElement('span');time.className='brain-note-time';time.textContent=new Date(note.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
      meta.appendChild(brand);meta.appendChild(time);
      const del=document.createElement('button');del.type='button';del.className='brain-note-delete';del.textContent='x';
      del.disabled=isReadOnly;
      del.title=isReadOnly?'Past week notes are read-only.':'Delete note';
      del.addEventListener('click',async()=>{if(isReadOnly)return;brainDumpNotes=brainDumpNotes.filter(n=>n.id!==note.id);await syncBrainDumpNotes();renderBrainDumpNotes();});
      head.appendChild(meta);head.appendChild(del);
      const text=document.createElement('div');text.className='brain-note-text';text.textContent=note.text;
      row.appendChild(head);row.appendChild(text);list.appendChild(row);
    });
  }

  function inferBrainDumpBrand(text){
    const t=text.toLowerCase();
    if(selectedBrainDumpBrand!=='general')return selectedBrainDumpBrand;
    if(/\b(cp|career ?paddy|course|blog|meta|ally|admin portal)\b/.test(t))return'cp';
    if(/\b(tratun|debbie|oil|gas)\b/.test(t))return'tratun';
    if(/\b(studio|photoshop|design brand)\b/.test(t))return'studio';
    if(/\b(pray|scripture|faith|youtube|instagram)\b/.test(t))return'pray';
    if(/\b(meet|meeting|call|interview|appointment)\b/.test(t))return'meet';
    if(/\b(school|assignment|test|exam|unilesa|lecture)\b/.test(t))return'school';
    return'cp';
  }

  function inferBrainDumpDay(text){
    const t=text.toLowerCase();
    const days={sat:['sat','saturday'],sun:['sun','sunday'],mon:['mon','monday'],tue:['tue','tuesday'],wed:['wed','wednesday'],thu:['thu','thursday'],fri:['fri','friday']};
    for(const [key,words] of Object.entries(days)){if(words.some(w=>t.includes(w)))return key;}
    if(t.includes('tomorrow')){
      const keys=['sun','mon','tue','wed','thu','fri','sat'];
      return keys[new Date().getDay()];
    }
    if(t.includes('today')){
      const today=getWeekDays(currentWeekKey).find(d=>d.date===getToday());
      return today?.key||activeDayTab;
    }
    return activeDayTab;
  }

  function inferBrainDumpTime(text){
    const match=text.match(/\b(before\s+\d{1,2}(:\d{2})?\s*(am|pm)?|\d{1,2}(:\d{2})?\s*(am|pm)|morning|afternoon|evening|night|anytime)\b/i);
    return match?match[0]:'Anytime';
  }

  function cleanBrainDumpTitle(text){
    return text
      .replace(/\b(today|tomorrow|on\s+(sat|sun|mon|tue|wed|thu|fri)(urday|day|sday|nesday|rsday)?|before\s+\d{1,2}(:\d{2})?\s*(am|pm)?|\d{1,2}(:\d{2})?\s*(am|pm))\b/ig,'')
      .replace(/^(i need to|need to|remember to|please|also|and|then|todo:?|task:?)/i,'')
      .replace(/\s+/g,' ')
      .trim();
  }

  function extractBrainDumpTasks(){
    const text=document.getElementById('weeklyNotesInput').value.trim();
    if(!text){setWeeklyNotesStatus('Write something first.');return;}
    const chunks=text.split(/\n|;|\.|,(?=\s*(and\s+)?(write|create|send|call|meet|post|upload|edit|finish|start|rework|design|cook|wash|read|study|submit|record|brainstorm)\b)/i)
      .map(s=>s.trim()).filter(s=>s&&s.length>2);
    const actionWords=/\b(write|create|send|call|meet|post|upload|edit|finish|start|rework|design|cook|wash|read|study|submit|record|brainstorm|prepare|review|draft|publish|dance|interview)\b/i;
    const seen=new Set();
    brainDumpSuggestions=chunks
      .filter(chunk=>actionWords.test(chunk)||chunks.length===1)
      .map(chunk=>{
        const title=cleanBrainDumpTitle(chunk).slice(0,90)||chunk.slice(0,90);
        const key=title.toLowerCase();
        if(seen.has(key))return null;
        seen.add(key);
        const hasTime=/\b(before\s+\d{1,2}|\d{1,2}(:\d{2})?\s*(am|pm)|meeting|call|interview|appointment)\b/i.test(chunk);
        return{id:'suggest_'+Date.now()+'_'+seen.size,title,brand:inferBrainDumpBrand(chunk),day:inferBrainDumpDay(chunk),time:inferBrainDumpTime(chunk),taskType:hasTime?'time-anchored':'production'};
      }).filter(Boolean).slice(0,8);
    renderBrainDumpSuggestions();
    setWeeklyNotesStatus(brainDumpSuggestions.length?`${brainDumpSuggestions.length} task${brainDumpSuggestions.length===1?'':'s'} extracted.`:'No clear tasks found. Try writing action words like create, send, call, finish.');
  }

  function setWeeklyNotesStatus(message){
    const status=document.getElementById('weeklyNotesStatus');
    if(status)status.textContent=message;
  }

  function renderBrainDumpSuggestions(){
    const area=document.getElementById('notesSuggestionsArea');
    if(!area)return;
    area.innerHTML='';
    if(!brainDumpSuggestions.length)return;
    const panel=document.createElement('div');panel.className='notes-suggestions-panel';
    const head=document.createElement('div');head.className='notes-suggestions-head';head.textContent=`${brainDumpSuggestions.length} extracted task${brainDumpSuggestions.length===1?'':'s'} - review and push`;
    panel.appendChild(head);
    brainDumpSuggestions.forEach(s=>{
      const card=document.createElement('div');card.className='notes-suggestion-card';
      const title=document.createElement('div');title.className='notes-suggestion-title';title.textContent=s.title;
      const meta=document.createElement('div');meta.className='notes-suggestion-meta';
      const daySelect=document.createElement('select');daySelect.className='notes-suggestion-select';
      getWeekDays(currentWeekKey).forEach(d=>{const opt=document.createElement('option');opt.value=d.key;opt.textContent=d.label;opt.selected=d.key===s.day;daySelect.appendChild(opt);});
      const brandSelect=document.createElement('select');brandSelect.className='notes-suggestion-select';
      Object.keys(BRAND_LABELS).forEach(key=>{const opt=document.createElement('option');opt.value=key;opt.textContent=BRAND_LABELS[key];opt.selected=key===s.brand;brandSelect.appendChild(opt);});
      const timeInput=document.createElement('input');timeInput.className='notes-suggestion-input';timeInput.value=s.time||'Anytime';timeInput.placeholder='Time';
      meta.appendChild(daySelect);meta.appendChild(brandSelect);meta.appendChild(timeInput);
      const actions=document.createElement('div');actions.className='notes-suggestion-actions';
      const push=document.createElement('button');push.type='button';push.className='notes-push-btn';push.textContent='Push to Tracker';
      push.addEventListener('click',async()=>{
        const task={id:'custom_'+Date.now(),dayKey:daySelect.value,brand:brandSelect.value,text:s.title,time:timeInput.value.trim()||'Anytime',oneTime:false,recurring:false,taskType:s.taskType||'production'};
        customTasks.push(task);await syncCustomTasks();
        brainDumpSuggestions=brainDumpSuggestions.filter(item=>item.id!==s.id);
        pushUndo(`Added "${task.text.substring(0,30)}"`,async()=>{customTasks=customTasks.filter(t=>t.id!==task.id);await syncCustomTasks();executeRenderCycles();});
        renderBrainDumpSuggestions();executeRenderCycles();setWeeklyNotesStatus(`Pushed "${task.text}" to tracker.`);
      });
      const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='notes-dismiss-btn';dismiss.textContent='Dismiss';
      dismiss.addEventListener('click',()=>{brainDumpSuggestions=brainDumpSuggestions.filter(item=>item.id!==s.id);renderBrainDumpSuggestions();});
      actions.appendChild(push);actions.appendChild(dismiss);
      card.appendChild(title);card.appendChild(meta);card.appendChild(actions);panel.appendChild(card);
    });
    area.appendChild(panel);
  }

  async function saveBrainDumpNote(){
    const input=document.getElementById('weeklyNotesInput');
    const text=input.value.trim();
    if(!text){setWeeklyNotesStatus('Nothing to save.');return;}
    brainDumpNotes=[{id:'note_'+Date.now(),brand:selectedBrainDumpBrand,text,createdAt:new Date().toISOString()},...brainDumpNotes];
    weeklyNotes='';
    input.value='';
    brainDumpSuggestions=[];
    document.getElementById('notesSuggestionsArea').innerHTML='';
    await syncBrainDumpNotes();await syncWeeklyNotes();
    setWeeklyNotesStatus('Note saved.');
  }

  function findEditableTask(taskId){
    const customIndex=customTasks.findIndex(t=>t.id===taskId);
    if(customIndex>=0)return{source:'custom',index:customIndex,task:customTasks[customIndex]};
    const recurringIndex=recurringTasks.findIndex(t=>t.id===taskId);
    if(recurringIndex>=0)return{source:'recurring',index:recurringIndex,task:recurringTasks[recurringIndex]};
    return{source:'template',index:-1,task:null};
  }

  function buildTaskFromModal(existingId){
    const isRecurring=document.getElementById('modRecurring').checked;
    return{
      id:existingId||'custom_'+Date.now(),
      dayKey:document.getElementById('modDay').value,
      brand:document.getElementById('modBrand').value,
      text:document.getElementById('modText').value.trim(),
      time:document.getElementById('modTime').value.trim()||'Anytime',
      oneTime:false,
      recurring:isRecurring,
      taskType:document.getElementById('modType').value,
      alertPriority:document.getElementById('modAlertPriority').value
    };
  }

  function openTaskModal(mode,task=null){
    editingTaskContext=mode==='edit'&&task?{id:task.id,original:{...task}}:null;
    const daySelect=document.getElementById('modDay');daySelect.innerHTML='';
    getWeekDays(currentWeekKey).forEach(d=>{daySelect.innerHTML+=`<option value="${d.key}">${d.label}</option>`;});
    document.getElementById('taskModalTitle').textContent=mode==='edit'?'EDIT TASK':'INJECT CUSTOM TASK';
    document.getElementById('modText').value=task?.text||'';
    document.getElementById('modTime').value=task?.time||'';
    document.getElementById('modRecurring').checked=!!task?.recurring;
    document.getElementById('modBrand').value=task?.brand||'cp';
    document.getElementById('modType').value=task?.taskType||'production';
    document.getElementById('modAlertPriority').value=task?.alertPriority||'auto';
    daySelect.value=task?.dayKey||activeDayTab;
    document.getElementById('taskModal').style.display='flex';
  }

  async function saveTaskFromModal(){
    const txt=document.getElementById('modText').value.trim();
    if(!txt){await showConfirm('MISSING INPUT','Task description cannot be empty.');return false;}
    const nextTask=buildTaskFromModal(editingTaskContext?.id);
    const wantsRecurring=nextTask.recurring;
    if(!editingTaskContext){
      if(wantsRecurring){recurringTasks.push(nextTask);await syncRecurringTasks();}
      else{customTasks.push(nextTask);await syncCustomTasks();}
      pushUndo(`Added "${nextTask.text.substring(0,30)}"`,async()=>{
        customTasks=customTasks.filter(t=>t.id!==nextTask.id);
        recurringTasks=recurringTasks.filter(t=>t.id!==nextTask.id);
        await syncCustomTasks();await syncRecurringTasks();
      });
      return true;
    }
    const originalId=editingTaskContext.id;
    const found=findEditableTask(editingTaskContext.id);
    const previousCustom=[...customTasks],previousRecurring=[...recurringTasks],previousDeleted={...state.deleted};
    const targetSource=wantsRecurring?'recurring':'custom';
    if(found.source==='custom')customTasks=customTasks.filter(t=>t.id!==editingTaskContext.id);
    if(found.source==='recurring')recurringTasks=recurringTasks.filter(t=>t.id!==editingTaskContext.id);
    if(found.source==='template'){
      state.deleted[editingTaskContext.id]=true;
      await syncDeleted(editingTaskContext.id);
      nextTask.id='custom_'+Date.now();
    }
    if(targetSource==='recurring')recurringTasks.push(nextTask);
    else customTasks.push(nextTask);
    await syncCustomTasks();await syncRecurringTasks();
    pushUndo(`Edited "${nextTask.text.substring(0,30)}"`,async()=>{
      customTasks=previousCustom;recurringTasks=previousRecurring;state.deleted=previousDeleted;
      await syncCustomTasks();await syncRecurringTasks();
      if(found.source==='template')await syncRow({id:scopedStateId(`deleted_${originalId}`),is_done:false,counter_val:null,updated_at:new Date().toISOString()});
    });
    return true;
  }

  async function duplicateTask(task,dayKey){
    const copy={...task,id:'custom_'+Date.now(),dayKey:task.dayKey||dayKey,oneTime:false,recurring:false};
    customTasks.push(copy);await syncCustomTasks();
    pushUndo(`Duplicated "${task.text.substring(0,30)}"`,async()=>{customTasks=customTasks.filter(t=>t.id!==copy.id);await syncCustomTasks();});
    executeRenderCycles();
  }

  async function archiveTask(task){
    const confirmed=await showConfirm('ARCHIVE TASK','Hide this task from the current tracker?');
    if(!confirmed)return;
    const taskCopy={...task};const found=findEditableTask(task.id);
    const archiveEntry={...taskCopy,archivedAt:new Date().toISOString(),source:found.source};
    if(found.source==='custom')customTasks=customTasks.filter(t=>t.id!==task.id);
    if(found.source==='recurring')recurringTasks=recurringTasks.filter(t=>t.id!==task.id);
    state.deleted[task.id]=true;
    archivedTasks=[archiveEntry,...archivedTasks.filter(t=>t.id!==task.id)];
    await syncCustomTasks();await syncRecurringTasks();await syncArchivedTasks();await syncDeleted(task.id);
    pushUndo(`Archived "${task.text.substring(0,30)}"`,async()=>{
      state.deleted[task.id]=false;
      if(found.source==='custom')customTasks.push(taskCopy);
      if(found.source==='recurring')recurringTasks.push(taskCopy);
      archivedTasks=archivedTasks.filter(t=>t.id!==task.id);
      await syncCustomTasks();await syncRecurringTasks();await syncArchivedTasks();
      await syncRow({id:scopedStateId(`deleted_${task.id}`),is_done:false,counter_val:null,updated_at:new Date().toISOString()});
    });
    executeRenderCycles();
  }

  async function restoreArchivedTask(taskId){
    const archived=archivedTasks.find(t=>t.id===taskId);
    if(!archived)return;
    const restored={...archived};
    delete restored.archivedAt;delete restored.source;
    archivedTasks=archivedTasks.filter(t=>t.id!==taskId);
    state.deleted[taskId]=false;
    if(archived.source==='recurring'||restored.recurring)recurringTasks.push(restored);
    else if(archived.source==='custom'||restored.dayKey)customTasks.push(restored);
    await syncArchivedTasks();await syncCustomTasks();await syncRecurringTasks();
    await syncRow({id:scopedStateId(`deleted_${taskId}`),is_done:false,counter_val:null,updated_at:new Date().toISOString()});
    pushUndo(`Restored "${restored.text.substring(0,30)}"`,async()=>{
      customTasks=customTasks.filter(t=>t.id!==taskId);
      recurringTasks=recurringTasks.filter(t=>t.id!==taskId);
      state.deleted[taskId]=true;
      archivedTasks=[archived,...archivedTasks.filter(t=>t.id!==taskId)];
      await syncArchivedTasks();await syncCustomTasks();await syncRecurringTasks();await syncDeleted(taskId);
      renderArchiveBin();
    });
    executeRenderCycles();renderArchiveBin();
  }

  async function deleteArchivedTaskForever(taskId){
    const archived=archivedTasks.find(t=>t.id===taskId);
    if(!archived)return;
    const confirmed=await showConfirm('DELETE FOREVER','Permanently remove this archived task from the archive bin?');
    if(!confirmed)return;
    archivedTasks=archivedTasks.filter(t=>t.id!==taskId);
    await syncArchivedTasks();
    pushUndo(`Deleted archived "${archived.text.substring(0,30)}"`,async()=>{archivedTasks=[archived,...archivedTasks];await syncArchivedTasks();renderArchiveBin();});
    renderArchiveBin();
  }

  function renderArchiveBin(){
    const list=document.getElementById('archiveList');
    if(!list)return;
    list.innerHTML='';
    if(!archivedTasks.length){
      const empty=document.createElement('div');empty.className='archive-empty';empty.textContent='No archived tasks yet.';
      list.appendChild(empty);return;
    }
    archivedTasks.forEach(task=>{
      const row=document.createElement('div');row.className='archive-row';
      const info=document.createElement('div');
      const title=document.createElement('div');title.className='archive-title';title.textContent=task.text||'Untitled task';
      const meta=document.createElement('div');meta.className='archive-meta';
      const brand=BRAND_LABELS[task.brand]||task.brand||'Task';
      meta.textContent=`${brand} · ${task.dayKey||'week'} · ${task.time||'Anytime'}`;
      info.appendChild(title);info.appendChild(meta);
      const actions=document.createElement('div');actions.className='archive-actions';
      const restore=document.createElement('button');restore.type='button';restore.className='task-action-btn';restore.textContent='Restore';
      restore.addEventListener('click',async()=>restoreArchivedTask(task.id));
      const del=document.createElement('button');del.type='button';del.className='task-action-btn danger';del.textContent='Delete';
      del.addEventListener('click',async()=>deleteArchivedTaskForever(task.id));
      actions.appendChild(restore);actions.appendChild(del);
      row.appendChild(info);row.appendChild(actions);list.appendChild(row);
    });
  }

  // ── REALTIME ───────────────────────────────────────────
  function initRealtime(){
    try{
      const wsUrl=SUPABASE_URL.replace('https://','wss://')+'/realtime/v1/websocket?apikey='+SUPABASE_KEY+'&vsn=1.0.0';
      const ws=new WebSocket(wsUrl);let heartbeatTimer=null;
      ws.onopen=()=>{ws.send(JSON.stringify({topic:'realtime:public:tracker_state',event:'phx_join',payload:{},ref:'1'}));heartbeatTimer=setInterval(()=>{ws.send(JSON.stringify({topic:'phoenix',event:'heartbeat',payload:{},ref:'2'}));},30000);};
      ws.onmessage=(event)=>{try{const msg=JSON.parse(event.data);if(msg.event==='phx_reply'&&msg.payload?.status==='ok'){realtimeConnected=true;updateRealtimeBadge(true);}if(['INSERT','UPDATE','DELETE'].includes(msg.event)){const row=msg.payload?.record||msg.payload?.old_record;if(row&&(row.week_key===currentWeekKey||row.id==='blob_recurring_tasks')){clearTimeout(ws._refetchTimer);ws._refetchTimer=setTimeout(()=>fetchCloudState(),400);}}}catch(e){};};
      ws.onerror=()=>{realtimeConnected=false;updateRealtimeBadge(false);};
      ws.onclose=()=>{realtimeConnected=false;updateRealtimeBadge(false);clearInterval(heartbeatTimer);setTimeout(initRealtime,5000);};
    }catch(e){console.warn('Realtime init failed:',e);}
  }
  function updateRealtimeBadge(connected){
    const slot=document.getElementById('realtimeBadgeSlot');
    slot.innerHTML=connected?`<div class="realtime-badge"><div class="realtime-dot"></div>Live</div>`:'';
  }

  // ── FOCUS SYNC ─────────────────────────────────────────
  let lastFocusTime=Date.now();
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'){const now=Date.now();if(now-lastFocusTime>30000){buildWeekPicker();fetchCloudState();}lastFocusTime=now;}
    else{lastFocusTime=Date.now();}
  });

  // ── UNDO ───────────────────────────────────────────────
  const undoStack=[];let undoTimer=null;
  function pushUndo(description,undoFn){
    undoStack.push({description,undoFn});if(undoStack.length>30)undoStack.shift();
    const toast=document.getElementById('undoToast');
    document.getElementById('undoToastMsg').textContent=description;
    toast.classList.add('visible');clearTimeout(undoTimer);
    undoTimer=setTimeout(()=>toast.classList.remove('visible'),4000);
  }
  document.getElementById('undoBtnEl').addEventListener('click',async()=>{if(!undoStack.length)return;const{undoFn}=undoStack.pop();document.getElementById('undoToast').classList.remove('visible');await undoFn();executeRenderCycles();});
  document.addEventListener('keydown',async(e)=>{if((e.metaKey||e.ctrlKey)&&e.key==='z'&&undoStack.length){e.preventDefault();const{undoFn}=undoStack.pop();document.getElementById('undoToast').classList.remove('visible');await undoFn();executeRenderCycles();}});

  // ── BASE SCHEDULE ──────────────────────────────────────
  const BASE_SCHEDULE_TEMPLATES={
    sat:[
      {id:'sat_pray',brand:'pray',text:'Upload 6 videos — YT + Instagram',time:'11am',oneTime:true,taskType:'production'},
      {id:'sat_studio',brand:'studio',text:'1 Photoshop design',time:'1pm',taskType:'production'},
      {id:'sat_reupload',brand:'cp',text:'Reupload courses — Admin Portal',time:'Anytime',isCounter:true,taskType:'production'},
    ],
    sun:[
      {id:'sun_blog',brand:'cp',text:'Write Blog post',time:'Night',taskType:'production'},
      {id:'sun_watermark',brand:'cp',text:'Create Watermarked Course video',time:'Night',taskType:'production'},
      {id:'sun_reupload',brand:'cp',text:'Reupload courses — Admin Portal',time:'Anytime',isCounter:true,taskType:'production'},
    ],
    mon:[
      {id:'mon_blog',brand:'cp',text:'Post Blog — Meta',time:'9am',taskType:'time-anchored'},
      {id:'mon_yt',brand:'cp',text:'Post Course — YouTube',time:'12pm',taskType:'time-anchored'},
      {id:'mon_wm',brand:'cp',text:'Post Watermarked video — Meta',time:'12pm',taskType:'time-anchored'},
      {id:'mon_reupload',brand:'cp',text:'Reupload courses — Admin Portal',time:'Before 6pm',isCounter:true,taskType:'production'},
      {id:'mon_meet',brand:'meet',text:'CP Meeting',time:'6pm',taskType:'time-anchored'},
      {id:'mon_tratun',brand:'tratun',text:'Start design prep',time:'10:30pm',taskType:'production'},
    ],
    tue:[
      {id:'tue_debbie',brand:'tratun',text:'Design thoughts — Mrs. Debbie',time:'Before 12pm',taskType:'production'},
      {id:'tue_design',brand:'tratun',text:'Finish design',time:'Before 12pm',taskType:'production'},
      {id:'tue_meet',brand:'tratun',text:'Tratun Meeting',time:'4pm',taskType:'time-anchored'},
      {id:'tue_video',brand:'cp',text:'Create Highlight / CP Ally video',time:'10pm',taskType:'production'},
      {id:'tue_reupload',brand:'cp',text:'Reupload courses — Admin Portal',time:'Anytime',isCounter:true,taskType:'production'},
    ],
    wed:[
      {id:'wed_post',brand:'cp',text:'Post Highlight / CP Ally video',time:'9am',taskType:'time-anchored'},
      {id:'wed_create',brand:'cp',text:'Create Course video',time:'12pm+',taskType:'production'},
      {id:'wed_reupload',brand:'cp',text:'Reupload courses — Admin Portal',time:'Anytime',isCounter:true,taskType:'production'},
      {id:'wed_meet',brand:'meet',text:'Design Team Meeting',time:'4pm',taskType:'time-anchored'},
    ],
    thu:[
      {id:'thu_create',brand:'pray',text:'Create 3 Pray.Scr videos',time:'Anytime',taskType:'production'},
      {id:'thu_upload',brand:'pray',text:'Upload 2 videos — YT + Instagram',time:'Night',taskType:'production'},
      {id:'thu_reupload',brand:'cp',text:'Reupload courses — Admin Portal',time:'Anytime',isCounter:true,taskType:'production'},
    ],
    fri:[
      {id:'fri_wm',brand:'cp',text:'Create + Post Watermarked Course — Meta',time:'Before 12pm',taskType:'production'},
      {id:'fri_reels',brand:'cp',text:'Create and Post Reels',time:'Before 12pm',taskType:'production'},
      {id:'fri_reupload',brand:'cp',text:'Reupload courses — Admin Portal',time:'Anytime',isCounter:true,taskType:'production'},
      {id:'fri_meet',brand:'meet',text:'CP Meeting',time:'6pm',taskType:'time-anchored'},
    ]
  };

  const BRAND_LABELS={cp:'CareerPaddy',tratun:'Tratun',studio:'Enigma Studio',pray:'Praying Scripture',meet:'Meetings',school:'School'};
  const COUNTER_MAX=10;

  // ── SCHEDULE BUILD ─────────────────────────────────────
  function buildSchedule(){
    return getWeekDays(currentWeekKey).map(day=>{
      const base=BASE_SCHEDULE_TEMPLATES[day.key]||[];
      const custom=[...customTasks,...recurringTasks].filter(t=>t.dayKey===day.key);
      return{...day,tasks:[...base,...custom]};
    });
  }

  function getComputedDayTasks(day,scheduleContext){
    if(state.skipped[day.key]) return[];
    const currentIdx=scheduleContext.findIndex(d=>d.key===day.key);
    let combined=[...day.tasks].filter(t=>!state.deleted[t.id]);
    const savedOrder=state.order[day.key];
    if(savedOrder&&savedOrder.length>0){
      const ordered=[];savedOrder.forEach(id=>{const t=combined.find(x=>x.id===id);if(t)ordered.push(t);});
      combined.forEach(t=>{if(!ordered.includes(t))ordered.push(t);});combined=ordered;
    }
    const todayStr=getToday();
    for(let i=0;i<currentIdx;i++){
      const prior=scheduleContext[i];
      if(prior.date>=todayStr) continue;
      if(state.skipped[prior.key]) continue;
      prior.tasks.forEach(t=>{
        if(state.deleted[t.id])return;
        if(t.oneTime===true)return;
        if(t.isCounter)return;
        if(t.taskType!=='production')return;
        if(!state.completions[t.id]){if(!combined.some(ex=>ex.id===t.id))combined.push({...t,isCarriedForward:true});}
      });
    }
    return combined;
  }

  // ── TIME PARSING ───────────────────────────────────────
  function parseTimeString(t){
    if(!t) return null;
    let s=t.toLowerCase().replace(/\s+/g,'');
    const pm=s.includes('pm'),am=s.includes('am');
    if(!pm&&!am) return null;
    s=s.replace('pm','').replace('am','').replace(/[^0-9:]/g,'');
    if(!s) return null;
    let h=0,m=0;
    if(s.includes(':')){ [h,m]=s.split(':').map(Number);}else{h=parseInt(s,10);}
    if(isNaN(h)||isNaN(m)) return null;
    if(pm&&h<12) h+=12;
    if(am&&h===12) h=0;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }

  function getOffsetAlarmTime(baseTime,offsetMin){
    const parsed=parseTimeString(baseTime);if(!parsed)return null;
    let[h,m]=parsed.split(':').map(Number);let total=h*60+m-offsetMin;
    if(total<0)total+=1440;
    return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
  }

  function taskHasMeetingAlert(task){
    const text=`${task.text||''} ${task.time||''}`.toLowerCase();
    return /\b(meeting|meet|call|interview|appointment|session|consultation|briefing)\b/.test(text);
  }

  function getTaskAlertPriority(task){
    if(taskHasMeetingAlert(task))return'meeting';
    const priority=task.alertPriority||'auto';
    if(priority==='none'||priority==='low'||priority==='high')return priority;
    if(!parseTimeString(task.time))return'none';
    return task.taskType==='time-anchored'?'low':'none';
  }

  function getTaskAlertSchedule(task){
    const priority=getTaskAlertPriority(task);
    const parsed=parseTimeString(task.time);
    if(!parsed||priority==='none')return[];
    if(priority==='meeting')return[30,20,10,0];
    if(priority==='high')return[90,60,30,0];
    if(priority==='low')return[0];
    return[];
  }

  function formatAlertLead(offset){
    if(offset===0)return'now';
    if(offset===10)return'in 10m';
    if(offset===20)return'in 20m';
    if(offset===30)return'in 30m';
    if(offset===60)return'in 1h';
    if(offset===90)return'in 1h 30m';
    return`in ${offset}m`;
  }

  async function sendNtfyAlert(title,message,priority){
    if(!ntfyEnabled||!ntfyTopic.trim()||!navigator.onLine)return;
    const cleanTopic=ntfyTopic.trim().replace(/^https?:\/\/ntfy\.sh\//i,'').replace(/[^a-zA-Z0-9_-]/g,'');
    if(!cleanTopic)return;
    try{
      await fetch(`https://ntfy.sh/${encodeURIComponent(cleanTopic)}`,{
        method:'POST',
        headers:{
          'Title':title,
          'Priority':priority==='high'||priority==='meeting'?'high':'default',
          'Tags':priority==='meeting'?'calendar_clock':(priority==='high'?'warning':'bell')
        },
        body:message
      });
    }catch(e){console.warn('ntfy alert failed:',e);}
  }

  function getCurrentTimeStr(){const now=new Date();return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;}

  // ── CLOCK & ALARM ──────────────────────────────────────
  function runClockTick(){
    setInterval(()=>{
      const now=new Date();
      document.getElementById('liveClockDisplay').textContent=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    },1000);
  }

  function runAlarmDaemon(){
    setInterval(()=>{
      const todayStr=getToday();
      if(currentWeekKey!==getSaturdayAnchor(todayStr)) return;
      const curTime=getCurrentTimeStr();
      const fs=buildSchedule();
      const todayDay=fs.find(d=>d.date===todayStr);
      if(!todayDay||state.skipped[todayDay.key]) return;
      getComputedDayTasks(todayDay,fs).forEach(task=>{
        if(task.isCounter||state.completions[task.id]) return;
        const priority=getTaskAlertPriority(task);
        getTaskAlertSchedule(task).forEach(offset=>{
          const target=getOffsetAlarmTime(task.time,offset);
          const alarmKey=`${task.id}_${todayStr}_${offset}_${target}`;
          if(!target||target!==curTime||alertedTasks[alarmKey]) return;
          alertedTasks[alarmKey]=true;sessionStorage.setItem(ALERTED_KEY,JSON.stringify(alertedTasks));
          const label=priority==='meeting'?'MEETING ALERT':priority==='high'?'HIGH PRIORITY':'TASK ALERT';
          const msg=`${label} ${formatAlertLead(offset)}: ${task.text} (${task.time})`;
          playAlertChime();
          if(Notification.permission==='granted') new Notification('ENIGMA - Alert',{body:msg});
          sendNtfyAlert(label,msg,priority);
        });
      });
    },30000);
  }

  // ── METRICS ────────────────────────────────────────────
  function getDayMetrics(day,fullSchedule){
    if(state.skipped[day.key]) return{total:0,done:0,percentage:0,isSkipped:true};
    const tasks=getComputedDayTasks(day,fullSchedule);
    if(!tasks.length) return{total:0,done:0,percentage:0};
    let done=0;
    tasks.forEach(t=>{if(t.isCounter){if((state.counters[t.id]||0)>0)done++;}else{if(state.completions[t.id])done++;}});
    return{total:tasks.length,done,percentage:Math.round((done/tasks.length)*100)};
  }

  function dayCompletion(day,fs){
    const m=getDayMetrics(day,fs);
    if(m.isSkipped) return'skipped';if(!m.total) return'empty';
    return m.done===0?'empty':(m.done===m.total?'done':'partial');
  }

  // ── STREAK COUNT ───────────────────────────────────────
  function getStreakCount(fs){
    const today=getToday();
    // Walk backwards from yesterday, count consecutive days with partial or full completion
    const pastDays=[...fs].filter(d=>d.date<today).reverse();
    let streak=0;
    for(const day of pastDays){
      const st=dayCompletion(day,fs);
      if(st==='done'||st==='partial'||st==='skipped'){streak++;}
      else break;
    }
    return streak;
  }

  // ── MISSED TASKS YESTERDAY ─────────────────────────────
  function getMissedYesterdayCount(){
    if(currentWeekKey!==getSaturdayAnchor(getToday())) return 0;
    const yesterdayStr=getYesterdayStr();
    const fs=buildSchedule();
    const yesterdayDay=fs.find(d=>d.date===yesterdayStr);
    if(!yesterdayDay||state.skipped[yesterdayDay.key]) return 0;
    const tasks=getComputedDayTasks(yesterdayDay,fs);
    return tasks.filter(t=>{
      if(t.isCounter) return false;
      return !state.completions[t.id];
    }).length;
  }

  function renderMissedBanner(){
    const banner=document.getElementById('missedBanner');
    const chip=document.getElementById('missedChipSlot');
    if(missedBannerDismissed||isReadOnly){banner.classList.remove('visible');chip.innerHTML='';return;}
    const missed=getMissedYesterdayCount();
    if(missed===0){banner.classList.remove('visible');chip.innerHTML='';return;}
    const txt=`You missed ${missed} task${missed>1?'s':''} yesterday`;
    document.getElementById('missedBannerText').textContent=txt;
    banner.classList.add('visible');
    chip.innerHTML=`<div class="missed-chip" id="missedChipEl"><div class="missed-chip-dot"></div><span>${missed} missed yesterday</span></div>`;
    document.getElementById('missedChipEl')?.addEventListener('click',()=>{
      banner.scrollIntoView({behavior:'smooth'});
    });
  }

  document.getElementById('missedBannerDismiss').addEventListener('click',()=>{
    missedBannerDismissed=true;
    document.getElementById('missedBanner').classList.remove('visible');
    document.getElementById('missedChipSlot').innerHTML='';
  });

  // ── NEXT UP ────────────────────────────────────────────
  function renderNextUp(){
    const slot=document.getElementById('nextUpSlot');if(!slot)return;
    const today=getToday();
    if(currentWeekKey!==getSaturdayAnchor(today)){slot.innerHTML='';return;}
    const fs=buildSchedule();
    const todayDay=fs.find(d=>d.date===today);
    if(!todayDay||state.skipped[todayDay.key]){slot.innerHTML='';return;}
    const curTime=getCurrentTimeStr();
    const next=getComputedDayTasks(todayDay,fs)
      .filter(t=>{if(t.isCounter||state.completions[t.id])return false;const p=parseTimeString(t.time);return p&&p>=curTime;})
      .sort((a,b)=>{const at=parseTimeString(a.time)||'99:99',bt=parseTimeString(b.time)||'99:99';return at.localeCompare(bt);})[0]||null;
    if(!next){slot.innerHTML='';return;}
    const brandColor=`var(--${next.brand})`;
    const shortText=next.text.length>26?next.text.substring(0,26)+'…':next.text;
    slot.innerHTML=`<div class="next-up-chip">
      <div class="next-up-dot" style="background:${brandColor}"></div>
      <span class="next-up-label">Next</span>
      <span class="next-up-time" style="color:${brandColor}">${next.time}</span>
      <span class="next-up-text">${shortText}</span>
    </div>`;
  }

  // ── LOADING ────────────────────────────────────────────
  function showLoadingGrid(){
    const grid=document.getElementById('weekGrid');grid.style.display='grid';
    grid.innerHTML=`<div class="grid-loading" style="grid-column:1/-1"><div class="grid-loading-bar"><div class="grid-loading-fill"></div></div><div class="grid-loading-text">Loading from cloud…</div></div>`;
    document.getElementById('summaryViewPane').style.display='none';
  }

  // ── STREAK RENDER ──────────────────────────────────────
  function renderStreak(){
    const el=document.getElementById('streakDots');el.innerHTML='';
    const today=getToday();const fs=buildSchedule();
    fs.forEach(day=>{
      const dot=document.createElement('div');dot.className='s-dot';
      const circle=document.createElement('div');circle.className='s-circle';
      const label=document.createElement('div');label.className='s-day-label';label.textContent=day.label;
      if(day.date===today){circle.classList.add('is-today');}
      else{const st=dayCompletion(day,fs);if(st==='done')circle.classList.add('done');if(st==='partial')circle.classList.add('partial');if(st==='skipped')circle.classList.add('skipped');}
      dot.appendChild(circle);dot.appendChild(label);el.appendChild(dot);
    });
    document.getElementById('streakCount').textContent=getStreakCount(fs);
  }

  function updateTodayCount(){
    const today=getToday();const fs=buildSchedule();
    const dayData=fs.find(d=>d.date===today);
    const el=document.getElementById('todayCount');
    if(!dayData){el.textContent='—';return;}
    if(state.skipped[dayData.key]){el.textContent='SKIP';return;}
    const m=getDayMetrics(dayData,fs);el.textContent=`${m.done}/${m.total}`;
  }

  function calculateVelocity(){
    const fs=buildSchedule();let total=0,done=0;
    fs.forEach(day=>{if(state.skipped[day.key])return;getComputedDayTasks(day,fs).forEach(t=>{total++;if(t.isCounter){if((state.counters[t.id]||0)>0)done++;}else{if(state.completions[t.id])done++;}});});
    document.getElementById('velocityFill').style.width=`${total>0?(done/total)*100:0}%`;
  }

  function renderTabsRow(){
    const row=document.getElementById('dayTabsRow');
    if(currentLayoutView==='week'||summaryLayoutVisible){row.style.display='none';return;}
    row.style.display='flex';row.innerHTML='';
    getWeekDays(currentWeekKey).forEach(d=>{
      const btn=document.createElement('button');btn.className='tab-btn'+(activeDayTab===d.key?' active':'');
      btn.textContent=`${d.label} (${new Date(d.date+'T12:00:00').getDate()})`;
      btn.addEventListener('click',()=>{activeDayTab=d.key;renderTabsRow();renderGrid();});
      row.appendChild(btn);
    });
  }

  function getWeekInsights(fs){
    const today=getToday();
    let total=0,done=0,carry=0,overdue=0,todayRemaining=0,nextFocus='Clear the planned queue';
    const now=getCurrentTimeStr();
    fs.forEach(day=>{
      if(state.skipped[day.key])return;
      const tasks=getComputedDayTasks(day,fs);
      tasks.forEach(t=>{
        total++;
        const taskDone=t.isCounter?(state.counters[t.id]||0)>0:!!state.completions[t.id];
        if(taskDone)done++;
        if(t.isCarriedForward&&!taskDone)carry++;
        if(day.date===today&&!taskDone){
          todayRemaining++;
          const parsed=parseTimeString(t.time);
          if(parsed&&parsed<now)overdue++;
        }
      });
    });
    const todayDay=fs.find(d=>d.date===today);
    if(todayDay&&!state.skipped[todayDay.key]){
      const upcoming=getComputedDayTasks(todayDay,fs)
        .filter(t=>!t.isCounter&&!state.completions[t.id])
        .map(t=>({...t,parsed:parseTimeString(t.time)}))
        .filter(t=>t.parsed&&t.parsed>=now)
        .sort((a,b)=>a.parsed.localeCompare(b.parsed))[0];
      if(upcoming)nextFocus=upcoming.text;
    }
    return{total,done,percent:total?Math.round((done/total)*100):0,carry,overdue,todayRemaining,nextFocus};
  }

  function renderBriefTile(anchor,label,value,note,tone){
    const tile=document.createElement('div');
    tile.className='brief-tile'+(tone?` ${tone}`:'');
    const l=document.createElement('div');l.className='brief-tile-label';l.textContent=label;
    const v=document.createElement('div');v.className='brief-tile-value';v.textContent=value;
    const n=document.createElement('div');n.className='brief-tile-note';n.textContent=note;
    tile.appendChild(l);tile.appendChild(v);tile.appendChild(n);anchor.appendChild(tile);
  }

  function renderCommandBrief(fs){
    const insights=getWeekInsights(fs);
    const anchor=document.getElementById('briefGrid');
    if(!anchor)return;
    anchor.innerHTML='';
    document.getElementById('briefSubtitle').textContent=insights.nextFocus;
    renderBriefTile(anchor,'Week Health',`${insights.percent}%`,`${insights.done}/${insights.total} tracked items complete`,insights.percent>=70?'good':(insights.percent<35?'warning':'attention'));
    renderBriefTile(anchor,'Today Left',insights.todayRemaining,insights.todayRemaining===0?'Today is clear':'Still active today',insights.todayRemaining===0?'good':'attention');
    renderBriefTile(anchor,'Overdue',insights.overdue,insights.overdue===0?'No timed tasks overdue':'Timed tasks need attention',insights.overdue>0?'warning':'good');
    renderBriefTile(anchor,'Carry Load',insights.carry,insights.carry===0?'No production backlog':'Unfinished production carried forward',insights.carry>2?'warning':(insights.carry>0?'attention':'good'));
  }

  function summarizeWeekRows(weekKey,rows){
    const completions={},counters={},skipped={},deleted={};
    let weekCustomTasks=[];
    rows.slice().sort((a,b)=>Number(isScopedStateId(a.id,weekKey))-Number(isScopedStateId(b.id,weekKey))).forEach(row=>{
      const id=unscopedStateId(row.id,weekKey);
      if(!id)return;
      if(id===`blob_custom_tasks_${weekKey}`){try{const p=JSON.parse(row.text_val);if(Array.isArray(p))weekCustomTasks=p;}catch{}return;}
      if(id.startsWith('skip_day_')){skipped[id.replace('skip_day_','')]=Boolean(row.is_done);return;}
      if(id.startsWith('deleted_')){deleted[id.replace('deleted_','')]=Boolean(row.is_done);return;}
      if(id.startsWith('blob_')||id.startsWith('order_'))return;
      if(row.counter_val!==null&&row.counter_val!==undefined)counters[id]=Number(row.counter_val);
      else completions[id]=Boolean(row.is_done);
    });
    const prev={completions:state.completions,counters:state.counters,skipped:state.skipped,deleted:state.deleted,customTasks};
    state.completions=completions;state.counters=counters;state.skipped=skipped;state.deleted=deleted;
    customTasks=weekCustomTasks;
    const oldWeek=currentWeekKey;currentWeekKey=weekKey;
    const fs=buildSchedule();
    let total=0,done=0,reuploads=0;
    fs.forEach(day=>{
      if(state.skipped[day.key])return;
      getComputedDayTasks(day,fs).forEach(t=>{
        if(t.isCounter){reuploads+=(state.counters[t.id]||0);total++;if((state.counters[t.id]||0)>0)done++;}
        else{total++;if(state.completions[t.id])done++;}
      });
    });
    currentWeekKey=oldWeek;
    state.completions=prev.completions;state.counters=prev.counters;state.skipped=prev.skipped;state.deleted=prev.deleted;
    customTasks=prev.customTasks;
    return{weekKey,total,done,percent:total?Math.round((done/total)*100):0,reuploads};
  }

  function getAnalytics(fs,diag){
    const dayStats=fs.map(day=>{
      const metrics=getDayMetrics(day,fs);
      const open=Math.max(metrics.total-metrics.done,0);
      return{...day,...metrics,open,skipped:!!state.skipped[day.key]};
    });
    const activeDays=dayStats.filter(d=>!d.skipped&&d.total>0);
    const best=activeDays.slice().sort((a,b)=>b.percentage-a.percentage||b.done-a.done)[0]||null;
    const weak=activeDays.slice().sort((a,b)=>a.percentage-b.percentage||b.open-a.open)[0]||null;
    const brandEntries=Object.entries(diag).filter(([,m])=>m.total>0).map(([brand,m])=>({brand,...m,missed:m.total-m.done,pct:Math.round((m.done/m.total)*100)}));
    const missedBrand=brandEntries.sort((a,b)=>b.missed-a.missed||a.pct-b.pct)[0]||null;
    let carryCount=0,recurringOpen=0;
    fs.forEach(day=>getComputedDayTasks(day,fs).forEach(t=>{
      const done=t.isCounter?(state.counters[t.id]||0)>0:!!state.completions[t.id];
      if(t.isCarriedForward&&!done)carryCount++;
      if(t.recurring&&!done)recurringOpen++;
    }));
    return{dayStats,best,weak,missedBrand,carryCount,recurringOpen};
  }

  function renderAnalyticsTile(anchor,label,value,note,tone){
    const tile=document.createElement('div');tile.className='analytics-tile'+(tone?` ${tone}`:'');
    const l=document.createElement('div');l.className='analytics-label';l.textContent=label;
    const v=document.createElement('div');v.className='analytics-value';v.textContent=value;
    const n=document.createElement('div');n.className='analytics-note';n.textContent=note;
    tile.appendChild(l);tile.appendChild(v);tile.appendChild(n);anchor.appendChild(tile);
  }

  function renderAnalytics(fs,diag){
    const analytics=getAnalytics(fs,diag);
    const grid=document.getElementById('analyticsGrid');
    const days=document.getElementById('dayAnalyticsAnchor');
    if(!grid||!days)return;
    grid.innerHTML='';days.innerHTML='';
    renderAnalyticsTile(grid,'Best Day',analytics.best?analytics.best.label:'-',analytics.best?`${analytics.best.percentage}% complete`:'No active day yet',analytics.best&&analytics.best.percentage>=80?'good':'attention');
    renderAnalyticsTile(grid,'Weak Spot',analytics.weak?analytics.weak.label:'-',analytics.weak?`${analytics.weak.open} open item${analytics.weak.open===1?'':'s'}`:'No weak spot yet',analytics.weak&&analytics.weak.open>0?'warning':'good');
    renderAnalyticsTile(grid,'Missed Brand',analytics.missedBrand?BRAND_LABELS[analytics.missedBrand.brand]:'-',analytics.missedBrand?`${analytics.missedBrand.missed} open / ${analytics.missedBrand.total} total`:'All brands clear','attention');
    renderAnalyticsTile(grid,'Carry Backlog',analytics.carryCount,analytics.carryCount?'Production tasks rolled forward':'No carry-forward load',analytics.carryCount>0?'warning':'good');
    renderAnalyticsTile(grid,'Recurring Open',analytics.recurringOpen,analytics.recurringOpen?'Repeating tasks still open':'Recurring tasks clear',analytics.recurringOpen>0?'attention':'good');
    const latest=historyAnalytics[0];
    renderAnalyticsTile(grid,'Week Score',latest?`${latest.percent}%`:'Live',latest?`${latest.done}/${latest.total} saved items in current week`:'Updates after cloud history loads',latest&&latest.percent>=70?'good':'attention');
    analytics.dayStats.forEach(day=>{
      const row=document.createElement('div');row.className='day-analytics-row';
      row.innerHTML=`<div class="day-analytics-name">${day.label}</div><div class="day-analytics-track"><div class="day-analytics-fill" style="width:${day.percentage}%"></div></div><div class="day-analytics-meta">${day.done}/${day.total}</div>`;
      days.appendChild(row);
    });
  }

  function renderHistoryStrip(doneAll,totalAll,pctAll){
    const histAnchor=document.getElementById('weekHistoryAnchor');histAnchor.innerHTML='';
    const current={weekKey:currentWeekKey,total:totalAll,done:doneAll,percent:pctAll,reuploads:0};
    const merged=[current,...historyAnalytics.filter(w=>w.weekKey!==currentWeekKey)].slice(0,8);
    if(!merged.length){histAnchor.innerHTML='<div class="history-note">History will appear after cloud sync loads.</div>';return;}
    const strip=document.createElement('div');strip.className='history-strip';
    merged.forEach(w=>{
      const f=new Date(w.weekKey+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
      const row=document.createElement('div');row.className='history-row';
      row.innerHTML=`<div class="history-week-label">${f}</div><div class="history-track"><div class="history-fill" style="width:${w.percent}%"></div></div><div class="history-percent">${w.percent}%</div>`;
      strip.appendChild(row);
    });
    histAnchor.appendChild(strip);
  }

  function getReportData(){
    const fs=buildSchedule();
    const weekDays=getWeekDays(currentWeekKey);
    const start=new Date(weekDays[0].date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
    const end=new Date(weekDays[6].date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    const diag={cp:{total:0,done:0},tratun:{total:0,done:0},studio:{total:0,done:0},pray:{total:0,done:0},meet:{total:0,done:0},school:{total:0,done:0}};
    const rows=[];let reuploads=0,carryOpen=0,overdue=0;
    const now=getCurrentTimeStr(),today=getToday();
    fs.forEach(day=>{
      const tasks=getComputedDayTasks(day,fs);
      tasks.forEach(task=>{
        const done=task.isCounter?(state.counters[task.id]||0)>0:!!state.completions[task.id];
        if(task.isCounter)reuploads+=(state.counters[task.id]||0);
        if(task.isCarriedForward&&!done)carryOpen++;
        if(day.date===today&&!done&&parseTimeString(task.time)&&parseTimeString(task.time)<now)overdue++;
        if(!task.isCounter&&diag[task.brand]){diag[task.brand].total++;if(done)diag[task.brand].done++;}
        rows.push({
          day:day.label,date:day.date,brand:BRAND_LABELS[task.brand]||task.brand||'Task',
          text:task.text,time:task.time||'Anytime',status:done?'Done':'Open',
          type:task.taskType||'task',tags:[task.recurring?'Recurring':'',task.oneTime?'One-time':'',task.isCarriedForward?'Carry':''].filter(Boolean).join(' ')
        });
      });
    });
    const total=rows.length,done=rows.filter(r=>r.status==='Done').length;
    return{range:`${start} - ${end}`,weekKey:currentWeekKey,rows,diag,total,done,pct:total?Math.round((done/total)*100):0,reuploads,carryOpen,overdue,archivedCount:archivedTasks.length};
  }

  function csvEscape(v){
    const s=String(v??'');
    return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
  }

  function downloadWeeklyReportCsv(){
    const report=getReportData();
    const summary=[
      ['Week',report.range],['Completion',`${report.done}/${report.total}`],['Completion %',`${report.pct}%`],
      ['Reuploads',report.reuploads],['Carry Open',report.carryOpen],['Overdue',report.overdue],['Archived',report.archivedCount],[]
    ];
    const taskHeader=['Day','Date','Brand','Task','Time','Status','Type','Tags'];
    const taskRows=report.rows.map(r=>[r.day,r.date,r.brand,r.text,r.time,r.status,r.type,r.tags]);
    const lines=[...summary,taskHeader,...taskRows].map(row=>row.map(csvEscape).join(',')).join('\n');
    const blob=new Blob([lines],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=`enigma-weekly-report-${report.weekKey}.csv`;
    document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  }

  function printWeeklyReport(){
    const report=getReportData();
    const brandRows=Object.entries(report.diag).map(([brand,m])=>`<tr><td>${BRAND_LABELS[brand]}</td><td>${m.done}/${m.total}</td><td>${m.total?Math.round((m.done/m.total)*100):0}%</td></tr>`).join('');
    const taskRows=report.rows.map(r=>`<tr><td>${r.day}</td><td>${r.brand}</td><td>${r.text}</td><td>${r.time}</td><td>${r.status}</td><td>${r.tags}</td></tr>`).join('');
    const html=`<!doctype html><html><head><title>ENIGMA Weekly Report</title><style>
      body{font-family:Arial,sans-serif;color:#17131b;margin:32px;line-height:1.4}h1{margin:0 0 4px}h2{margin-top:28px}
      .meta{color:#666;margin-bottom:20px}.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}
      .tile{border:1px solid #ddd;padding:12px;border-radius:8px}.value{font-size:28px;font-weight:800}
      table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}th{background:#f4f1f6}
      @media print{body{margin:18mm}.no-print{display:none}.tiles{grid-template-columns:repeat(4,1fr)}}
    </style></head><body>
      <button class="no-print" onclick="window.print()">Print / Save PDF</button>
      <h1>ENIGMA Weekly Report</h1><div class="meta">${report.range}</div>
      <div class="tiles">
        <div class="tile"><div>Completion</div><div class="value">${report.pct}%</div><div>${report.done}/${report.total} tasks</div></div>
        <div class="tile"><div>Reuploads</div><div class="value">${report.reuploads}</div></div>
        <div class="tile"><div>Carry Open</div><div class="value">${report.carryOpen}</div></div>
        <div class="tile"><div>Archived</div><div class="value">${report.archivedCount}</div></div>
      </div>
      <h2>Brand Breakdown</h2><table><thead><tr><th>Brand</th><th>Done</th><th>Completion</th></tr></thead><tbody>${brandRows}</tbody></table>
      <h2>Tasks</h2><table><thead><tr><th>Day</th><th>Brand</th><th>Task</th><th>Time</th><th>Status</th><th>Tags</th></tr></thead><tbody>${taskRows}</tbody></table>
    </body></html>`;
    const win=window.open('','_blank');
    if(!win){showConfirm('POPUP BLOCKED','Allow popups for this site to open the printable report.');return;}
    win.document.write(html);win.document.close();win.focus();
  }

  function renderSummary(){
    const anchor=document.getElementById('brandMetricsAnchor');anchor.innerHTML='';
    const fs=buildSchedule();let reuploadSum=0;
    const diag={cp:{total:0,done:0},tratun:{total:0,done:0},studio:{total:0,done:0},pray:{total:0,done:0},meet:{total:0,done:0},school:{total:0,done:0}};
    fs.forEach(day=>{getComputedDayTasks(day,fs).forEach(t=>{if(t.isCounter){reuploadSum+=(state.counters[t.id]||0);}else if(diag[t.brand]){diag[t.brand].total++;if(state.completions[t.id])diag[t.brand].done++;}});});
    renderCommandBrief(fs);
    Object.keys(diag).forEach(bk=>{
      const m=diag[bk],pct=m.total>0?Math.round((m.done/m.total)*100):0;
      const row=document.createElement('div');row.className='brand-row-metric';
      row.innerHTML=`<div class="brand-row-meta"><div class="brand-label-text"><div style="width:6px;height:6px;border-radius:50%;background:var(--${bk});box-shadow:0 0 5px var(--${bk})"></div>${BRAND_LABELS[bk]}</div><div style="color:var(--muted)">${m.done}/${m.total} (${pct}%)</div></div><div class="brand-bar-track"><div class="brand-bar-fill" style="width:${pct}%;background:var(--${bk})"></div></div>`;
      anchor.appendChild(row);
    });
    document.getElementById('reuploadRunningCount').textContent=reuploadSum;
    const totalAll=Object.values(diag).reduce((a,b)=>a+b.total,0);
    const doneAll=Object.values(diag).reduce((a,b)=>a+b.done,0);
    const pctAll=totalAll>0?Math.round((doneAll/totalAll)*100):0;
    renderAnalytics(fs,diag);
    renderHistoryStrip(doneAll,totalAll,pctAll);
  }

  // ── DRAG & DROP ────────────────────────────────────────
  let dragSrcId=null,dragDayKey=null;
  function makeDraggable(item,taskId,dayKey){
    if(isReadOnly) return;
    item.draggable=true;
    item.addEventListener('dragstart',(e)=>{dragSrcId=taskId;dragDayKey=dayKey;e.dataTransfer.effectAllowed='move';setTimeout(()=>item.classList.add('drag-over'),0);});
    item.addEventListener('dragend',()=>item.classList.remove('drag-over'));
    item.addEventListener('dragover',(e)=>{e.preventDefault();item.classList.add('drag-over');});
    item.addEventListener('dragleave',()=>item.classList.remove('drag-over'));
    item.addEventListener('drop',async(e)=>{
      e.preventDefault();item.classList.remove('drag-over');
      if(!dragSrcId||dragSrcId===taskId||dragDayKey!==dayKey) return;
      const fs=buildSchedule();const dayData=fs.find(d=>d.key===dayKey);
      const tasks=getComputedDayTasks(dayData,fs);const ids=tasks.map(t=>t.id);
      const srcIdx=ids.indexOf(dragSrcId),dstIdx=ids.indexOf(taskId);
      if(srcIdx<0||dstIdx<0) return;
      ids.splice(srcIdx,1);ids.splice(dstIdx,0,dragSrcId);
      state.order[dayKey]=ids;await syncOrder(dayKey);executeRenderCycles();
    });
  }

  // ── MAIN RENDER ────────────────────────────────────────
  function renderGrid(){
    const grid=document.getElementById('weekGrid');
    const summaryPane=document.getElementById('summaryViewPane');
    const today=getToday();const fs=buildSchedule();
    const curTime=getCurrentTimeStr();

    if(summaryLayoutVisible){grid.style.display='none';summaryPane.style.display='flex';renderSummary();return;}
    grid.style.display='grid';summaryPane.style.display='none';grid.innerHTML='';

    const weekDays=getWeekDays(currentWeekKey);
    const f=new Date(weekDays[0].date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
    const l=new Date(weekDays[6].date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    document.getElementById('weekRangeDisplay').innerHTML=`${f} – ${l} &nbsp;·&nbsp; ENIGMA${isReadOnly?' &nbsp;<span style="color:var(--action-pink);font-size:10px;letter-spacing:2px">READ-ONLY</span>':''}`;

    let displaySchedule=[...fs];
    if(currentLayoutView==='day'){grid.className='week-grid single-mode';displaySchedule=displaySchedule.filter(d=>d.key===activeDayTab);document.body.classList.add('day-view');}
    else{grid.className='week-grid';document.body.classList.remove('day-view');}

    displaySchedule.forEach(day=>{
      const isSkipped=state.skipped[day.key];
      const isToday=day.date===today;
      const col=document.createElement('div');
      col.className='day-col'+(isToday?' is-today':'')+(isSkipped?' skipped-state':'');

      // Head
      const head=document.createElement('div');head.className='day-head';
      const headMeta=document.createElement('div');headMeta.className='day-head-meta';
      const nameEl=document.createElement('div');nameEl.className='day-name';nameEl.textContent=day.label;
      const dayControls=document.createElement('div');dayControls.className='day-controls';
      const metrics=getDayMetrics(day,fs);
      const badge=document.createElement('div');badge.className='day-completion-badge';
      badge.textContent=isSkipped?'SKIPPED':(metrics.total>0?`${metrics.percentage}%`:'0%');
      dayControls.appendChild(badge);
      if(!isReadOnly){
        const skipLink=document.createElement('a');skipLink.className='skip-toggle-link';skipLink.textContent=isSkipped?'[Track]':'[Skip]';
        skipLink.addEventListener('click',async(e)=>{e.stopPropagation();const prev=!!state.skipped[day.key];state.skipped[day.key]=!prev;await syncSkip(day.key,state.skipped[day.key]);pushUndo(`${prev?'Resumed':'Skipped'} ${day.label}`,async()=>{state.skipped[day.key]=prev;await syncSkip(day.key,prev);});executeRenderCycles();});
        dayControls.appendChild(skipLink);
      }
      headMeta.appendChild(nameEl);headMeta.appendChild(dayControls);
      const dateEl=document.createElement('div');dateEl.className='day-date';
      dateEl.textContent=new Date(day.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'2-digit'});
      head.appendChild(headMeta);head.appendChild(dateEl);
      const dayTasksForPulse=getComputedDayTasks(day,fs);
      const openCount=dayTasksForPulse.filter(t=>t.isCounter?((state.counters[t.id]||0)<=0):!state.completions[t.id]).length;
      const overdueCount=isToday?dayTasksForPulse.filter(t=>!t.isCounter&&!state.completions[t.id]&&parseTimeString(t.time)&&parseTimeString(t.time)<curTime).length:0;
      const pulse=document.createElement('div');
      pulse.className='day-pulse'+(overdueCount?' warning':(openCount===0?' clear':''));
      const pulseDot=document.createElement('div');pulseDot.className='day-pulse-dot';
      const pulseText=document.createElement('span');
      pulseText.textContent=isSkipped?'Paused':(overdueCount?`${overdueCount} overdue · ${openCount} open`:(openCount===0?'Clear':`${openCount} open`));
      pulse.appendChild(pulseDot);pulse.appendChild(pulseText);head.appendChild(pulse);col.appendChild(head);

      // Tasks
      const tasksEl=document.createElement('div');tasksEl.className='day-tasks';
      if(isSkipped){
        const msg=document.createElement('div');msg.className='skipped-msg';msg.textContent='Day Allocation Skipped';tasksEl.appendChild(msg);
      }else{
        const computedTasks=getComputedDayTasks(day,fs).filter(t=>selectedBrandFilter==='all'||t.brand===selectedBrandFilter);
        if(!computedTasks.length){
          const emptyMsg=document.createElement('div');emptyMsg.className='empty-day-msg';emptyMsg.textContent='No tasks scheduled';tasksEl.appendChild(emptyMsg);
        }else{
          computedTasks.forEach(task=>{
            if(task.isCounter){
              const widget=document.createElement('div');widget.className='counter-widget';
              const cHead=document.createElement('div');cHead.className='counter-head';cHead.innerHTML=`Reupload <span>Admin</span>`;
              const cTime=document.createElement('div');cTime.className='counter-time';cTime.textContent=task.time;
              const stepper=document.createElement('div');stepper.className='counter-stepper';
              const curr=typeof state.counters[task.id]==='number'?state.counters[task.id]:0;
              const minusBtn=document.createElement('button');minusBtn.className='c-step-btn';minusBtn.textContent='−';
              const display=document.createElement('div');display.className='c-count-display';display.textContent=curr;
              const plusBtn=document.createElement('button');plusBtn.className='c-step-btn';plusBtn.textContent='+';
              if(!isReadOnly){
                minusBtn.addEventListener('click',async()=>{const prev=state.counters[task.id]||0;if(prev<=0)return;state.counters[task.id]=prev-1;display.textContent=state.counters[task.id];plusBtn.disabled=false;minusBtn.disabled=state.counters[task.id]<=0;await syncCounter(task.id,state.counters[task.id]);pushUndo('Reupload count −1',async()=>{state.counters[task.id]=prev;await syncCounter(task.id,prev);executeRenderCycles();});updateTodayCount();calculateVelocity();});
                plusBtn.addEventListener('click',async()=>{const prev=state.counters[task.id]||0;if(prev>=COUNTER_MAX)return;state.counters[task.id]=prev+1;display.textContent=state.counters[task.id];minusBtn.disabled=false;plusBtn.disabled=state.counters[task.id]>=COUNTER_MAX;await syncCounter(task.id,state.counters[task.id]);pushUndo('Reupload count +1',async()=>{state.counters[task.id]=prev;await syncCounter(task.id,prev);executeRenderCycles();});updateTodayCount();calculateVelocity();});
                minusBtn.disabled=curr<=0;plusBtn.disabled=curr>=COUNTER_MAX;
              }else{minusBtn.disabled=true;plusBtn.disabled=true;}
              stepper.appendChild(minusBtn);stepper.appendChild(display);stepper.appendChild(plusBtn);
              widget.appendChild(cHead);widget.appendChild(cTime);widget.appendChild(stepper);tasksEl.appendChild(widget);
            }else{
              const item=document.createElement('div');
              item.className=`task-item brand-${task.brand}${state.completions[task.id]?' done':''}${task.isCarriedForward?' carry-forward-derived':''}`;

              // Overdue glow — today only, uncompleted, specific time already passed
              if(isToday&&!state.completions[task.id]){
                const parsed=parseTimeString(task.time);
                if(parsed&&parsed<curTime) item.classList.add('overdue');
              }

              const row=document.createElement('div');row.className='task-row';
              const taskLeft=document.createElement('div');taskLeft.className='task-left';
              const pip=document.createElement('div');pip.className='brand-pip';
              const check=document.createElement('div');check.className='task-check';
              check.innerHTML=`<svg class="chk-svg" viewBox="0 0 8 6" fill="none"><path d="M1 3L3 5L7 1" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
              const content=document.createElement('div');content.className='task-content';
              const text=document.createElement('div');text.className='task-text';text.textContent=task.text;
              const metaRow=document.createElement('div');metaRow.className='task-meta-row';
              const time=document.createElement('div');time.className='task-time';time.textContent=task.time;
              metaRow.appendChild(time);
              const badges=document.createElement('div');badges.className='task-badges';
              if(task.isCarriedForward){const t=document.createElement('div');t.className='carry-tag';t.textContent='Carry';badges.appendChild(t);}
              if(task.oneTime===true){const t=document.createElement('div');t.className='one-time-tag';t.textContent='One-time';badges.appendChild(t);}
              if(task.recurring===true){const t=document.createElement('div');t.className='recurring-tag';t.textContent='Recurring';badges.appendChild(t);}
              const alertPriority=getTaskAlertPriority(task);
              if(alertPriority==='meeting'||alertPriority==='high'||alertPriority==='low'){
                const t=document.createElement('div');t.className=`alert-tag ${alertPriority}`;t.textContent=alertPriority==='meeting'?'Meeting Alert':(alertPriority==='high'?'High Alert':'Low Alert');badges.appendChild(t);
              }
              metaRow.appendChild(badges);content.appendChild(text);content.appendChild(metaRow);
              const drawer=document.createElement('div');drawer.className='task-notes-drawer';
              const notesInput=document.createElement('textarea');notesInput.className='task-notes-field';
              notesInput.placeholder='Add contextual logging notes…';notesInput.value=taskNotes[task.id]||'';notesInput.disabled=isReadOnly;
              if(openDrawerTaskId===task.id) drawer.classList.add('open');
              notesInput.addEventListener('click',e=>e.stopPropagation());
              notesInput.addEventListener('input',async(e)=>{if(isReadOnly)return;taskNotes[task.id]=e.target.value;await syncNotes();});
              drawer.appendChild(notesInput);content.appendChild(drawer);
              taskLeft.appendChild(pip);taskLeft.appendChild(check);taskLeft.appendChild(content);
              row.appendChild(taskLeft);
              if(!isReadOnly){
                const actions=document.createElement('div');actions.className='task-actions';
                const editBtn=document.createElement('button');editBtn.type='button';editBtn.className='task-action-btn';editBtn.textContent='Edit';editBtn.title='Edit task';
                editBtn.addEventListener('click',(e)=>{e.stopPropagation();openTaskModal('edit',task);});
                const copyBtn=document.createElement('button');copyBtn.type='button';copyBtn.className='task-action-btn';copyBtn.textContent='Copy';copyBtn.title='Duplicate task';
                copyBtn.addEventListener('click',async(e)=>{e.stopPropagation();await duplicateTask(task,day.key);});
                const archiveBtn=document.createElement('button');archiveBtn.type='button';archiveBtn.className='task-action-btn danger';archiveBtn.textContent='Archive';archiveBtn.title='Archive task';
                archiveBtn.addEventListener('click',async(e)=>{e.stopPropagation();await archiveTask(task);});
                actions.appendChild(editBtn);actions.appendChild(copyBtn);actions.appendChild(archiveBtn);
                row.appendChild(actions);
              }
              item.appendChild(row);makeDraggable(item,task.id,day.key);
              if(!isReadOnly){
                item.addEventListener('click',async(e)=>{
                  if(e.target===notesInput||e.target.closest('.task-actions'))return;
                  if(drawer.classList.contains('open')&&e.target.closest('.task-notes-drawer'))return;
                  const isCheckClick=e.target.closest('.task-check')||e.target.closest('.brand-pip')||e.target.closest('.task-text');
                  if(isCheckClick||state.completions[task.id]){
                    const prev=!!state.completions[task.id];state.completions[task.id]=!prev;
                    item.className=`task-item brand-${task.brand}${state.completions[task.id]?' done':''}${task.isCarriedForward?' carry-forward-derived':''}`;
                    await syncCompletion(task.id,state.completions[task.id]);
                    pushUndo(`${prev?'Uncompleted':'Completed'}: ${task.text.substring(0,30)}`,async()=>{state.completions[task.id]=prev;await syncCompletion(task.id,prev);executeRenderCycles();});
                    updateTodayCount();calculateVelocity();renderStreak();renderNextUp();renderMissedBanner();
                  }else{
                    if(openDrawerTaskId===task.id){openDrawerTaskId=null;drawer.classList.remove('open');}
                    else{openDrawerTaskId=task.id;document.querySelectorAll('.task-notes-drawer.open').forEach(d=>d.classList.remove('open'));drawer.classList.add('open');}
                  }
                });
              }
              tasksEl.appendChild(item);
            }
          });
        }
      }
      col.appendChild(tasksEl);grid.appendChild(col);
    });
  }

  function executeRenderCycles(){
    renderGrid();renderTabsRow();renderStreak();updateTodayCount();calculateVelocity();renderNextUp();renderMissedBanner();
  }

  function updateSettingsPanel(){
    const el=document.getElementById('settingsSyncStatus');
    if(!el)return;
    const queueText=syncQueue.length===0?'No saved offline changes.':`${syncQueue.length} saved change${syncQueue.length===1?'':'s'} waiting to sync.`;
    el.textContent=`${navigator.onLine?'Online':'Offline'} · ${queueText}`;
    const ntfyTopicInput=document.getElementById('ntfyTopicInput');
    const ntfyEnabledInput=document.getElementById('ntfyEnabledInput');
    if(ntfyTopicInput)ntfyTopicInput.value=ntfyTopic;
    if(ntfyEnabledInput)ntfyEnabledInput.checked=ntfyEnabled;
    renderArchiveBin();
  }

  // ── EVENTS ─────────────────────────────────────────────
  document.getElementById('viewLayoutSwitch').addEventListener('change',(e)=>{summaryLayoutVisible=false;document.getElementById('summaryViewToggleBtn').classList.remove('active-view-btn');currentLayoutView=e.target.value;executeRenderCycles();});
  document.getElementById('brandFilter').addEventListener('change',(e)=>{selectedBrandFilter=e.target.value;renderGrid();});
  document.getElementById('summaryViewToggleBtn').addEventListener('click',(e)=>{summaryLayoutVisible=!summaryLayoutVisible;e.target.classList.toggle('active-view-btn',summaryLayoutVisible);executeRenderCycles();});
  document.getElementById('downloadCsvBtn').addEventListener('click',downloadWeeklyReportCsv);
  document.getElementById('printReportBtn').addEventListener('click',printWeeklyReport);
  document.getElementById('weeklyNotesBtn').addEventListener('click',openWeeklyNotesDrawer);
  document.getElementById('weeklyNotesHandle').addEventListener('click',openWeeklyNotesDrawer);
  document.getElementById('weeklyNotesCloseBtn').addEventListener('click',closeWeeklyNotesDrawer);
  document.getElementById('weeklyNotesOverlay').addEventListener('click',closeWeeklyNotesDrawer);
  document.getElementById('weeklyNotesInput').addEventListener('input',(e)=>{
    if(isReadOnly)return;
    weeklyNotes=e.target.value;
    queueWeeklyNotesSave();
  });
  document.querySelectorAll('.notes-drawer-tab').forEach(btn=>btn.addEventListener('click',()=>setBrainDumpTab(btn.dataset.notesTab)));
  document.getElementById('notesBrandSelector').addEventListener('click',(e)=>{
    const chip=e.target.closest('.notes-brand-chip');
    if(!chip||isReadOnly)return;
    document.querySelectorAll('.notes-brand-chip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
    selectedBrainDumpBrand=chip.dataset.brand;
  });
  document.getElementById('saveBrainDumpBtn').addEventListener('click',saveBrainDumpNote);
  document.getElementById('extractTasksBtn').addEventListener('click',extractBrainDumpTasks);
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape')closeWeeklyNotesDrawer();});
  document.getElementById('settingsBtn').addEventListener('click',()=>{updateSettingsPanel();document.getElementById('settingsModal').style.display='flex';});
  document.getElementById('settingsCloseBtn').addEventListener('click',()=>document.getElementById('settingsModal').style.display='none');
  document.getElementById('clearQueueBtn').addEventListener('click',async()=>{
    const confirmed=await showConfirm('CLEAR OFFLINE QUEUE','This removes saved unsynced changes only. Your visible tracker entries stay as they are.');
    if(!confirmed)return;
    syncQueue=[];persistSyncQueue();setSyncStatus('ok');updateOnlineStatus();updateSettingsPanel();
  });
  document.getElementById('saveNtfySettingsBtn').addEventListener('click',async()=>{
    ntfyTopic=document.getElementById('ntfyTopicInput').value.trim();
    ntfyEnabled=document.getElementById('ntfyEnabledInput').checked;
    localStorage.setItem(NTFY_TOPIC_KEY,ntfyTopic);
    localStorage.setItem(NTFY_ENABLED_KEY,ntfyEnabled?'true':'false');
    await showConfirm('NTFY SAVED',ntfyEnabled&&ntfyTopic?'ntfy alerts are enabled for this device.':'ntfy alerts are saved but currently off or missing a topic.');
    updateSettingsPanel();
  });
  document.getElementById('testNtfyBtn').addEventListener('click',async()=>{
    ntfyTopic=document.getElementById('ntfyTopicInput').value.trim();
    ntfyEnabled=document.getElementById('ntfyEnabledInput').checked;
    localStorage.setItem(NTFY_TOPIC_KEY,ntfyTopic);
    localStorage.setItem(NTFY_ENABLED_KEY,ntfyEnabled?'true':'false');
    if(!ntfyEnabled||!ntfyTopic){await showConfirm('NTFY NOT READY','Turn ntfy on and enter your topic first.');return;}
    await sendNtfyAlert('ENIGMA TEST','ntfy is connected to your Task Tracker alarms.','low');
    await showConfirm('TEST SENT','Check your ntfy app for the test alert.');
  });
  document.getElementById('resetBtn').addEventListener('click',async()=>{if(isReadOnly){await showConfirm('READ-ONLY','Past weeks cannot be reset.');return;}const confirmed=await showConfirm('RESET WEEK','This will wipe all completions, custom tasks, notes, archived tasks, and cloud data for this week. Cannot be undone.');if(!confirmed)return;state={completions:{},counters:{},skipped:{},deleted:{},order:{}};customTasks=[];taskNotes={};weeklyNotes='';brainDumpNotes=[];brainDumpSuggestions=[];archivedTasks=[];alertedTasks={};openDrawerTaskId=null;missedBannerDismissed=false;sessionStorage.setItem(ALERTED_KEY,JSON.stringify({}));closeWeeklyNotesDrawer();updateWeeklyNotesDrawer();await clearCurrentWeekCloud();executeRenderCycles();});

  const modal=document.getElementById('taskModal');
  document.getElementById('addTaskBtn').addEventListener('click',()=>{if(isReadOnly)return;openTaskModal('add');});
  document.getElementById('modCancel').addEventListener('click',()=>{editingTaskContext=null;modal.style.display='none';});
  document.getElementById('modSave').addEventListener('click',async()=>{const saved=await saveTaskFromModal();if(!saved)return;editingTaskContext=null;modal.style.display='none';executeRenderCycles();});

  // ── BOOT ───────────────────────────────────────────────
  function boot(){
    const modeParam=new URLSearchParams(window.location.search).get('view');
    if(modeParam==='day'){currentLayoutView='day';document.getElementById('viewLayoutSwitch').value='day';}
    buildWeekPicker();isReadOnly=false;updateOnlineStatus();
    runClockTick();runAlarmDaemon();showLoadingGrid();fetchCloudState();fetchHistoryAnalytics();initRealtime();
  }

  boot();
});
