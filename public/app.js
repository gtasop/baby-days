import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where,
  orderBy, limit, arrayUnion, arrayRemove, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------- helpers ----------
const $ = (s, el=document) => el.querySelector(s);
const h = (tag, attrs={}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
};
const store = {
  get(k){ try { return localStorage.getItem(k); } catch { return null; } },
  set(k,v){ try { localStorage.setItem(k,v); } catch {} }
};
const MIN = 60000, HOUR = 60*MIN, DAY = 24*HOUR;
const pad = n => String(n).padStart(2,'0');
const hm = t => { const d = new Date(t); return pad(d.getHours())+':'+pad(d.getMinutes()); };
const dur = ms => { ms = Math.max(0, ms); const m = Math.round(ms/MIN); if (m < 60) return m+'m'; const hh = Math.floor(m/60), mm = m%60; return hh+'h'+(mm? ' '+pad(mm)+'m':''); };
const ago = t => { const ms = Date.now()-t; if (ms < MIN) return 'just now'; return dur(ms)+' ago'; };
const startOfDay = t => { const d = new Date(t); d.setHours(0,0,0,0); return d.getTime(); };
const toLocalInput = t => { const d = new Date(t); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes()); };
const fromLocalInput = s => s ? new Date(s).getTime() : null;
const dayLabel = t => {
  const s = startOfDay(t), today = startOfDay(Date.now());
  if (s === today) return 'Today';
  if (s === today - DAY) return 'Yesterday';
  return new Date(t).toLocaleDateString(undefined, {weekday:'long', day:'numeric', month:'short'});
};
const ageText = born => {
  if (!born) return '';
  const b = new Date(born+'T00:00'); const days = Math.floor((Date.now()-b.getTime())/DAY);
  if (days < 0) return '';
  if (days < 14) return days+' days old';
  if (days < 98) { const w = Math.floor(days/7), d = days%7; return w+' weeks'+(d?' '+d+' days':'')+' old'; }
  let months = (new Date().getFullYear()-b.getFullYear())*12 + new Date().getMonth()-b.getMonth();
  if (new Date().getDate() < b.getDate()) months--;
  return months < 24 ? months+' months old' : Math.floor(months/12)+' years '+(months%12)+' months old';
};
const feedText = l => {
  if (l.feedType === 'bottle') return 'Bottle' + (l.amountMl ? ' · '+l.amountMl+' ml' : '');
  if (l.feedType === 'solids') return 'Solids';
  return 'Breast';
};
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const standalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ---------- state ----------
let auth, db, me = null;
let babies = [], invites = [], babyId = store.get('bd.baby'), logs = [];
let unsubBabies = null, unsubInvites = null, unsubLogs = null;
let busy = false;
let range = +(store.get('bd.range')) === 30 ? 30 : 7;
let tab = store.get('bd.tab') === 'trends' ? 'trends' : 'today';
const profileSynced = new Set();

function showBanner(text){ const b = $('#banner'); b.textContent = text; b.hidden = !text; }
function explain(e){
  const code = e && e.code || '';
  if (code.includes('permission-denied')) return 'You don’t have access to this. Ask the other parent to invite your Google email address.';
  if (code.includes('unavailable')) return 'You’re offline. Changes will sync when you’re back online.';
  return 'Could not save. Check your connection and try again.';
}
async function write(fn){
  if (busy) return; busy = true;
  try { await fn(); showBanner(''); }
  catch (e) { console.error(e); showBanner(explain(e)); }
  finally { busy = false; }
}

// ---------- boot ----------
async function boot(){
  let config;
  try {
    const res = await fetch('/__/firebase/init.json');
    if (!res.ok) throw new Error('no config');
    config = await res.json();
  } catch {
    $('#main').replaceChildren(h('div',{class:'empty'},
      h('h2',{class:'empty-title'}, 'Not connected to Firebase'),
      h('p',{}, 'This page needs to be deployed with Firebase Hosting. See the README for the setup steps.')));
    return;
  }
  const app = initializeApp(config);
  auth = getAuth(app);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

  getRedirectResult(auth).catch(e => showSignIn(e));
  onAuthStateChanged(auth, user => {
    if (!user) { stopAll(); me = null; showSignIn(); return; }
    me = { uid: user.uid, email: (user.email||'').toLowerCase(), name: user.displayName || user.email || 'Parent', photo: user.photoURL || '' };
    startData();
  });
}

