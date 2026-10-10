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

// The page carries the styles and app.js the behaviour. A phone holding a stale cached page next to a
// fresh app.js renders unstyled controls, so refetch the page and reload once when the versions differ.
// Bump this together with <meta name="app-version"> in index.html whenever their markup or styles change together.
const APP_VERSION = '2';
{
  const pageVersion = document.querySelector('meta[name="app-version"]')?.content;
  let tried = null;
  try { tried = sessionStorage.getItem('reloadedFor'); } catch {}
  if (pageVersion !== APP_VERSION && tried !== APP_VERSION) {
    try { sessionStorage.setItem('reloadedFor', APP_VERSION); } catch {}
    fetch(location.pathname, { cache: 'reload' }).catch(() => {}).finally(() => location.reload());
  }
}

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
// Medicine icons: inline SVG paths on a 24x24 grid, stroked with currentColor
const MED_ICONS = [
  ['pill','Pill','<path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z"/><path d="m8.5 8.5 7 7"/>'],
  ['tablet','Tablet','<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>'],
  ['syrup','Syrup','<path d="M10 2h4v3h-4z"/><path d="M9 5h6v2l2 3v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V10l2-3V5Z"/><path d="M7 14h10"/>'],
  ['spoon','Spoon','<ellipse cx="12" cy="7" rx="4" ry="5"/><path d="M12 12v9"/>'],
  ['drops','Drops','<path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11Z"/>'],
  ['cream','Cream','<path d="M6 3h12l-2 12H8L6 3Z"/><path d="M6.5 6h11"/><rect x="10" y="15" width="4" height="5" rx="1"/>'],
  ['syringe','Syringe','<path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/><path d="m14 4 6 6"/>'],
  ['plaster','Plaster','<rect x="1.5" y="8" width="21" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M10.5 10.5h.01M13.5 10.5h.01M10.5 13.5h.01M13.5 13.5h.01"/>'],
];
const medIcon = key => {
  const el = h('span',{class:'ic','aria-hidden':'true'});
  el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (MED_ICONS.find(i => i[0]===key) || MED_ICONS[0])[2] + '</svg>';
  return el;
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

// Saved medicines live on the baby, so both parents share the list. Each medicine
// log also copies the name and icon, so old entries survive a removed medicine.
function addMedicine(name, icon){
  const baby = babies.find(b => b.id === babyId);
  const list = baby.medicines || [];
  const same = list.find(m => m.name.toLowerCase() === name.toLowerCase());
  if (same) return same;
  const m = {id: doc(logsCol()).id, name, icon};
  baby.medicines = [...list, m];
  updateDoc(doc(db,'babies',babyId), {medicines: arrayUnion(m)}).catch(e => { console.error(e); showBanner(explain(e)); });
  return m;
}
function removeMedicine(id){
  const baby = babies.find(b => b.id === babyId);
  baby.medicines = (baby.medicines || []).filter(m => m.id !== id);
  updateDoc(doc(db,'babies',babyId), {medicines: baby.medicines}).catch(e => { console.error(e); showBanner(explain(e)); });
  render();
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
  const meds = logs.filter(l => l.kind==='med');

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
          h('button',{class:'btn solids',onclick:()=>openLogSheet({kind:'feed',feedType:'solids',start:Date.now(),end:null})}, 'Solids')));
  const savedMeds = baby.medicines || [];
  const lastMed = meds[0];
  const medCard = h('div',{class:'card med'},
    h('div',{class:'top'},
      h('div',{class:'label'}, h('span',{class:'dot m'}), 'Medicine'),
      h('div',{class:'sub'}, lastMed ? 'Last: '+(lastMed.medName||'Medicine')+', '+ago(lastMed.start) : 'None logged yet')),
    h('div',{class:'medbtns'},
      savedMeds.map(m => h('button',{class:'btn',onclick:()=>openLogSheet({kind:'med',medId:m.id,start:Date.now(),end:null})}, medIcon(m.icon), m.name)),
      h('button',{class:'btn add',onclick:()=>openLogSheet({kind:'med',start:Date.now(),end:null,addingMed:true})}, savedMeds.length ? '+ New' : '+ Add a medicine')));
  main.append(h('div',{class:'status'}, sleepCard, feedCard, medCard));

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
  recentFeeds.forEach(l => ribbon.append(h('div',{class:'tick'+(l.feedType==='solids'?' solids':''),style:`left:${(l.start-from)/DAY*100}%`})));
  meds.filter(l => l.start >= from).forEach(l => ribbon.append(h('div',{class:'tick med',style:`left:${(l.start-from)/DAY*100}%`})));
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
    const dMeds = items.filter(l=>l.kind==='med').length;
    const rows = h('div',{class:'rows'});
    items.forEach(l => {
      const what = l.kind==='sleep'
        ? h('div',{}, h('b',{}, l.end ? 'Slept '+dur(l.end-l.start) : 'Sleeping now'), l.end ? h('span',{class:'muted'}, ' · until '+hm(l.end)) : null)
        : l.kind==='med'
        ? h('div',{class:'medline'}, medIcon(l.medIcon), h('b',{}, l.medName || 'Medicine'))
        : h('div',{}, h('b',{}, feedText(l)), l.end && l.feedType==='breast' ? h('span',{class:'muted'}, ' · '+dur(l.end-l.start)) : (!l.end && l.feedType==='breast' ? h('span',{class:'muted'}, ' · in progress') : null));
      rows.append(h('button',{class:'row '+l.kind+(l.feedType==='solids'?' solids':''),onclick:()=>openLogSheet(l),'aria-label':'Edit entry'},
        h('span',{class:'bar'}),
        h('span',{class:'t tnum'}, hm(l.start)),
        h('div',{class:'d'}, what, l.note ? h('div',{class:'muted'}, l.note) : null),
        people[l.by] ? avatar(people[l.by]) : h('span')));
    });
    list.append(h('div',{class:'day'}, h('h3',{}, dayLabel(+k), h('span',{class:'tnum'}, dur(dSleep)+' sleep · '+dFeeds+' feeds'+(dMeds ? ' · '+dMeds+' med'+(dMeds>1?'s':'') : ''))), rows));
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

