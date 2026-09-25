// Expand a bounded window of a public iCloud iCalendar feed. The source URL is
// held in D1 settings and is never included in the shared state or responses.
const TAIPEI = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const pad = n => String(n).padStart(2, '0');
const dayKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const taipeiParts = date => Object.fromEntries(TAIPEI.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
function zonedInstant(year, month, day, hour, minute, zone) {
  if (!zone || zone === 'Asia/Taipei' || zone === 'ROC') return new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
  if (zone === 'UTC') return new Date(Date.UTC(year, month - 1, day, hour, minute));
  const target = Date.UTC(year, month - 1, day, hour, minute);
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    let guess = target;
    for (let i = 0; i < 3; i++) {
      const p = Object.fromEntries(formatter.formatToParts(new Date(guess)).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
      guess += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    }
    return new Date(guess);
  } catch { return new Date(target); }
}
function readDate(raw, zone) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(raw || '');
  if (!m) return null;
  const dateOnly = !m[4], y = +m[1], month = +m[2], d = +m[3], h = +(m[4] || 0), min = +(m[5] || 0);
  const instant = dateOnly ? zonedInstant(y, month, d, 0, 0, 'Asia/Taipei') : zonedInstant(y, month, d, h, min, m[7] ? 'UTC' : zone);
  return { instant, dateOnly, local: `${m[1]}-${m[2]}-${m[3]}`, hour: h, minute: min, zone: m[7] ? 'UTC' : zone };
}
function fields(chunk) {
  const result = {};
  for (const line of chunk.split('\n')) {
    const colon = line.indexOf(':'); if (colon < 0) continue;
    const key = line.slice(0, colon).split(';'), name = key.shift().toUpperCase();
    (result[name] ||= []).push({ value: line.slice(colon + 1), zone: key.find(x => /^TZID=/i.test(x))?.slice(5) || '' });
  }
  return result;
}
const value = (item, key) => item[key]?.[0]?.value || '';
const unescapeText = text => text.replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1');
const plusDays = (date, amount) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
const startOfWeek = date => plusDays(date, -((date.getDay() + 6) % 7));
function matchesRule(day, start, rule) {
  const delta = Math.round((Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000);
  if (delta < 0) return false;
  const parts = Object.fromEntries(rule.split(';').map(pair => pair.split('=')));
  const interval = Math.max(1, Number(parts.INTERVAL) || 1), weekdays = ['SU','MO','TU','WE','TH','FR','SA'];
  if (parts.BYMONTH && !parts.BYMONTH.split(',').includes(String(day.getMonth() + 1))) return false;
  if (parts.BYMONTHDAY && !parts.BYMONTHDAY.split(',').includes(String(day.getDate()))) return false;
  if (parts.BYDAY && !parts.BYDAY.split(',').some(x => x.replace(/^[+-]?\d+/, '') === weekdays[day.getDay()])) return false;
  if (parts.FREQ === 'DAILY') return delta % interval === 0;
  if (parts.FREQ === 'WEEKLY') {
    const weeks = Math.round((startOfWeek(day) - startOfWeek(start)) / 604800000);
    return weeks % interval === 0 && (parts.BYDAY ? true : day.getDay() === start.getDay());
  }
  const months = (day.getFullYear() - start.getFullYear()) * 12 + day.getMonth() - start.getMonth();
  if (parts.FREQ === 'MONTHLY') return months % interval === 0 && (parts.BYMONTHDAY || parts.BYDAY ? true : day.getDate() === start.getDate());
  if (parts.FREQ === 'YEARLY') return (day.getFullYear() - start.getFullYear()) % interval === 0 && (parts.BYMONTH || day.getMonth() === start.getMonth()) && (parts.BYMONTHDAY || day.getDate() === start.getDate());
  return false;
}
function uiDay(date) { const p = taipeiParts(date); return `${p.year}-${pad(p.month)}-${pad(p.day)}`; }
function uiTime(date) { const p = taipeiParts(date); return `${pad(p.hour)}:${pad(p.minute)}`; }
export function parseAppleCalendar(ics, from, to) {
  if (!ics.includes('BEGIN:VCALENDAR')) throw new Error('Apple 行事曆未回傳有效日曆');
  const unfolded = ics.replace(/\r?\n[ \t]/g, '').replace(/\r\n/g, '\n');
  const items = [...unfolded.matchAll(/BEGIN:VEVENT\n([\s\S]*?)END:VEVENT/g)].map(m => fields(m[1]));
  const overrides = new Map();
  for (const item of items) if (item['RECURRENCE-ID']) overrides.set(`${value(item,'UID')}|${value(item,'RECURRENCE-ID')}`, item);
  const output = [], fromDate = new Date(`${from}T00:00:00+08:00`), toDate = new Date(`${to}T23:59:59+08:00`);
  function append(item, start, end, seriesKey) {
    if (value(item,'STATUS') === 'CANCELLED' || !start || !end || end <= start || end < fromDate || start > toDate) return;
    const dateOnly = item['DTSTART']?.[0]?.value.length === 8;
    const title = unescapeText(value(item,'SUMMARY') || '未命名行程');
    const first = uiDay(start), last = uiDay(new Date(end.getTime() - 1));
    let current = new Date(`${first}T00:00:00+08:00`);
    for (let i = 0; i < 40 && uiDay(current) <= last; i++, current = new Date(current.getTime() + 86400000)) {
      const day = uiDay(current); if (day < from || day > to) continue;
      const beginning = Math.max(start.getTime(), current.getTime()), finish = Math.min(end.getTime(), current.getTime() + 86400000);
      const startLabel = dateOnly ? '00:00' : uiTime(new Date(beginning));
      const endLabel = dateOnly ? '23:59' : finish === current.getTime() + 86400000 ? '24:00' : uiTime(new Date(finish));
      output.push({ sourceId: `${value(item,'UID')}|${seriesKey}|${day}`, date: day, title, start: startLabel, end: endLabel, allDay: dateOnly, owner: 'peizi', category: '培茲', notes: unescapeText(value(item,'DESCRIPTION')).slice(0,500), source: 'apple' });
    }
  }
  for (const item of items) {
    if (item['RECURRENCE-ID']) continue;
    const original = readDate(value(item,'DTSTART'), item['DTSTART']?.[0]?.zone), finish = readDate(value(item,'DTEND'), item['DTEND']?.[0]?.zone);
    if (!original) continue;
    const duration = (finish?.instant.getTime() || original.instant.getTime() + (original.dateOnly ? 86400000 : 3600000)) - original.instant.getTime();
    if (duration <= 0) continue;
    const rule = value(item,'RRULE'), exclude = new Set((item.EXDATE || []).flatMap(x => x.value.split(','))), used = new Set();
    const candidates = rule ? (() => {
      const begin = new Date(original.local + 'T00:00:00'), ending = new Date(`${to}T00:00:00`), days = [], r = Object.fromEntries(rule.split(';').map(x => x.split('=')));
      let count = 0;
      for (let d = begin, n = 0; d <= ending && n < 5000; d = plusDays(d,1), n++) {
        if (!matchesRule(d, begin, rule)) continue;
        const local = `${dayKey(d).replace(/-/g,'')}T${pad(original.hour)}${pad(original.minute)}00`;
        const start = zonedInstant(d.getFullYear(),d.getMonth()+1,d.getDate(),original.hour,original.minute,original.zone);
        if (r.UNTIL && start > readDate(r.UNTIL,original.zone)?.instant) break;
        if (r.COUNT && count >= Number(r.COUNT)) break;
        count++; days.push({ local, start });
      }
      return days;
    })() : [{ local: value(item,'DTSTART'), start: original.instant }];
    for (const occurrence of candidates) {
      const possible = [occurrence.local, occurrence.local.slice(0,8), occurrence.local+'Z'];
      const override = possible.map(k => overrides.get(`${value(item,'UID')}|${k}`)).find(Boolean);
      if (override) {
        used.add(override);
        const changedStart = readDate(value(override,'DTSTART'),override['DTSTART']?.[0]?.zone)?.instant;
        const changedEnd = readDate(value(override,'DTEND'),override['DTEND']?.[0]?.zone)?.instant;
        append(override, changedStart, changedEnd || (changedStart && new Date(changedStart.getTime()+duration)), occurrence.local);
      } else if (!possible.some(k => exclude.has(k))) append(item, occurrence.start, new Date(occurrence.start.getTime()+duration), occurrence.local);
    }
  }
  // A moved occurrence can fall in the visible range when its original date is outside it.
  for (const override of overrides.values()) {
    const start = readDate(value(override,'DTSTART'),override['DTSTART']?.[0]?.zone)?.instant;
    if (start && !output.some(e => e.sourceId.startsWith(`${value(override,'UID')}|${value(override,'RECURRENCE-ID')}|`))) {
      const end = readDate(value(override,'DTEND'),override['DTEND']?.[0]?.zone)?.instant;
      append(override,start,end || new Date(start.getTime()+3600000),value(override,'RECURRENCE-ID'));
    }
  }
  return output.slice(0,3000).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
}

let cache = null;
export async function handleAppleCalendar(request, env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS calendar_sources (name TEXT PRIMARY KEY, url TEXT NOT NULL)').run();
  if (request.method === 'POST') {
    let body; try { body = await request.json(); } catch { return new Response('資料格式不正確', { status: 400 }); }
    const raw = String(body?.url || '').trim().replace(/^webcal:\/\//i,'https://');
    let url; try { url = new URL(raw); } catch { return new Response('連結格式不正確', { status: 400 }); }
    if (url.protocol !== 'https:' || !/^p\d+-caldav\.icloud\.com$/i.test(url.hostname) || !/^\/published\/2\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.search || url.hash) return new Response('請貼上 Apple 公開行事曆連結', { status: 400 });
    await env.DB.prepare('INSERT INTO calendar_sources(name,url) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET url=excluded.url').bind('peizi',url.href).run();
    cache = null;
    return new Response(JSON.stringify({ ok:true }), { headers:{'content-type':'application/json','cache-control':'no-store'} });
  }
  if (request.method !== 'GET') return new Response('不支援的操作', { status:405 });
  const source = await env.DB.prepare('SELECT url FROM calendar_sources WHERE name=?').bind('peizi').first();
  if (!source) return new Response(JSON.stringify({ configured:false,events:[] }), { headers:{'content-type':'application/json','cache-control':'no-store'} });
  const query = new URL(request.url).searchParams, today = new Date();
  const from = query.get('from') || uiDay(new Date(today.getTime()-30*86400000)), to = query.get('to') || uiDay(new Date(today.getTime()+180*86400000));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from || (Date.parse(to)-Date.parse(from))>370*86400000) return new Response('日期範圍不正確', { status:400 });
  try {
    if (!cache || cache.url !== source.url || Date.now()-cache.time > 300000) {
      const response = await fetch(source.url,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{accept:'text/calendar'}});
      if (!response.ok || Number(response.headers.get('content-length'))>3000000) throw new Error('Apple 行事曆目前無法讀取');
      const ics = await response.text(); if (ics.length>3000000) throw new Error('日曆內容過大');
      cache = {url:source.url,time:Date.now(),ics};
    }
    const events = parseAppleCalendar(cache.ics,from,to);
    return new Response(JSON.stringify({configured:true,events,updatedAt:new Date(cache.time).toISOString()}),{headers:{'content-type':'application/json','cache-control':'no-store'}});
  } catch {
    return new Response(JSON.stringify({configured:true,events:[],error:'暫時無法讀取 Apple 行事曆，原有行程不受影響。'}),{status:502,headers:{'content-type':'application/json','cache-control':'no-store'}});
  }
}