function showSignIn(err){
  $('#fab').hidden = true;
  $('#babies').replaceChildren();
  $('#babyName').textContent = 'Baby Days';
  $('#babyAge').textContent = 'Sleep and feeding log, shared between parents';
  const msg = err && err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request'
    ? h('p',{class:'msg'}, 'Sign-in didn’t work. Please try again.') : null;
  $('#main').replaceChildren(h('div',{class:'signin'},
    h('h2',{}, 'Sign in to see your baby’s log'),
    h('p',{class:'muted'}, 'You and your partner each sign in with your own Google account. Your device stays signed in.'),
    h('button',{class:'btn google',onclick:signIn},
      h('span',{class:'g','aria-hidden':'true'}, 'G'), 'Continue with Google'),
    msg));
}
async function signIn(){
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (standalone() || isIOS()) { await signInWithRedirect(auth, provider); return; }
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') await signInWithRedirect(auth, provider);
    else showSignIn(e);
  }
}

function stopAll(){
  [unsubBabies, unsubInvites, unsubLogs].forEach(u => u && u());
  unsubBabies = unsubInvites = unsubLogs = null;
  babies = []; invites = []; logs = [];
}

function startData(){
  stopAll();
  $('#main').replaceChildren(h('div',{class:'empty'}, 'Loading your logs…'));
  unsubBabies = onSnapshot(query(collection(db,'babies'), where('members','array-contains',me.uid)), snap => {
    babies = snap.docs.map(d => ({id:d.id, ...d.data()})).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    babies.forEach(syncProfile);
    if (!babies.find(b => b.id === babyId)) { babyId = babies[0]?.id || null; store.set('bd.baby', babyId || ''); subscribeLogs(); }
    else if (!unsubLogs) subscribeLogs();
    render();
  }, e => { console.error(e); showBanner(explain(e)); });
  if (me.email) {
    unsubInvites = onSnapshot(query(collection(db,'babies'), where('invites','array-contains',me.email)), snap => {
      invites = snap.docs.map(d => ({id:d.id, ...d.data()})).filter(b => !(b.members||[]).includes(me.uid));
      render();
    }, e => console.warn('invites', e));
  }
}

// keep this parent's name and photo on each baby so the other parent can see who logged what
function syncProfile(b){
  if (profileSynced.has(b.id)) return;
  profileSynced.add(b.id);
  const cur = (b.memberInfo||{})[me.uid] || {};
  if (cur.name === me.name && cur.photo === me.photo) return;
  updateDoc(doc(db,'babies',b.id), { ['memberInfo.'+me.uid]: { name: me.name, photo: me.photo } }).catch(e => console.warn(e));
}

const logsCol = () => collection(db,'babies',babyId,'logs');
// keep=true re-attaches the listener for the same baby without blanking the list
function subscribeLogs(keep){
  if (unsubLogs) { unsubLogs(); unsubLogs = null; }
  if (!keep) logs = [];
  if (!babyId) return;
  unsubLogs = onSnapshot(query(logsCol(), orderBy('start','desc'), limit(1000)), snap => {
    logs = snap.docs.map(d => ({id:d.id, ...d.data()}));
    render();
  }, e => { console.error(e); showBanner(explain(e)); });
}

// Log writes update the screen straight away instead of waiting for the listener,
// which can lag (or stall after the app was in the background). The server
// promise only resolves once the write is acknowledged, so the double-tap lock
// is released after a short delay rather than held until then.
async function writeLog(apply, send){
  if (busy) return; busy = true;
  setTimeout(() => { busy = false; }, 600);
  apply(); render();
  try { await send(); showBanner(''); }
  catch (e) { console.error(e); showBanner(explain(e)); subscribeLogs(true); }
}
function saveLog(id, data){
  const ref = id ? doc(logsCol(), id) : doc(logsCol());
  const body = {...data, by: me.uid, updatedAt: Date.now()};
  return writeLog(() => {
    logs = [{id: ref.id, ...body}, ...logs.filter(l => l.id !== ref.id)].sort((a,b) => b.start - a.start);
  }, () => setDoc(ref, body));
}
function patchLog(l, patch){ const {id, ...rest} = l; return saveLog(id, {...rest, ...patch}); }
function delLog(id){
  return writeLog(() => { logs = logs.filter(l => l.id !== id); }, () => deleteDoc(doc(logsCol(), id)));
}