// One scrolling column of a time wheel (hours or minutes) that snaps to the middle row.
const WHEEL_ROW = 34;
function wheelCol(count, value, label, onPick){
  const items = Array.from({length: count}, (_, i) => h('div',{onclick:()=>col.scrollTo({top: i*WHEEL_ROW, behavior:'smooth'})}, pad(i)));
  const col = h('div',{class:'col',tabindex:'0',role:'spinbutton','aria-label':label,'aria-valuemin':'0','aria-valuemax':String(count-1)}, items);
  let cur = -1, timer;
  const mark = i => {
    if (i === cur) return;
    items[cur]?.classList.remove('on'); items[i].classList.add('on'); cur = i;
    col.setAttribute('aria-valuenow', i); col.setAttribute('aria-valuetext', pad(i));
  };
  // highlight live while scrolling, report once the wheel settles
  col.addEventListener('scroll', () => {
    mark(Math.min(count-1, Math.max(0, Math.round(col.scrollTop / WHEEL_ROW))));
    clearTimeout(timer); timer = setTimeout(() => onPick(cur), 120);
  });
  col.addEventListener('keydown', e => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault(); col.scrollTo({top: Math.min(count-1, Math.max(0, cur+d)) * WHEEL_ROW, behavior:'smooth'});
  });
  mark(value);
  // scrollTop only sticks once the column is in the page
  requestAnimationFrame(() => { col.scrollTop = value * WHEEL_ROW; });
  return col;
}

// Day carousel (‹ Today ›) plus an hour/minute wheel, instead of a full calendar picker.
// value may be null (e.g. no end time yet); the day then defaults to fallback's day,
// and clearable fields offer Set time / Clear.
function dateTimeInput(id, value, fallback, onChange, clearable){
  let day = startOfDay(value || fallback || Date.now());
  let time = value ? hm(value) : '';
  const emit = () => {
    if (!time) return onChange(null);
    const [hh, mm] = time.split(':').map(Number);
    const d = new Date(day); d.setHours(hh, mm, 0, 0); onChange(d.getTime());
  };
  const label = h('span',{'aria-live':'polite'});
  const prev = h('button',{type:'button','aria-label':'Previous day',onclick:()=>step(-1)}, '‹');
  const next = h('button',{type:'button','aria-label':'Next day',onclick:()=>step(1)}, '›');
  const show = () => { label.textContent = day >= startOfDay(Date.now()) - DAY ? dayLabel(day) : new Date(day).toLocaleDateString(undefined, {weekday:'short', day:'numeric', month:'short'}); next.disabled = day >= startOfDay(Date.now()); };
  // step via noon so DST-shortened/lengthened days don't skip or repeat
  const step = n => { day = startOfDay(day + 12*HOUR + n*DAY); show(); emit(); };
  show();
  const timeBox = h('div',{class:'dt'});
  const drawTime = () => {
    if (!time) {
      timeBox.replaceChildren(h('button',{type:'button',id,class:'btn ghost',onclick:()=>{ time = hm(Date.now()); emit(); drawTime(); }}, 'Set time'));
      return;
    }
    const [hh, mm] = time.split(':').map(Number);
    timeBox.replaceChildren(
      h('div',{class:'wheel',id,role:'group'},
        wheelCol(24, hh, 'Hour', v => { time = pad(v)+time.slice(2); emit(); }),
        h('span',{class:'sep','aria-hidden':'true'}, ':'),
        wheelCol(60, mm, 'Minute', v => { time = time.slice(0,3)+pad(v); emit(); })),
      ...(clearable ? [h('button',{type:'button',class:'linkbtn clear',onclick:()=>{ time = ''; emit(); drawTime(); }}, 'Clear time')] : []));
  };
  drawTime();
  return h('div',{class:'dt'}, h('div',{class:'daypick'}, prev, label, next), timeBox);
}

