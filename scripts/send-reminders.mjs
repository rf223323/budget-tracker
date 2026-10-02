// Sends the daily Embalance reminders as Web Push notifications.
// Runs on a schedule in GitHub Actions (see .github/workflows/reminders.yml).
// It reads the synced budget from Firestore, works out what is due, and pushes one
// notification to each registered device. It never prints names or amounts to the log.
import webpush from 'web-push';

const TZ = 'Europe/London';
const {VAPID_PUBLIC, VAPID_PRIVATE, SYNC_CODE, FIREBASE_PROJECT, FIREBASE_API_KEY} = process.env;

function today(now = new Date()){
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(now);
  const g = t => Number(parts.find(p => p.type === t).value);
  return {y: g('year'), m: g('month'), d: g('day')};
}
function addDays({y, m, d}, n){
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return {y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate()};
}
function resolveDay(item, y, m){
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if(item.lastWeekday !== null && item.lastWeekday !== undefined){
    for(let d = dim; d >= 1; d--) if(new Date(Date.UTC(y, m - 1, d)).getUTCDay() === item.lastWeekday) return d;
    return null;
  }
  return item.day ? Math.min(item.day, dim) : null;
}
const key = ({y, m}) => `${y}-${String(m).padStart(2, '0')}`;
const money = (n, cur) => `${cur}${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-GB', {minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2})}`;

// Items still to happen (not marked done) that fall on a given day.
function itemsOn(state, date, list, kind){
  const month = state.months && state.months[key(date)];
  if(!month) return [];
  return (month[list] || []).filter(it =>
    it.status !== 'done' && !it.quickAdd && !it.transfer && (Number(it.amount) || 0) > 0 && resolveDay(it, date.y, date.m) === date.d
  );
}
function overdueBills(state, t){
  const month = state.months && state.months[key(t)];
  if(!month) return [];
  return (month.outgoings || []).filter(o => {
    if(o.status === 'done' || o.quickAdd || !((Number(o.amount) || 0) > 0)) return false;
    const d = resolveDay(o, t.y, t.m);
    return d && d < t.d;
  });
}
function listText(items, cur){
  const shown = items.slice(0, 3).map(i => `${i.name || 'Bill'} ${money(i.amount, cur)}`);
  return shown.join(', ') + (items.length > 3 ? ` +${items.length - 3} more` : '');
}
export function composeReminder(state, t){
  const cur = state.currency || '£';
  const lines = [];
  const pay = itemsOn(state, t, 'incoming');
  const payLike = pay.filter(i => i.recurring || i.category === 'Salary');
  if(payLike.length) lines.push(`Payday: ${listText(payLike, cur)} is due today`);
  const dueToday = itemsOn(state, t, 'outgoings');
  if(dueToday.length) lines.push(`Due today: ${listText(dueToday, cur)}`);
  const dueTomorrow = itemsOn(state, addDays(t, 1), 'outgoings');
  if(dueTomorrow.length) lines.push(`Due tomorrow: ${listText(dueTomorrow, cur)}`);
  const late = overdueBills(state, t);
  if(late.length) lines.push(`${late.length} overdue bill${late.length !== 1 ? 's' : ''} (${money(late.reduce((a, b) => a + (Number(b.amount) || 0), 0), cur)})`);
  if(!lines.length) return null;
  const title = payLike.length ? 'Payday today' : dueToday.length ? 'Bills due today' : dueTomorrow.length ? 'Bills due tomorrow' : 'Overdue bills';
  return {title, body: lines.join('\n'), url: './index.html'};
}

// Sundays: the weekly cosmetic spin is ready (the app grants it on the first open each week).
export function spinMessage(t){
  if(new Date(Date.UTC(t.y, t.m - 1, t.d)).getUTCDay() !== 0) return null;
  return {title: 'Your weekly spin is ready', body: 'Spin the wheel for a new cosmetic for your Ember.', url: './index.html?spin=1', tag: 'embalance-spin'};
}