function selectBaby(id){
  if (id === babyId && unsubLogs) return;
  babyId = id; store.set('bd.baby', id || '');
  subscribeLogs(); render();
}

// ---------- render ----------
function avatar(info, cls='who'){
  if (info && info.photo) return h('img',{class:cls,src:info.photo,alt:info.name||'Parent',title:info.name||'',referrerpolicy:'no-referrer'});
  const initial = ((info && info.name) || '?').trim().charAt(0).toUpperCase();
  return h('span',{class:cls+' initial',title:(info && info.name)||'','aria-hidden':'true'}, initial);
}

function render(){
  if (!me) return;
  const baby = babies.find(b => b.id === babyId);

  // header
  const bWrap = $('#babies'); bWrap.replaceChildren();
  if (babies.length > 1) babies.forEach(b => bWrap.append(h('button',{class:'chip','aria-pressed':String(b.id===babyId),onclick:()=>selectBaby(b.id)}, b.name)));
  if (baby) bWrap.append(h('button',{class:'chip',onclick:()=>openSharingSheet(baby)}, 'Sharing'));
  bWrap.append(h('button',{class:'me-btn',onclick:openAccountSheet,'aria-label':'Account'}, avatar(me,'me-av')));
  $('#babyName').textContent = baby ? baby.name : 'Baby Days';
  $('#babyAge').textContent = baby ? (ageText(baby.born) || 'Sleep and feeding log') : 'Sleep and feeding log, shared between parents';
  $('#fab').hidden = !baby || tab !== 'today';

  const main = $('#main'); main.replaceChildren();

  // pending invitations
  invites.forEach(inv => {
    const from = (inv.memberInfo||{})[inv.createdBy];
    main.append(h('div',{class:'invite'},
      h('div',{}, h('b',{}, (from && from.name ? from.name : 'Someone') + ' invited you to ' + inv.name + '’s log')),
      h('div',{class:'actions'},
        h('button',{class:'btn ghost',onclick:()=>write(()=>updateDoc(doc(db,'babies',inv.id),{invites: arrayRemove(me.email)}))}, 'Decline'),
        h('button',{class:'btn sleep',onclick:()=>write(async()=>{
          await updateDoc(doc(db,'babies',inv.id), { members: arrayUnion(me.uid), invites: arrayRemove(me.email), ['memberInfo.'+me.uid]: {name: me.name, photo: me.photo} });
          profileSynced.add(inv.id); selectBaby(inv.id);
        })}, 'Join'))));
  });

  if (!baby) {
    main.append(h('div',{class:'empty'},
      h('h2',{class:'empty-title'}, invites.length ? 'Or add a baby yourself' : 'Add your baby to start'),
      h('p',{}, 'Then use Sharing to invite your partner by their Google email address.'),
      h('button',{class:'btn sleep',onclick:()=>openBabySheet(null)}, 'Add baby')));
    return;
  }

  const now = Date.now();
  const sleeps = logs.filter(l => l.kind==='sleep');
  const feeds = logs.filter(l => l.kind==='feed');

  main.append(h('nav',{class:'tabs'}, seg([['today','Today'],['trends','Trends']], tab, v => { tab = v; store.set('bd.tab', v); render(); window.scrollTo(0,0); })));
  if (tab === 'trends') {
    main.append(logs.length ? trendsSection(sleeps, feeds, now)
      : h('div',{class:'empty'}, 'Trends appear here once you have logged some sleeps and feeds.'));
    return;
  }

  const openSleep = sleeps.find(l => !l.end);
  const openFeed = feeds.find(l => !l.end && l.feedType==='breast');
  const lastSleep = sleeps.find(l => l.end);
  const lastFeed = feeds[0];

  const sleepCard = h('div',{class:'card sleep'+(openSleep?' active':'')},
    h('div',{class:'label'}, h('span',{class:'dot s'}), openSleep ? 'Sleeping' : 'Awake'),
    h('div',{class:'big tnum'}, openSleep ? dur(now-openSleep.start) : (lastSleep ? dur(now-lastSleep.end) : '—')),
    h('div',{class:'sub'}, openSleep ? 'Since '+hm(openSleep.start) : (lastSleep ? 'Woke at '+hm(lastSleep.end)+' after '+dur(lastSleep.end-lastSleep.start) : 'No sleep logged yet')),
    openSleep
      ? h('button',{class:'btn sleep',onclick:()=>patchLog(openSleep,{end:Date.now()})}, 'Woke up')
      : h('button',{class:'btn sleep',onclick:()=>saveLog(null,{kind:'sleep',start:Date.now(),end:null})}, 'Start sleep'));

  const feedCard = h('div',{class:'card feed'+(openFeed?' active':'')},
    h('div',{class:'label'}, h('span',{class:'dot f'}), openFeed ? 'Breastfeeding' : 'Last feed'),
    h('div',{class:'big tnum'}, openFeed ? dur(now-openFeed.start) : (lastFeed ? ago(lastFeed.start) : '—')),
    h('div',{class:'sub'}, openFeed ? 'Started '+hm(openFeed.start) : lastFeed ? feedText(lastFeed)+' at '+hm(lastFeed.start) : 'No feed logged yet'),
    openFeed
      ? h('button',{class:'btn feed',onclick:()=>patchLog(openFeed,{end:Date.now()})}, 'Stop feeding')
      : h('div',{class:'feedbtns'},
          h('button',{class:'btn',onclick:()=>openLogSheet({kind:'feed',feedType:'bottle',start:Date.now(),end:null})}, 'Bottle'),
          h('button',{class:'btn',onclick:()=>openLogSheet({kind:'feed',feedType:'solids',start:Date.now(),end:null})}, 'Solids')));
  main.append(h('div',{class:'status'}, sleepCard, feedCard));

  // last 24h
  const from = now - DAY;
  let sleepMs = 0;
  const ribbon = h('div',{class:'ribbon','aria-label':'Last 24 hours'});
  sleeps.forEach(l => {
    const s = Math.max(l.start, from), e = Math.min(l.end || now, now);
    if (e <= s) return;
    sleepMs += e - s;
    ribbon.append(h('div',{class:'blk',style:`left:${(s-from)/DAY*100}%;width:${Math.max(.4,(e-s)/DAY*100)}%`}));
  });
  const recentFeeds = feeds.filter(l => l.start >= from);
  recentFeeds.forEach(l => ribbon.append(h('div',{class:'tick',style:`left:${(l.start-from)/DAY*100}%`})));
  ribbon.append(h('div',{class:'now',style:'right:0'}));
  const ml = recentFeeds.filter(l => l.feedType==='bottle').reduce((a,l)=>a+(+l.amountMl||0),0);
  const hours = h('div',{class:'hours tnum'});
  for (let i=0;i<=4;i++) hours.append(h('span',{}, hm(from + i*6*HOUR)));
  main.append(h('section',{class:'today'},
    h('div',{class:'label'}, 'Last 24 hours'),
    h('div',{class:'stats'},
      h('div',{class:'stat'}, h('div',{class:'v tnum'}, dur(sleepMs)), h('div',{class:'muted'}, 'sleep')),
      h('div',{class:'stat'}, h('div',{class:'v tnum'}, recentFeeds.length), h('div',{class:'muted'}, recentFeeds.length===1?'feed':'feeds')),
      h('div',{class:'stat'}, h('div',{class:'v tnum'}, ml ? ml+' ml' : '—'), h('div',{class:'muted'}, 'from bottles'))),
    ribbon, hours));

  if (!logs.length) {
    main.append(h('div',{class:'empty'}, 'No entries yet. Tap Start sleep or a feed button above, or use + Add entry for something that already happened.'));
    return;
  }
  const people = baby.memberInfo || {};
  const groups = new Map();
  logs.forEach(l => { const k = startOfDay(l.start); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); });
  const list = h('section',{class:'logs'});
  let shown = 0;
  for (const [k, items] of groups) {
    if (shown > 14) break; shown++;
    const dSleep = items.filter(l=>l.kind==='sleep').reduce((a,l)=>a+((l.end||now)-l.start),0);
    const dFeeds = items.filter(l=>l.kind==='feed').length;
    const rows = h('div',{class:'rows'});
    items.forEach(l => {
      const what = l.kind==='sleep'
        ? h('div',{}, h('b',{}, l.end ? 'Slept '+dur(l.end-l.start) : 'Sleeping now'), l.end ? h('span',{class:'muted'}, ' · until '+hm(l.end)) : null)
        : h('div',{}, h('b',{}, feedText(l)), l.end && l.feedType==='breast' ? h('span',{class:'muted'}, ' · '+dur(l.end-l.start)) : (!l.end && l.feedType==='breast' ? h('span',{class:'muted'}, ' · in progress') : null));
      rows.append(h('button',{class:'row '+l.kind,onclick:()=>openLogSheet(l),'aria-label':'Edit entry'},
        h('span',{class:'bar'}),
        h('span',{class:'t tnum'}, hm(l.start)),
        h('div',{class:'d'}, what, l.note ? h('div',{class:'muted'}, l.note) : null),
        people[l.by] ? avatar(people[l.by]) : h('span')));
    });
    list.append(h('div',{class:'day'}, h('h3',{}, dayLabel(+k), h('span',{class:'tnum'}, dur(dSleep)+' sleep · '+dFeeds+' feeds')), rows));
  }
  main.append(list);
}