function openLogSheet(entry){
  const isNew = !entry || !entry.id;
  const st = {kind:'feed', feedType:'bottle', start:Date.now(), end:null, amountMl:'', note:'', addingMed:false, newName:'', newIcon:'pill', ...(entry||{})};
  // saved medicines, plus this entry's own medicine if it was removed from the list since
  const medOptions = () => {
    const list = babies.find(b => b.id === babyId)?.medicines || [];
    return entry && entry.medId && !list.some(m => m.id === entry.medId)
      ? [...list, {id: entry.medId, name: entry.medName || 'Medicine', icon: entry.medIcon, removed: true}] : list;
  };
  const body = h('div',{class:'stack'});
  const draw = () => {
    body.replaceChildren();
    if (isNew) body.append(seg([['sleep','Sleep'],['feed','Feed'],['med','Medicine']], st.kind, v => { st.kind = v; draw(); }));
    if (st.kind === 'feed') {
      // Breast is no longer offered; it only appears when editing an older breast entry
      const types = [['bottle','Bottle'],['solids','Solids']];
      if (!isNew && entry.feedType === 'breast') types.unshift(['breast','Breast']);
      body.append(seg(types, st.feedType, v => { st.feedType = v; draw(); }));
      if (st.feedType === 'bottle') body.append(h('div',{class:'field'}, h('label',{class:'label',for:'f-ml'}, 'Amount (ml)'),
        h('input',{id:'f-ml',type:'number',inputmode:'numeric',min:'0',step:'5',value:st.amountMl||'',oninput:e=>st.amountMl=e.target.value})));
    }
    if (st.kind === 'med') {
      const saved = medOptions();
      if (!saved.length) st.addingMed = true;
      const picked = !st.addingMed && saved.find(m => m.id === st.medId);
      if (saved.length) body.append(h('div',{class:'field'}, h('div',{class:'label'}, 'Medicine'),
        h('div',{class:'chips'},
          saved.map(m => h('button',{type:'button','aria-pressed':String(picked===m),onclick:()=>{ st.medId = m.id; st.addingMed = false; draw(); }}, medIcon(m.icon), m.name)),
          h('button',{type:'button','aria-pressed':String(st.addingMed),onclick:()=>{ st.addingMed = true; draw(); }}, '+ New')),
        picked && !picked.removed ? h('button',{type:'button',class:'linkbtn',onclick:()=>{ removeMedicine(picked.id); st.medId = null; draw(); }}, 'Remove '+picked.name+' from saved medicines') : null));
      if (st.addingMed) {
        body.append(h('div',{class:'field'}, h('label',{class:'label',for:'m-name'}, 'New medicine'),
          h('input',{id:'m-name',type:'text',placeholder:'Name, e.g. Paracetamol',value:st.newName,oninput:e=>st.newName=e.target.value})));
        body.append(h('div',{class:'field'}, h('div',{class:'label'}, 'Icon'),
          h('div',{class:'icons'}, MED_ICONS.map(([k,label]) => h('button',{type:'button','aria-pressed':String(st.newIcon===k),onclick:()=>{ st.newIcon = k; draw(); }}, medIcon(k), label)))));
      }
    }
    const showEnd = st.kind === 'sleep' || st.feedType === 'breast';
    body.append(h('div',{class:showEnd?'two':''},
      h('div',{class:'field'}, h('label',{class:'label',for:'f-start'}, st.kind==='sleep'?'Fell asleep':st.kind==='med'?'Given':'Started'),
        dateTimeInput('f-start', st.start, st.start, v => st.start = v)),
      showEnd ? h('div',{class:'field'}, h('label',{class:'label',for:'f-end'}, st.kind==='sleep'?'Woke up':'Ended'),
        dateTimeInput('f-end', st.end, st.start, v => st.end = v, true)) : null));
    body.append(h('div',{class:'field'}, h('label',{class:'label',for:'f-note'}, 'Note'),
      h('input',{id:'f-note',type:'text',placeholder:st.kind==='med'?'Optional, e.g. dose':'Optional',value:st.note||'',oninput:e=>st.note=e.target.value})));
  };
  draw();
  const msg = h('div',{class:'msg'});
  const save = async () => {
    if (!st.start) { msg.textContent = 'Set a start time.'; return; }
    const showEnd = st.kind === 'sleep' || st.feedType === 'breast';
    if (showEnd && st.end && st.end < st.start) { msg.textContent = 'The end time is before the start time.'; return; }
    const data = {kind:st.kind, start:st.start, end: showEnd ? (st.end||null) : st.start, note: (st.note||'').trim()};
    if (st.kind === 'feed') { data.feedType = st.feedType; if (st.feedType==='bottle') data.amountMl = Number(st.amountMl)||0; }
    if (st.kind === 'med') {
      let m;
      if (st.addingMed) {
        const name = st.newName.trim();
        if (!name) { msg.textContent = 'Enter a name for the medicine.'; return; }
        m = addMedicine(name, st.newIcon);
      } else m = medOptions().find(x => x.id === st.medId);
      if (!m) { msg.textContent = 'Choose a medicine.'; return; }
      Object.assign(data, {medId: m.id, medName: m.name, medIcon: m.icon});
    }
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