function selfTest(){
  const assert = (c, m) => { if(!c){ console.error('SELFTEST FAILED:', m); process.exit(1); } };
  const state = {currency: '£', months: {'2026-10': {
    outgoings: [
      {name: 'Rent', amount: 694, day: 3, status: 'none'},
      {name: 'Electric', amount: 150, day: 2, status: 'none'},
      {name: 'Gym', amount: 30, day: 1, status: 'none'},
      {name: 'Done one', amount: 9, day: 2, status: 'done'},
      {name: 'Quick', amount: 5, day: 2, quickAdd: true, status: 'done'}
    ],
    incoming: [{name: 'Pay', amount: 2987, day: 2, status: 'none', recurring: true, category: 'Salary'}]
  }}};
  const r = composeReminder(state, {y: 2026, m: 10, d: 2});
  assert(r && r.title === 'Payday today', 'title');
  assert(r.body.includes('Due today: Electric £150'), 'due today');
  assert(r.body.includes('Due tomorrow: Rent £694'), 'due tomorrow');
  assert(r.body.includes('1 overdue bill (£30)'), 'overdue');
  assert(composeReminder(state, {y: 2026, m: 10, d: 20}) && composeReminder(state, {y: 2026, m: 10, d: 20}).title === 'Overdue bills', 'later overdue');
  assert(composeReminder({months: {}}, {y: 2026, m: 10, d: 2}) === null, 'nothing to send');
  assert(addDays({y: 2026, m: 10, d: 31}, 1).m === 11, 'month rollover');
  assert(spinMessage({y: 2026, m: 10, d: 4}) && spinMessage({y: 2026, m: 10, d: 4}).tag === 'embalance-spin', 'sunday spin');
  assert(spinMessage({y: 2026, m: 10, d: 5}) === null, 'no spin on monday');
  console.log('selftest ok');
}

const base = () => `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/budgets`;
async function readDoc(id){
  const res = await fetch(`${base()}/${encodeURIComponent(id)}?key=${FIREBASE_API_KEY}`);
  if(res.status === 404) return null;
  if(!res.ok) throw new Error(`Firestore read failed (${res.status})`);
  return res.json();
}

// One budget: read it, work out what's due, and push to every device registered for it.
async function runOne(code, label){
  const budgetDoc = await readDoc(code);
  if(!budgetDoc){ console.log(`${label}: no synced budget found for this code.`); return; }
  const pushDoc = await readDoc(`${code}__push`);
  const subs = pushDoc && pushDoc.fields && pushDoc.fields.subs ? JSON.parse(pushDoc.fields.subs.stringValue || '[]') : [];
  if(!subs.length){ console.log(`${label}: no devices have turned reminders on.`); return; }
  const state = JSON.parse(budgetDoc.fields.data.stringValue);
  const messages = [composeReminder(state, today()), spinMessage(today())].filter(Boolean);
  if(!messages.length){ console.log(`${label}: nothing due — no notification sent.`); return; }
  let sent = 0; const gone = [];
  for(const sub of subs){
    for(const msg of messages){
      try{ await webpush.sendNotification(sub, JSON.stringify(msg), {TTL: 6 * 3600}); sent++; }
      catch(e){ if(e.statusCode === 404 || e.statusCode === 410){ if(!gone.includes(sub.endpoint)) gone.push(sub.endpoint); break; } else console.log(`${label}: push failed (${e.statusCode || 'error'})`); }
    }
  }
  if(gone.length){
    const keep = subs.filter(s => !gone.includes(s.endpoint));
    await fetch(`${base()}/${encodeURIComponent(`${code}__push`)}?updateMask.fieldPaths=subs&key=${FIREBASE_API_KEY}`, {
      method: 'PATCH', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({fields: {subs: {stringValue: JSON.stringify(keep)}}})
    });
  }
  console.log(`${label}: notifications sent: ${sent}; removed ${gone.length} expired.`);
}

// SYNC_CODE can hold several budgets' sync codes, separated by commas or spaces.
async function main(){
  const codes = (SYNC_CODE || '').split(/[\s,]+/).filter(Boolean);
  if(!codes.length){ console.log('SYNC_CODE is not set — nothing to do.'); return; }
  if(!VAPID_PRIVATE || !VAPID_PUBLIC){ console.log('VAPID keys missing — nothing to do.'); return; }
  webpush.setVapidDetails('https://github.com/rf223323/budget-tracker', VAPID_PUBLIC, VAPID_PRIVATE);
  for(let i = 0; i < codes.length; i++){
    try{ await runOne(codes[i], `Budget ${i + 1} of ${codes.length}`); }
    catch(e){ console.log(`Budget ${i + 1} of ${codes.length}: failed (${e.message})`); process.exitCode = 1; }
  }
}

if(process.argv.includes('--selftest')) selfTest();
else main().catch(e => { console.error('Reminder run failed:', e.message); process.exit(1); });