// ---------- trends ----------
const overlap = (a1,a2,b1,b2) => Math.max(0, Math.min(a2,b2) - Math.max(a1,b1));
function trendsSection(sleeps, feeds, now){
  const today0 = startOfDay(now);
  const days = [];
  for (let i = range-1; i >= 0; i--) {
    const d = new Date(today0); d.setDate(d.getDate()-i);
    const s = d.getTime(); const e2 = new Date(s); e2.setDate(e2.getDate()+1); const e = e2.getTime();
    const day = {s, e, night:0, dayS:0, feeds:0, ml:0, today: i===0};
    const d7 = s + 7*HOUR, d19 = s + 19*HOUR; // night = 19:00–07:00
    sleeps.forEach(l => {
      const a = l.start, b = Math.min(l.end || now, now);
      if (b <= s || a >= e) return;
      const total = overlap(a,b,s,e), dayPart = overlap(a,b,d7,d19);
      day.dayS += dayPart; day.night += total - dayPart;
    });
    feeds.forEach(l => { if (l.start >= s && l.start < e) { day.feeds++; if (l.feedType==='bottle') day.ml += (+l.amountMl||0); } });
    days.push(day);
  }
  const all = [...sleeps, ...feeds];
  const firstDay = startOfDay(all.length ? Math.min(...all.map(l => l.start)) : now);
  let basis = days.filter(d => !d.today && d.s >= firstDay);
  const partial = !basis.length;
  if (partial) basis = days.filter(d => d.today);
  const n = basis.length;
  const avg = f => basis.reduce((a,d)=>a+f(d),0) / n;
  const avgSleep = avg(d => d.night + d.dayS), avgNight = avg(d => d.night), avgDay = avg(d => d.dayS);
  const avgFeeds = avg(d => d.feeds), avgMl = avg(d => d.ml);

  const from = days[0].s;
  const done = sleeps.filter(l => l.end && l.start >= from);
  const longest = done.reduce((m,l) => (!m || l.end-l.start > m.end-m.start) ? l : m, null);
  const naps = done.filter(l => overlap(l.start,l.end,startOfDay(l.start)+7*HOUR,startOfDay(l.start)+19*HOUR) > (l.end-l.start)/2);
  const avgNap = naps.length ? naps.reduce((a,l)=>a+l.end-l.start,0)/naps.length : 0;
  const fs = feeds.filter(l => l.start >= from).map(l => l.start).sort((a,b)=>a-b);
  const gaps = []; for (let i=1;i<fs.length;i++){ const g = fs[i]-fs[i-1]; if (g < 8*HOUR) gaps.push(g); }
  gaps.sort((a,b)=>a-b);
  const medGap = gaps.length ? gaps[Math.floor(gaps.length/2)] : 0;

  const tile = (v, k) => h('div',{class:'tile'}, h('div',{class:'v tnum'}, v), h('div',{class:'k'}, k));
  const fmtDate = t => new Date(t).toLocaleDateString(undefined,{day:'numeric',month:'short'});
  const tiles = h('div',{class:'tiles'},
    tile(dur(avgSleep), `sleep per day · ${dur(avgNight)} night, ${dur(avgDay)} day`),
    tile(avgFeeds ? avgFeeds.toFixed(1).replace(/\.0$/,'') : '0', 'feeds per day' + (avgMl ? ` · ${Math.round(avgMl)} ml bottle` : '')),
    tile(longest ? dur(longest.end-longest.start) : '—', longest ? 'longest sleep · '+fmtDate(longest.start)+', '+hm(longest.start) : 'longest sleep'),
    tile(medGap ? dur(medGap) : '—', 'typical time between feeds' + (naps.length ? ` · naps ${dur(avgNap)} avg` : '')));

  const xlab = () => { const x = h('div',{class:'xlab tnum'}); days.forEach((d,i) => {
    const dt = new Date(d.s);
    const show = range === 7 || i % 5 === (range-1) % 5;
    x.append(h('span',{}, show ? (range===7 ? dt.toLocaleDateString(undefined,{weekday:'narrow'}) : dt.getDate()) : ''));
  }); return x; };

  const maxSleepH = Math.max(12, Math.ceil(Math.max(...days.map(d => (d.night+d.dayS)/HOUR)) / 2) * 2);
  const sleepBars = h('div',{class:'bars',role:'img','aria-label':'Sleep per day'}, h('span',{class:'max tnum'}, maxSleepH+'h'), h('span',{class:'mid tnum'}, (maxSleepH/2)+'h'));
  days.forEach(d => sleepBars.append(h('div',{class:'col'+(d.today?' today':''),title:`${fmtDate(d.s)}: ${dur(d.night)} night, ${dur(d.dayS)} day`},
    h('div',{class:'seg-n',style:`height:${d.night/HOUR/maxSleepH*100}%`}),
    h('div',{class:'seg-d',style:`height:${d.dayS/HOUR/maxSleepH*100}%`}))));

  const maxF = Math.max(4, Math.ceil(Math.max(...days.map(d => d.feeds)) / 2) * 2);
  const feedBars = h('div',{class:'bars',role:'img','aria-label':'Feeds per day'}, h('span',{class:'max tnum'}, maxF), h('span',{class:'mid tnum'}, maxF/2));
  days.forEach(d => feedBars.append(h('div',{class:'col'+(d.today?' today':''),title:`${fmtDate(d.s)}: ${d.feeds} feeds${d.ml?', '+d.ml+' ml bottle':''}`},
    h('div',{class:'seg-f',style:`height:${d.feeds/maxF*100}%`}))));

  return h('section',{class:'trends'},
    h('div',{class:'head'}, h('div',{class:'label'}, 'Trends'),
      seg([[7,'7 days'],[30,'30 days']], range, v => { range = v; store.set('bd.range', String(v)); render(); })),
    h('div',{class:'muted note'},
      partial ? 'Averages use today so far. They get more useful after a few full days.'
              : `Daily averages over ${n} full ${n===1?'day':'days'}${n < range ? ' (since you started logging)' : ''}. Night is 19:00–07:00.`),
    tiles,
    h('div',{class:'chart'}, h('div',{class:'ttl'}, 'Sleep per day', h('div',{class:'legend'}, h('span',{}, h('i',{class:'lg-n'}), 'Night'), h('span',{}, h('i',{class:'lg-d'}), 'Day'))), sleepBars, xlab()),
    h('div',{class:'chart'}, h('div',{class:'ttl'}, 'Feeds per day', h('span',{}, 'today is faded until the day ends')), feedBars, xlab()));
}

// ---------- sheets ----------
function closeSheet(){ $('#sheetRoot').replaceChildren(); }
function sheet(...kids){
  const bg = h('div',{class:'sheet-bg',onclick:e=>{ if (e.target===bg) closeSheet(); }}, h('div',{class:'sheet',role:'dialog','aria-modal':'true'}, ...kids));
  $('#sheetRoot').replaceChildren(bg);
}
function seg(options, value, onChange){
  const wrap = h('div',{class:'seg'});
  const draw = v => { wrap.replaceChildren(...options.map(([val,label]) => h('button',{type:'button','aria-pressed':String(val===v),onclick:()=>{ onChange(val); draw(val); }}, label))); };
  draw(value); return wrap;
}

function openLogSheet(entry){
  const isNew = !entry || !entry.id;
  const st = {kind:'feed', feedType:'bottle', start:Date.now(), end:null, amountMl:'', note:'', ...(entry||{})};
  const body = h('div',{class:'stack'});
  const draw = () => {
    body.replaceChildren();
    if (isNew) body.append(seg([['sleep','Sleep'],['feed','Feed']], st.kind, v => { st.kind = v; draw(); }));
    if (st.kind === 'feed') {
      // Breast is no longer offered; it only appears when editing an older breast entry
      const types = [['bottle','Bottle'],['solids','Solids']];
      if (!isNew && entry.feedType === 'breast') types.unshift(['breast','Breast']);
      body.append(seg(types, st.feedType, v => { st.feedType = v; draw(); }));
      if (st.feedType === 'bottle') body.append(h('div',{class:'field'}, h('label',{class:'label',for:'f-ml'}, 'Amount (ml)'),
        h('input',{id:'f-ml',type:'number',inputmode:'numeric',min:'0',step:'5',value:st.amountMl||'',oninput:e=>st.amountMl=e.target.value})));
    }
    const showEnd = st.kind === 'sleep' || st.feedType === 'breast';
    body.append(h('div',{class:showEnd?'two':''},
      h('div',{class:'field'}, h('label',{class:'label',for:'f-start'}, st.kind==='sleep'?'Fell asleep':'Started'),
        h('input',{id:'f-start',type:'datetime-local',value:toLocalInput(st.start),onchange:e=>st.start=fromLocalInput(e.target.value)})),
      showEnd ? h('div',{class:'field'}, h('label',{class:'label',for:'f-end'}, st.kind==='sleep'?'Woke up':'Ended'),
        h('input',{id:'f-end',type:'datetime-local',value:st.end?toLocalInput(st.end):'',onchange:e=>st.end=fromLocalInput(e.target.value)})) : null));
    body.append(h('div',{class:'field'}, h('label',{class:'label',for:'f-note'}, 'Note'),
      h('input',{id:'f-note',type:'text',placeholder:'Optional',value:st.note||'',oninput:e=>st.note=e.target.value})));
  };
  draw();
  const msg = h('div',{class:'msg'});
  const save = async () => {
    if (!st.start) { msg.textContent = 'Set a start time.'; return; }
    const showEnd = st.kind === 'sleep' || st.feedType === 'breast';
    if (showEnd && st.end && st.end < st.start) { msg.textContent = 'The end time is before the start time.'; return; }
    const data = {kind:st.kind, start:st.start, end: showEnd ? (st.end||null) : st.start, note: (st.note||'').trim()};
    if (st.kind === 'feed') { data.feedType = st.feedType; if (st.feedType==='bottle') data.amountMl = Number(st.amountMl)||0; }
    closeSheet(); await saveLog(isNew ? null : st.id, data);
  };
  let confirmDel = false;
  const delBtn = !isNew ? h('button',{class:'btn danger',onclick:async()=>{
    if (!confirmDel) { confirmDel = true; delBtn.textContent = 'Tap again to delete'; return; }
    closeSheet(); await delLog(st.id);
  }}, 'Delete') : null;
  sheet(h('h2',{}, isNew ? 'Add entry' : 'Edit entry'), body, msg,
    h('div',{class:'actions'}, delBtn, h('button',{class:'btn ghost',onclick:closeSheet}, 'Cancel'), h('button',{class:'btn sleep',onclick:save}, 'Save')));
}

function openBabySheet(baby){
  const st = {name: baby?.name || '', born: baby?.born || ''};
  const msg = h('div',{class:'msg'});
  sheet(h('h2',{}, baby ? 'Edit baby' : 'Add baby'),
    h('div',{class:'field'}, h('label',{class:'label',for:'b-name'}, 'Name'), h('input',{id:'b-name',type:'text',value:st.name,oninput:e=>st.name=e.target.value})),
    h('div',{class:'field'}, h('label',{class:'label',for:'b-born'}, 'Date of birth'), h('input',{id:'b-born',type:'date',value:st.born,oninput:e=>st.born=e.target.value})),
    msg,
    h('div',{class:'actions'},
      h('button',{class:'btn ghost',onclick:closeSheet}, 'Cancel'),
      h('button',{class:'btn sleep',onclick:async()=>{
        const name = st.name.trim(); if (!name) { msg.textContent = 'Enter a name.'; return; }
        closeSheet();
        await write(async () => {
          if (baby) await updateDoc(doc(db,'babies',baby.id), {name, born: st.born||''});
          else {
            const ref = await addDoc(collection(db,'babies'), {
              name, born: st.born||'', createdAt: Date.now(), createdBy: me.uid,
              members: [me.uid], invites: [], memberInfo: { [me.uid]: {name: me.name, photo: me.photo} } });
            profileSynced.add(ref.id); selectBaby(ref.id);
          }
        });
      }}, 'Save')));
}

function openSharingSheet(baby){
  const info = baby.memberInfo || {};
  const st = {email: ''};
  const msg = h('div',{class:'msg'});
  const people = h('div',{class:'people'});
  (baby.members||[]).forEach(uid => {
    const p = info[uid] || {};
    const isMe = uid === me.uid, isCreator = uid === baby.createdBy;
    let confirm = false;
    const rm = (!isMe && !isCreator) ? h('button',{class:'link danger-text',onclick:async e=>{
      if (!confirm) { confirm = true; e.target.textContent = 'Tap again to remove'; return; }
      closeSheet();
      await write(() => updateDoc(doc(db,'babies',baby.id), { members: arrayRemove(uid), ['memberInfo.'+uid]: deleteField() }));
    }}, 'Remove') : null;
    people.append(h('div',{class:'person'}, avatar(p), h('div',{class:'pn'}, (p.name||'Parent') + (isMe ? ' (you)' : '')), rm));
  });
  (baby.invites||[]).forEach(em => people.append(h('div',{class:'person'},
    h('span',{class:'who initial','aria-hidden':'true'}, '@'),
    h('div',{class:'pn'}, em, h('div',{class:'muted small'}, 'Invited, not joined yet')),
    h('button',{class:'link danger-text',onclick:async()=>{ closeSheet(); await write(() => updateDoc(doc(db,'babies',baby.id), {invites: arrayRemove(em)})); }}, 'Cancel'))));

  const invite = async () => {
    const em = st.email.trim().toLowerCase();
    if (!isEmail(em)) { msg.textContent = 'Enter a full email address.'; return; }
    if ((baby.invites||[]).includes(em)) { msg.textContent = 'That address is already invited.'; return; }
    closeSheet();
    await write(() => updateDoc(doc(db,'babies',baby.id), {invites: arrayUnion(em)}));
    showBanner(`Invited ${em}. They open this app, sign in with that Google account and tap Join.`);
  };
  const leave = baby.createdBy !== me.uid ? (() => { let c = false; return h('button',{class:'btn danger',onclick:async e=>{
    if (!c) { c = true; e.target.textContent = 'Tap again to leave'; return; }
    closeSheet();
    await write(() => updateDoc(doc(db,'babies',baby.id), { members: arrayRemove(me.uid), ['memberInfo.'+me.uid]: deleteField() }));
  }}, 'Leave this baby'); })() : null;

  sheet(h('h2',{}, 'Sharing ' + baby.name),
    h('p',{class:'muted small'}, 'Everyone listed can see and add logs for ' + baby.name + '.'),
    people,
    h('div',{class:'field'}, h('label',{class:'label',for:'i-email'}, 'Invite by Google email'),
      h('input',{id:'i-email',type:'email',autocomplete:'email',placeholder:'name@gmail.com',oninput:e=>st.email=e.target.value,onkeydown:e=>{ if (e.key==='Enter') invite(); }})),
    msg,
    h('div',{class:'actions'}, h('button',{class:'btn ghost',onclick:closeSheet}, 'Close'), h('button',{class:'btn sleep',onclick:invite}, 'Send invite')),
    h('div',{class:'actions'}, h('button',{class:'btn ghost',onclick:()=>{ closeSheet(); openBabySheet(baby); }}, 'Edit name or birth date'), h('button',{class:'btn ghost',onclick:()=>{ closeSheet(); openBabySheet(null); }}, '+ Another baby')),
    leave);
}

function openAccountSheet(){
  sheet(h('h2',{}, 'Your account'),
    h('div',{class:'person'}, avatar(me), h('div',{class:'pn'}, me.name, h('div',{class:'muted small'}, me.email))),
    h('div',{class:'actions'},
      h('button',{class:'btn ghost',onclick:closeSheet}, 'Close'),
      h('button',{class:'btn danger',onclick:async()=>{ closeSheet(); await signOut(auth); }}, 'Sign out')));
}

// ---------- wiring ----------
$('#fab').addEventListener('click', () => openLogSheet(null));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
setInterval(() => { if (!document.hidden && !$('#sheetRoot').firstChild) render(); }, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  // listeners can go quiet while the app is in the background; re-attach to catch up
  if (me && babyId) subscribeLogs(true);
  render();
});
boot();
