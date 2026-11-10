import { handleAppleCalendar } from './apple-calendar.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function javascript(source, filename = "Time-Management-Widget.js", status = 200) {
  return new Response(source, {
    status,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "content-disposition": `attachment; filename=${filename}`,
      "cache-control": "no-store",
    },
  });
}

const STUDY_PLAN_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    estimatedMinutes: { type: "integer" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          minutes: { type: "integer" },
          note: { type: "string" },
        },
        required: ["title", "minutes", "note"],
      },
    },
  },
  required: ["summary", "estimatedMinutes", "steps"],
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || min));
}

function cleanText(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function fallbackStudyPlan(input) {
  const difficultyHours = { very_easy: 2.5, easy: 4, medium: 7, hard: 11, very_hard: 15 };
  const familiarityFactor = { 1: 1.35, 2: 1.2, 3: 1, 4: 0.82, 5: 0.68, 6: 0.55, 7: 0.45 };
  const daysFactor = input.daysLeft <= 2 ? 0.8 : input.daysLeft <= 5 ? 0.92 : 1;
  const total = Math.max(120, Math.round((difficultyHours[input.difficulty] || 7) * 60 * (familiarityFactor[input.familiarity] || 1) * daysFactor / 15) * 15);
  const topics = cleanText(input.scope, 1000).split(/[\n、,，；;]/).map((item) => item.trim()).filter(Boolean).slice(0, 5);
  const phases = topics.length ? topics.map((topic) => `理解與整理：${topic}`) : ["整理考試範圍與重點", "理解核心觀念", "題目練習"];
  phases.push("錯題整理與加強", "考前總複習");
  const weights = phases.map((_, index) => index === phases.length - 1 ? 0.14 : index === phases.length - 2 ? 0.18 : 0.68 / Math.max(1, phases.length - 2));
  const steps = phases.map((title, index) => ({
    title,
    minutes: Math.max(30, Math.round(total * weights[index] / 15) * 15),
    note: index === phases.length - 1 ? "快速回顧重點與容易出錯的地方" : index === phases.length - 2 ? "重做錯題並標記仍不熟悉的內容" : "完成後留下簡短筆記或練習紀錄",
  }));
  const adjustedTotal = steps.reduce((sum, step) => sum + step.minutes, 0);
  return {
    summary: `依照熟悉程度、難度與剩餘 ${Math.max(0, input.daysLeft)} 天，先建立可調整的準備計畫。`,
    estimatedMinutes: adjustedTotal,
    steps,
  };
}

function normalizeStudyPlan(plan, fallback) {
  const steps = Array.isArray(plan?.steps) ? plan.steps.map((step) => ({
    title: cleanText(step?.title, 80),
    minutes: Math.round(clamp(step?.minutes, 15, 600) / 15) * 15,
    note: cleanText(step?.note, 160),
  })).filter((step) => step.title).slice(0, 16) : [];
  if (steps.length < 2) return fallback;
  return {
    summary: cleanText(plan.summary, 300) || fallback.summary,
    estimatedMinutes: steps.reduce((sum, step) => sum + step.minutes, 0),
    steps,
  };
}

function parseStudyPlanResponse(raw) {
  if (raw && typeof raw === "object") return raw;
  const text = String(raw || "").trim();
  if (!text) throw new Error("AI did not return content");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try { return JSON.parse(candidate); } catch {}
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
  throw new Error("AI response was not valid JSON");
}

async function handleStudyPlan(request, env) {
  if (request.method !== "POST") return json({ error: "不支援的操作。" }, 405);
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "不允許跨網站使用。" }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "資料格式不正確。" }, 400); }
  const input = {
    title: cleanText(body?.title, 80),
    scope: cleanText(body?.scope, 1200),
    notes: cleanText(body?.notes, 500),
    familiarity: clamp(body?.familiarity, 1, 7),
    difficulty: ["very_easy", "easy", "medium", "hard", "very_hard"].includes(body?.difficulty) ? body.difficulty : "medium",
    target: cleanText(body?.target, 60) || "確實掌握並完成考試",
    daysLeft: Math.round(clamp(body?.daysLeft, 0, 365)),
  };
  if (!input.title) return json({ error: "缺少考試名稱。" }, 400);
  const fallback = fallbackStudyPlan(input);
  if (!env.AI) return json({ plan: fallback, source: "basic" });
  const prompt = `請為大學生拆解考試準備工作。只決定學習步驟與合理估時，不安排日期或時段。\n考試：${input.title}\n剩餘天數：${input.daysLeft}\n考試範圍：${input.scope || "尚未填寫，請以通用準備流程規劃"}\n補充：${input.notes || "無"}\n熟悉程度：${input.familiarity}/7\n難度：${input.difficulty}\n目標：${input.target}\n每一步需明確、可以實際勾選完成；分鐘數使用 15 分鐘的倍數。\n只回傳 JSON，不要 Markdown 或說明文字。格式：{"summary":"簡短策略","estimatedMinutes":整數,"steps":[{"title":"步驟名稱","minutes":整數,"note":"完成標準"}]}`;
  try {
    const result = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
      messages: [
        { role: "system", content: "你是務實的大學生讀書規劃助理。使用繁體中文，避免空泛建議，不排入行事曆、不虛構教材章節。" },
        { role: "user", content: prompt },
      ],
      guided_json: STUDY_PLAN_SCHEMA,
      max_tokens: 1600,
      temperature: 0.25,
    });
    const raw = result?.response ?? result?.choices?.[0]?.message?.content;
    const parsed = parseStudyPlanResponse(raw);
    const plan = normalizeStudyPlan(parsed, fallback);
    const usedAI = plan !== fallback;
    return json({
      plan,
      source: usedAI ? "ai" : "basic",
      ...(usedAI ? {} : { warning: "AI 回傳的內容不完整，已改用基本規則產生。" }),
    });
  } catch (error) {
    console.error("study plan AI failed", error);
    return json({ plan: fallback, source: "basic", warning: "AI 暫時無法回應，已改用基本規則產生。" });
  }
}

function todayWidgetRuntimeSource(_env, origin) {
  const source = String.raw`// 今日行程＋我的代辦 Widget（Scriptable）
// 由「時間管理」網站產生；請勿把這份程式碼分享給其他人。
const SITE_URL = "__SITE_URL__";
const API_URL = "__API_URL__";
const COMPLETE_URL = "__COMPLETE_URL__";
// Cloudflare Access Service Token is stored only in the Scriptable device Keychain.
function widgetAccessHeaders() {
  const id = Keychain.contains("tm_cf_access_id") ? Keychain.get("tm_cf_access_id") : "";
  const secret = Keychain.contains("tm_cf_access_secret") ? Keychain.get("tm_cf_access_secret") : "";
  return id && secret ? { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret } : {};
}

const PAPER = new Color("#ffffff"), INK = new Color("#202020"), MUTED = new Color("#8b8b8f");
const BLUE = new Color("#2488e8"), GREEN = new Color("#42c987"), GRID = new Color("#e8e8ec");

function pad(n) { return n < 10 ? "0" + n : String(n); }
function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function toMinutes(value) {
  const parts = String(value || "").split(":").map(Number);
  return parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) ? parts[0] * 60 + parts[1] : 1440;
}
function ownerName(owner) { return owner === "peizi" ? "培茲" : "俐華"; }
function completed(task, date) { return task.daily ? (task.completedDates || []).includes(date) : !!task.done; }
function categoryColor(name) {
  const category = (state.categories || []).find(function(item) { return item.name === name; });
  return category ? category.color : "#2488e8";
}
function orderTasks(a, b) {
  const aKey = (a.dueDate || "9999-12-31") + "T" + (a.dueTime || "23:59");
  const bKey = (b.dueDate || "9999-12-31") + "T" + (b.dueTime || "23:59");
  return aKey.localeCompare(bKey) || String(a.date || "").localeCompare(String(b.date || ""));
}

const now = new Date(), today = ymd(now);
const action = args.queryParameters && args.queryParameters.action;
const taskId = args.queryParameters && args.queryParameters.taskId;
let actionSucceeded = false;
if (action === "complete" && taskId) {
  try {
    const completeRequest = new Request(COMPLETE_URL);
    completeRequest.headers = widgetAccessHeaders();
    completeRequest.method = "POST";
    completeRequest.headers = { ...widgetAccessHeaders(), "Content-Type": "application/json" };
    completeRequest.body = JSON.stringify({ id: taskId, date: args.queryParameters.date || today });
    const result = await completeRequest.loadJSON();
    actionSucceeded = !!(result && result.ok);
  } catch (error) {}
}

const request = new Request(API_URL + "?refresh=" + Date.now());
request.headers = widgetAccessHeaders();
let payload = null, syncError = false;
try { payload = await request.loadJSON(); } catch (error) { syncError = true; }
const state = payload && payload.state ? payload.state : { events: [], tasks: [] };
const pendingTron = (state.tronInbox || []).filter(function(item) {
  return item && item.source === "auto" && item.term === state.tronLastAutoTerm && !item.resolved;
}).length;
const currentMinutes = now.getHours() * 60 + now.getMinutes();
const events = (state.events || []).filter(function(event) {
  return event.date === today && (event.allDay || toMinutes(event.end) > currentMinutes);
}).sort(function(a, b) {
  if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
  return String(a.start || "00:00").localeCompare(String(b.start || "00:00"));
});
const pending = (state.tasks || []).filter(function(task) {
  if (completed(task, today)) return false;
  return !task.daily || !task.date || task.date <= today;
}).sort(orderTasks);
const mine = pending.filter(function(task) { return task.owner !== "peizi"; });

function completeURL(task) {
  const base = URLScheme.forRunningScript();
  return base + (base.indexOf("?") >= 0 ? "&" : "?") + "openEditor=false&action=complete&taskId=" + encodeURIComponent(task.id) + "&date=" + today;
}
function addText(stack, value, size, color, bold) {
  const text = stack.addText(String(value));
  text.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  text.textColor = color;
  text.lineLimit = 1;
  text.minimumScaleFactor = 0.72;
  return text;
}
function addHead(column, symbol, title, count, color) {
  const head = column.addStack();
  head.centerAlignContent();
  addText(head, symbol, 13, color, true);
  head.addSpacer(5);
  addText(head, title, 14, INK, true);
  head.addSpacer();
  addText(head, count, 13, color, true);
}
function addEventColumn(parent, events) {
  const column = parent.addStack();
  column.layoutVertically();
  column.size = new Size(143, 0);
  addHead(column, "▣", "行程", events.length, BLUE);
  column.addSpacer(6);
  events.slice(0, 3).forEach(function(event, index) {
    if (index) column.addSpacer(4);
    const row = column.addStack();
    row.setPadding(1, 0, 1, 0);
    const marker = row.addStack();
    marker.size = new Size(4, 24);
    marker.cornerRadius = 2;
    marker.backgroundColor = new Color(categoryColor(event.category));
    row.addSpacer(7);
    const copy = row.addStack();
    copy.layoutVertically();
    addText(copy, event.title || "未命名行程", 10.5, INK, true);
    const timeText = event.allDay ? "全天" : (event.start || "") + (event.end ? "–" + event.end : "");
    const detail = [timeText, event.notes, ownerName(event.owner)].filter(Boolean).join(" · ");
    addText(copy, detail, 7.5, MUTED, false);
  });
  if (!events.length) {
    column.addSpacer(22);
    addText(column, "今天沒有行程", 10, MUTED, false);
  } else if (events.length > 3) {
    column.addSpacer(4);
    addText(column, "還有 +" + (events.length - 3) + " 項", 8, MUTED, false);
  }
}
function addTaskColumn(parent, tasks) {
  const column = parent.addStack();
  column.layoutVertically();
  column.size = new Size(143, 0);
  addHead(column, "●", "我的代辦", tasks.length, GREEN);
  column.addSpacer(6);
  tasks.slice(0, 3).forEach(function(task, index) {
    if (index) column.addSpacer(4);
    const row = column.addStack();
    const actionURL = completeURL(task);
    row.url = actionURL;
    row.centerAlignContent();
    row.setPadding(1, 0, 1, 0);
    const circle = addText(row, "○", 16, GREEN, false);
    circle.url = actionURL;
    row.addSpacer(6);
    const copy = row.addStack();
    copy.layoutVertically();
    addText(copy, task.title || "未命名任務", 10.5, INK, true);
    const dateText = task.daily ? "每日固定" : task.dueDate ? task.dueDate.slice(5).replace("-", "/") + " " + (task.dueTime || "23:59") : "無截止日期";
    addText(copy, dateText + (task.category ? " · " + task.category : ""), 7.5, MUTED, false);
  });
  if (!tasks.length) {
    column.addSpacer(22);
    addText(column, "目前沒有待辦", 10, MUTED, false);
  } else if (tasks.length > 3) {
    column.addSpacer(4);
    addText(column, "還有 +" + (tasks.length - 3) + " 項", 8, MUTED, false);
  }
}

const widget = new ListWidget();
widget.backgroundColor = PAPER;
widget.url = SITE_URL;
widget.setPadding(10, 12, 10, 12);
if (syncError || !payload || !payload.state) {
  const notice = widget.addStack();
  notice.centerAlignContent();
  addText(notice, "⚠ 資料讀取失敗：請確認 Widget 登入權限", 8, MUTED, false);
  widget.addSpacer(5);
} else if (pendingTron > 0) {
  const notice = widget.addStack();
  notice.centerAlignContent();
  addText(notice, "TronClass " + pendingTron + " 筆待確認（不會自動排入行程）", 8, MUTED, false);
  widget.addSpacer(5);
}
const content = widget.addStack();
content.layoutHorizontally();
addEventColumn(content, events);
content.addSpacer(9);
const divider = content.addStack();
divider.size = new Size(1, 124);
divider.backgroundColor = GRID;
content.addSpacer(9);
addTaskColumn(content, mine);
widget.refreshAfterDate = new Date(Date.now() + (actionSucceeded ? 60 * 1000 : 5 * 60 * 1000));
Script.setWidget(widget);
if (!config.runsInWidget) await widget.presentMedium();
Script.complete();
`;
  return source
    .replaceAll("__SITE_URL__", origin)
    .replaceAll("__API_URL__", origin + "/api/widget-state")
    .replaceAll("__COMPLETE_URL__", origin + "/api/widget-task-complete");
}

function calendarWidgetRuntimeSource(_env, origin) {
  const source = String.raw`// 時間管理主畫面 Widget（Scriptable）
// 由「時間管理」網站產生；請勿把這份程式碼分享給其他人。
const SITE_URL = "__SITE_URL__";
const API_URL = "__API_URL__";
// Cloudflare Access Service Token is stored only in the Scriptable device Keychain.
function widgetAccessHeaders() {
  const id = Keychain.contains("tm_cf_access_id") ? Keychain.get("tm_cf_access_id") : "";
  const secret = Keychain.contains("tm_cf_access_secret") ? Keychain.get("tm_cf_access_secret") : "";
  return id && secret ? { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret } : {};
}

const WIDTH = 329, HEIGHT = 345, SIDE = 10, HEADER = 68;
const CELL_WIDTH = (WIDTH - SIDE * 2) / 7;
const INK = new Color("#242424"), MUTED = new Color("#8a8a8a"), OUTSIDE = new Color("#c9c9c9");
const SUNDAY = new Color("#d94f55"), SATURDAY = new Color("#3267bd"), TODAY = new Color("#282828");
const GRID = new Color("#e9e9e9"), PAPER = new Color("#ffffff"), GREEN = new Color("#43c98d");

function pad(n) { return n < 10 ? "0" + n : String(n); }
function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function parseDate(value) { const p = value.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function addDays(date, amount) { const result = new Date(date); result.setDate(result.getDate() + amount); return result; }
function dayDiff(first, second) { return Math.round((parseDate(second) - parseDate(first)) / 86400000); }
function completed(task, date) { return task.daily ? (task.completedDates || []).includes(date) : !!task.done; }
function categoryColor(name, state) {
  const category = (state.categories || []).find(function(item) { return item.name === name; });
  return category ? category.color : "#df4e55";
}
function drawText(context, value, rect, size, color, bold, align) {
  context.setFont(bold ? Font.boldSystemFont(size) : Font.systemFont(size));
  context.setTextColor(color);
  if (align === "left") context.setTextAlignedLeft(); else context.setTextAlignedCenter();
  context.drawTextInRect(String(value), rect);
}
function rounded(context, rect, radius, color) {
  const path = new Path();
  path.addRoundedRect(rect, radius, radius);
  context.addPath(path);
  context.setFillColor(color);
  context.fillPath();
}
function rowTop(week, currentWeek) {
  let top = HEADER;
  for (let index = 0; index < week; index++) top += index === currentWeek ? 90 : 36;
  return top;
}
function rowHeight(week, currentWeek) { return week === currentWeek ? 90 : 36; }
function splitWeeks(item, calendarStart) {
  const parts = [];
  let cursor = parseDate(item.start), end = parseDate(item.end);
  while (cursor <= end) {
    const index = dayDiff(ymd(calendarStart), ymd(cursor));
    const week = Math.floor(index / 7), column = index % 7;
    const length = Math.min(7 - column, dayDiff(ymd(cursor), ymd(end)) + 1);
    parts.push({ title: item.title, color: item.color, week: week, startColumn: column, endColumn: column + length - 1 });
    cursor = addDays(cursor, length);
  }
  return parts;
}

const request = new Request(API_URL);
request.headers = widgetAccessHeaders();
let payload = null, syncError = false;
try { payload = await request.loadJSON(); } catch (error) { syncError = true; }
const state = payload && payload.state ? payload.state : { events: [], tasks: [], categories: [] };
const now = new Date(), today = ymd(now);
const monthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
const calendarStart = addDays(monthFirst, -monthFirst.getDay()), calendarEnd = addDays(calendarStart, 41);
const currentWeek = Math.max(0, Math.min(5, Math.floor(dayDiff(ymd(calendarStart), today) / 7)));
const records = [];
(state.events || []).forEach(function(event) {
  if (!event.allDay || !event.date || event.date < ymd(calendarStart) || event.date > ymd(calendarEnd)) return;
  records.push({ title: event.title || "未命名行程", start: event.date, end: event.date, color: categoryColor(event.category, state) });
});
(state.tasks || []).forEach(function(task) {
  if (completed(task, today)) return;
  if (task.daily) {
    const date = task.date <= today ? today : "";
    if (date && date >= ymd(calendarStart) && date <= ymd(calendarEnd)) records.push({ title: task.title || "未命名任務", start: date, end: date, color: categoryColor(task.category, state) });
    return;
  }
  const taskStart = task.date, taskEnd = task.dueDate || task.date;
  if (!taskStart || taskEnd < ymd(calendarStart) || taskStart > ymd(calendarEnd)) return;
  records.push({ title: task.title || "未命名任務", start: taskStart < ymd(calendarStart) ? ymd(calendarStart) : taskStart, end: taskEnd > ymd(calendarEnd) ? ymd(calendarEnd) : taskEnd, color: categoryColor(task.category, state) });
});
records.sort(function(a, b) { return a.title.localeCompare(b.title) || a.color.localeCompare(b.color) || a.start.localeCompare(b.start); });
const merged = [];
records.forEach(function(record) {
  const previous = merged[merged.length - 1];
  if (previous && previous.title === record.title && previous.color === record.color && dayDiff(previous.end, record.start) <= 1) {
    if (record.end > previous.end) previous.end = record.end;
  } else merged.push({ title: record.title, start: record.start, end: record.end, color: record.color });
});
const segments = [];
merged.forEach(function(item) { splitWeeks(item, calendarStart).forEach(function(part) { if (part.week >= 0 && part.week < 6) segments.push(part); }); });
segments.sort(function(a, b) { return a.week - b.week || a.startColumn - b.startColumn || a.endColumn - b.endColumn; });

const context = new DrawContext();
context.size = new Size(WIDTH, HEIGHT);
context.opaque = false;
context.respectScreenScale = true;
context.setFillColor(PAPER);
context.fillRect(new Rect(0, 0, WIDTH, HEIGHT));
drawText(context, now.getMonth() + 1 + "月", new Rect(16, 10, 70, 30), 22, INK, true, "left");
drawText(context, "＋", new Rect(WIDTH - 54, 6, 42, 35), 28, GREEN, false, "center");
if (syncError || !payload || !payload.state) drawText(context, "同步失敗", new Rect(105, 17, 120, 16), 9, SUNDAY, true, "center");
const weekdays = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
weekdays.forEach(function(label, column) {
  drawText(context, label, new Rect(SIDE + column * CELL_WIDTH, 43, CELL_WIDTH, 18), 10, column === 0 ? SUNDAY : (column === 6 ? SATURDAY : MUTED), false, "center");
});

for (let index = 0; index < 42; index++) {
  const date = addDays(calendarStart, index), week = Math.floor(index / 7), column = index % 7;
  const top = rowTop(week, currentWeek), height = rowHeight(week, currentWeek);
  context.setFillColor(GRID);
  context.fillRect(new Rect(SIDE, top, WIDTH - SIDE * 2, 0.6));
  let color = INK;
  if (date.getMonth() !== now.getMonth()) color = OUTSIDE;
  else if (column === 0) color = SUNDAY;
  else if (column === 6) color = SATURDAY;
  const dateRect = new Rect(SIDE + column * CELL_WIDTH, top + 4, CELL_WIDTH, 20);
  if (ymd(date) === today) {
    context.setFillColor(TODAY);
    context.fillEllipse(new Rect(SIDE + column * CELL_WIDTH + (CELL_WIDTH - 25) / 2, top + 1, 25, 25));
    drawText(context, date.getDate(), dateRect, 12, Color.white(), true, "center");
  } else drawText(context, date.getDate(), dateRect, 12, color, false, "center");
}

const lanes = Array.from({ length: 6 }, function() { return []; });
const hiddenCounts = [0, 0, 0, 0, 0, 0];
segments.forEach(function(segment) {
  const maxLanes = segment.week === currentWeek ? 4 : 3;
  let lane = -1;
  for (let candidate = 0; candidate < maxLanes; candidate++) {
    const used = lanes[segment.week][candidate] || [];
    const overlaps = used.some(function(item) { return !(segment.endColumn < item.start || segment.startColumn > item.end); });
    if (!overlaps) { lane = candidate; break; }
  }
  if (lane < 0) { hiddenCounts[segment.week] += 1; return; }
  if (!lanes[segment.week][lane]) lanes[segment.week][lane] = [];
  lanes[segment.week][lane].push({ start: segment.startColumn, end: segment.endColumn });
  const x = SIDE + segment.startColumn * CELL_WIDTH + 2;
  const endX = SIDE + (segment.endColumn + 1) * CELL_WIDTH - 2;
  const top = rowTop(segment.week, currentWeek);
  if (segment.week === currentWeek) {
    const y = top + 27 + lane * 14;
    rounded(context, new Rect(x, y, Math.max(10, endX - x), 12), 3, new Color(segment.color));
    drawText(context, segment.title, new Rect(x + 2, y + 1, Math.max(6, endX - x - 4), 10), 7, Color.white(), true, "center");
  } else {
    const y = top + 25 + lane * 4;
    rounded(context, new Rect(x, y, Math.max(10, endX - x), 2.6), 1.3, new Color(segment.color));
  }
});
hiddenCounts.forEach(function(count, week) {
  if (!count) return;
  const top = rowTop(week, currentWeek), y = top + (week === currentWeek ? 79 : 25);
  rounded(context, new Rect(WIDTH - SIDE - 34, y, 32, 10), 5, new Color("#f1f1f1"));
  drawText(context, "+" + count + "項", new Rect(WIDTH - SIDE - 34, y + 1, 32, 9), 6.5, MUTED, true, "center");
});

const widget = new ListWidget();
widget.backgroundImage = context.getImage();
widget.url = SITE_URL;
widget.setPadding(0, 0, 0, 0);
widget.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);
Script.setWidget(widget);
if (!config.runsInWidget) await widget.presentLarge();
Script.complete();
`;
  return source
    .replaceAll("__SITE_URL__", origin)
    .replaceAll("__API_URL__", origin + "/api/widget-state");
}

function courseWidgetRuntimeSource(env, origin) {
  const source = String.raw`// 本週課表 Widget（Scriptable）
const SITE_URL="__SITE_URL__",API_URL="__API_URL__";
// Cloudflare Access Service Token is stored only in the Scriptable device Keychain.
function widgetAccessHeaders() {
  const id = Keychain.contains("tm_cf_access_id") ? Keychain.get("tm_cf_access_id") : "";
  const secret = Keychain.contains("tm_cf_access_secret") ? Keychain.get("tm_cf_access_secret") : "";
  return id && secret ? { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret } : {};
}

const W=329,H=345,AXIS=29,TOP=67,BOTTOM=337,PAD=5;
const paper=new Color("#fff"),ink=new Color("#262626"),muted=new Color("#8b8b8b"),grid=new Color("#e8e8e8"),red=new Color("#ef4444");
function pad(n){return n<10?"0"+n:String(n)}
function ymd(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
function add(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function monday(d){const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-(x.getDay()+6)%7);return x}
function mins(t){const p=(t||"00:00").split(":").map(Number);return p[0]*60+p[1]}
function course(e){return !!e.isCourse||/(課程|上課|必修|選修)/.test(e.category||"")}
function color(name,s){const c=(s.categories||[]).find(function(x){return x.name===name});return c?c.color:"#58bfa6"}
function text(c,v,r,size,col,bold,left){c.setFont(bold?Font.boldSystemFont(size):Font.systemFont(size));c.setTextColor(col);left?c.setTextAlignedLeft():c.setTextAlignedCenter();c.drawTextInRect(String(v),r)}
function round(c,r,rad,col){const p=new Path();p.addRoundedRect(r,rad,rad);c.addPath(p);c.setFillColor(col);c.fillPath()}
function layout(items){const sorted=items.slice().sort(function(a,b){return mins(a.start)-mins(b.start)}),groups=[];let group=[],end=-1;sorted.forEach(function(e){const s=mins(e.start);if(group.length&&s>=end){groups.push(group);group=[];end=-1}group.push(e);end=Math.max(end,mins(e.end))});if(group.length)groups.push(group);const out=[];groups.forEach(function(g){const ends=[];const placed=g.map(function(e){let col=ends.findIndex(function(x){return x<=mins(e.start)});if(col<0)col=ends.length;ends[col]=mins(e.end);return{event:e,column:col}});placed.forEach(function(x){x.columns=Math.max(1,ends.length);out.push(x)})});return out}
let payload=null,error="";try{const req=new Request(API_URL);req.headers=widgetAccessHeaders();req.timeoutInterval=15;payload=await req.loadJSON();if(!payload||!payload.state)throw new Error("沒有同步資料")}catch(e){error=String(e)}
const state=payload&&payload.state?payload.state:{events:[],tasks:[],categories:[]},now=new Date(),start=monday(now),finish=add(start,6),days=Array.from({length:7},function(_,i){return add(start,i)});
const events=(state.events||[]).filter(function(e){return !e.allDay&&course(e)&&e.date>=ymd(start)&&e.date<=ymd(finish)}).sort(function(a,b){return a.date.localeCompare(b.date)||a.start.localeCompare(b.start)});
const tasks=(state.tasks||[]).filter(function(t){const d=t.dueDate||t.date;const done=t.daily?(t.completedDates||[]).includes(d):!!t.done;return d&&!t.daily&&!done&&d>=ymd(start)&&d<=ymd(finish)});
let first=8,last=18;if(events.length){first=Math.max(0,Math.floor(Math.min.apply(null,events.map(function(e){return mins(e.start)}))/60)-1);last=Math.min(24,Math.ceil(Math.max.apply(null,events.map(function(e){return mins(e.end)}))/60)+1);while(last-first<10&&last<24)last++;while(last-first<10&&first>0)first--}
const firstMin=first*60,lastMin=last*60,total=lastMin-firstMin,gridH=BOTTOM-TOP,dayW=(W-AXIS-PAD)/7,c=new DrawContext();c.size=new Size(W,H);c.opaque=false;c.respectScreenScale=true;c.setFillColor(paper);c.fillRect(new Rect(0,0,W,H));
text(c,"本週課表",new Rect(12,8,95,24),16,ink,true,true);text(c,error?"同步失敗":events.length+" 堂課",new Rect(108,11,100,18),9,error?new Color("#d94f55"):muted,!!error,false);text(c,"＋",new Rect(W-47,4,38,32),26,new Color("#43c98d"),false,false);
const names=["一","二","三","四","五","六","日"];days.forEach(function(d,i){const x=AXIS+i*dayW,today=ymd(d)===ymd(now);if(today)round(c,new Rect(x+3,37,dayW-6,27),7,new Color("#fff2c0"));text(c,names[i],new Rect(x,36,dayW,13),9,today?new Color("#986900"):muted,true,false);text(c,d.getDate(),new Rect(x,49,dayW,13),8,today?new Color("#986900"):muted,false,false);if(tasks.some(function(t){return(t.dueDate||t.date)===ymd(d)})){c.setFillColor(new Color("#ef8f38"));c.fillEllipse(new Rect(x+dayW-9,38,6,6))}});
for(let h=first;h<=last;h++){const y=TOP+((h*60-firstMin)/total)*gridH;text(c,pad(h)+":00",new Rect(0,y-6,AXIS-3,12),6.5,muted,false,false);c.setFillColor(grid);c.fillRect(new Rect(AXIS,y,W-AXIS-PAD,.6))}for(let i=0;i<=7;i++){c.setFillColor(new Color("#f1f1f1"));c.fillRect(new Rect(AXIS+i*dayW,TOP,.5,gridH))}
days.forEach(function(d,di){layout(events.filter(function(e){return e.date===ymd(d)})).forEach(function(item){const e=item.event,s=Math.max(firstMin,mins(e.start)),end=Math.min(lastMin,mins(e.end));if(end<=s)return;const cw=dayW/item.columns,x=AXIS+di*dayW+item.column*cw+1.5,y=TOP+((s-firstMin)/total)*gridH+1,bw=cw-3,bh=Math.max(11,((end-s)/total)*gridH-2);round(c,new Rect(x,y,bw,bh),4,new Color(color(e.category,state)));text(c,e.title,new Rect(x+2,y+2,bw-4,Math.min(12,bh-2)),6.5,Color.white(),true,false);if(bh>=23)text(c,e.start,new Rect(x+2,y+13,bw-4,9),5.5,Color.white(),false,false)})});
const ti=days.findIndex(function(d){return ymd(d)===ymd(now)}),nm=now.getHours()*60+now.getMinutes();if(ti>=0&&nm>=firstMin&&nm<=lastMin){const y=TOP+((nm-firstMin)/total)*gridH;c.setFillColor(red);c.fillRect(new Rect(AXIS,y,W-AXIS-PAD,1.5));c.fillEllipse(new Rect(AXIS-2,y-2,5,5))}
if(!error&&!events.length)text(c,"本週尚未安排課程",new Rect(90,190,165,20),10,muted,false,false);
const widget=new ListWidget();widget.backgroundImage=c.getImage();widget.url=SITE_URL;widget.setPadding(0,0,0,0);widget.refreshAfterDate=new Date(Date.now()+5*60*1000);Script.setWidget(widget);if(!config.runsInWidget)await widget.presentLarge();Script.complete();`;
  return source.replaceAll("__SITE_URL__", origin).replaceAll("__API_URL__", origin + "/api/widget-state");
}

function quadrantWidgetRuntimeSource(_env, origin, quadrant, transparent=false) {
  const source = String.raw`// 每日四象限任務 Widget（Scriptable）
const SITE="__SITE__",API="__API__",COMPLETE="__COMPLETE__",Q="__Q__",TRANSPARENT=__TRANSPARENT__;
function headers(){const i=Keychain.contains("tm_cf_access_id")?Keychain.get("tm_cf_access_id"):"",k=Keychain.contains("tm_cf_access_secret")?Keychain.get("tm_cf_access_secret"):"";return i&&k?{"CF-Access-Client-Id":i,"CF-Access-Client-Secret":k}:{}}
function pad(n){return n<10?"0"+n:String(n)}
function date(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
function minus(d,n){const x=new Date(d+"T12:00:00");x.setDate(x.getDate()-n);return date(x)}
function done(t,d){return t.daily?(t.completedDates||[]).includes(d):!!t.done}
function quadrant(t,d){if(t.daily)return "in";if(t.dueDate&&/^\d{4}-\d{2}-\d{2}$/.test(t.dueDate)&&d>=minus(t.dueDate,2)&&!done(t,d))return "iu";return ["iu","in","nu","nn"].includes(t.quadrant)?t.quadrant:t.priority==="high"?"iu":t.priority==="medium"?"in":"nn"}
function active(t,d){return !!t.date&&(t.daily?t.date<=d:t.date<=d&&d<=(t.dueDate&&t.dueDate>=t.date?t.dueDate:t.date))}
const QUADS={iu:["重要且緊急","!","#bf5148","#fff0e8"],in:["重要但不緊急","✦","#318876","#ebf7f1"],nu:["緊急但較不重要","↗","#ac8035","#fff7e6"],nn:["不緊急也不重要","·","#758197","#f0f2f6"]};
const [name,symbol,color,pale]=QUADS[Q],today=date(new Date());
let updated=false;
if(args.queryParameters?.action==="complete"&&args.queryParameters.taskId){
  try{const req=new Request(COMPLETE);req.method="POST";req.headers={...headers(),"Content-Type":"application/json"};req.body=JSON.stringify({id:String(args.queryParameters.taskId),date:today});updated=!!(await req.loadJSON()).ok}catch(e){}
}
let state=null,failed=false;
try{const req=new Request(API+"?r="+Date.now());req.headers=headers();req.timeoutInterval=20;state=(await req.loadJSON()).state;if(!Array.isArray(state.tasks))throw Error("empty")}catch(e){failed=true}
const tasks=failed?[]:state.tasks.filter(t=>active(t,today)&&quadrant(t,today)===Q).sort((a,b)=>Number(done(a,today))-Number(done(b,today))||String(a.dueDate||"9999").localeCompare(String(b.dueDate||"9999"))||String(a.startTime||"").localeCompare(String(b.startTime||"")));
const count=tasks.filter(t=>!done(t,today)).length,small=config.widgetFamily==="small",large=config.widgetFamily==="large",limit=small?3:large?10:5;
const widget=new ListWidget();widget.backgroundColor=TRANSPARENT?new Color("#ffffff",0):new Color("#ffffff");widget.setPadding(13,13,11,13);widget.url=SITE;
function label(stack,v,size,clr,bold){const t=stack.addText(String(v));t.font=bold?Font.boldSystemFont(size):Font.systemFont(size);t.textColor=new Color(clr);t.lineLimit=1;t.minimumScaleFactor=.7;return t}
const head=widget.addStack();head.centerAlignContent();const icon=head.addStack();icon.backgroundColor=TRANSPARENT?new Color(pale,.22):new Color(pale);icon.size=new Size(25,25);icon.cornerRadius=7;icon.centerAlignContent();label(icon,symbol,17,color,true);head.addSpacer(7);label(head,name,small?11:15,"#2d2d2d",true);head.addSpacer();label(head,count,small?16:21,color,true);
widget.addSpacer(9);const rule=widget.addStack();rule.size=new Size(0,1);rule.backgroundColor=TRANSPARENT?new Color("#808080",.22):new Color("#efede9");widget.addSpacer(8);
if(failed){label(widget,"無法讀取任務",11,"#be5044",true);label(widget,"請檢查安全連線",9,"#999",false)}
else if(!tasks.length){widget.addSpacer(13);label(widget,"今天沒有任務",11,"#999",false)}
else tasks.slice(0,limit).forEach((t,i)=>{if(i)widget.addSpacer(small?7:10);const row=widget.addStack();row.centerAlignContent();if(!done(t,today)){const base=URLScheme.forRunningScript();row.url=base+(base.includes("?")?"&":"?")+"openEditor=false&action=complete&taskId="+encodeURIComponent(String(t.id))}label(row,done(t,today)?"✓":"○",small?13:16,done(t,today)?"#aaa":color,true);row.addSpacer(7);const col=row.addStack();col.layoutVertically();label(col,t.title||"未命名任務",small?10:12,done(t,today)?"#a0a0a0":"#303030",!done(t,today));if(!small)label(col,done(t,today)?"已完成":t.daily?"每日固定":t.dueDate?t.dueDate.slice(5).replace("-","/")+" 截止":"今日任務",9,"#999",false)});
if(tasks.length>limit){widget.addSpacer(5);label(widget,"還有 "+(tasks.length-limit)+" 項",9,"#999",false)}
widget.addSpacer();const footer=widget.addStack();label(footer,today.slice(5).replace("-","/"),9,"#aaa",false);footer.addSpacer();label(footer,count+" 待完成",9,"#aaa",false);
widget.refreshAfterDate=new Date(Date.now()+(updated?60000:300000));Script.setWidget(widget);
if(!config.runsInWidget){if(small)await widget.presentSmall();else if(large)await widget.presentLarge();else await widget.presentMedium()}Script.complete();
`;
  return source.replaceAll("__SITE__",origin).replaceAll("__API__",origin+"/api/widget-state").replaceAll("__COMPLETE__",origin+"/api/widget-task-complete").replaceAll("__Q__",quadrant).replaceAll("__TRANSPARENT__",transparent?"true":"false");
}
function quadrantWidgetSource(env,origin,quadrant,transparent=false){return widgetLoaderSource(env,origin,"quadrant:"+quadrant+(transparent?":transparent":""))}

function quickAddWidgetRuntimeSource(_env, origin) {
  const source = String.raw`// 快速新增任務／行程 Widget（Scriptable）
const API="__API__",SITE="__SITE__";
function credentials(){
  const id=Keychain.contains("tm_cf_access_id")?Keychain.get("tm_cf_access_id"):"";
  const secret=Keychain.contains("tm_cf_access_secret")?Keychain.get("tm_cf_access_secret"):"";
  return id&&secret?{"CF-Access-Client-Id":id,"CF-Access-Client-Secret":secret}:{};
}
function two(v){return v<10?"0"+v:String(v)}
function ymd(d){return d.getFullYear()+"-"+two(d.getMonth()+1)+"-"+two(d.getDate())}
function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+"T12:00:00");return !Number.isNaN(d.getTime())&&ymd(d)===value}
function validTime(value){return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)}
const today=ymd(new Date());
const choice=args.queryParameters&&args.queryParameters.quickAdd;
async function askField(title,message,fields){
  const alert=new Alert();alert.title=title;alert.message=message;
  fields.forEach(f=>alert.addTextField(f[0],f[1]||""));
  alert.addAction("下一步");alert.addCancelAction("取消");
  if(await alert.present()!==0)return null;
  return fields.map((_,i)=>alert.textFieldValue(i).trim());
}
async function notice(title,message){const alert=new Alert();alert.title=title;alert.message=message;alert.addAction("確定");await alert.present()}
async function addEntry(kind){
  const isTask=kind==="task";
  const basic=await askField(isTask?"新增任務":"新增行程","輸入名稱和日期，儲存後同步到時間管理網站。",[["名稱",""],["日期（YYYY-MM-DD）",today],["備註（可留空）",""]]);
  if(!basic)return;
  const [title,date,notes]=basic;
  if(!title||!validDate(date)){await notice("資料不完整","請填名稱，以及正確日期（例如 "+today+"）。");return}
  let payload={kind,title:title.slice(0,60),date,notes:notes.slice(0,500)};
  if(isTask){
    const extra=await askField("任務設定","截止日期可留空；空白代表只有當天。",[["截止日期（選填）",date],["四象限 1～4","2"]]);
    if(!extra)return;
    const [dueDate,number]=extra;
    if(dueDate&&!validDate(dueDate)){await notice("日期錯誤","截止日期請填 YYYY-MM-DD");return}
    if(dueDate&&dueDate<date){await notice("日期錯誤","截止日期不能早於開始日期");return}
    const quadrants={1:"iu",2:"in",3:"nu",4:"nn"};
    if(!quadrants[number]){await notice("分類錯誤","請填 1、2、3 或 4");return}
    payload={...payload,dueDate,quadrant:quadrants[number]};
  }else{
    const extra=await askField("行程時間","請使用 24 小時制，例如 09:00。",[["開始時間","09:00"],["結束時間","10:00"]]);
    if(!extra)return;
    const [start,end]=extra;
    if(!validTime(start)||!validTime(end)||end<=start){await notice("時間錯誤","請輸入有效的開始／結束時間，結束時間須晚於開始時間。");return}
    payload={...payload,start,end};
  }
  try{
    const req=new Request(API);req.method="POST";req.headers={...credentials(),"Content-Type":"application/json"};req.body=JSON.stringify(payload);req.timeoutInterval=20;
    const response=await req.loadJSON();
    if(!response||!response.ok)throw new Error(response&&response.error||"儲存失敗");
    await notice("新增成功","已同步至時間管理網站。");
  }catch(error){await notice("新增失敗",String(error)+"\n請檢查網路及 Cloudflare Access 連線。")}
}
if(!config.runsInWidget&&(choice==="task"||choice==="event"))await addEntry(choice);
const widget=new ListWidget();widget.backgroundColor=new Color("#ffffff");widget.setPadding(14,14,12,14);widget.url=SITE;
function text(stack,value,size,color,bold){const item=stack.addText(value);item.font=bold?Font.boldSystemFont(size):Font.systemFont(size);item.textColor=new Color(color);item.lineLimit=1;item.minimumScaleFactor=.75;return item}
const small=config.widgetFamily==="small";
text(widget,"QUICK ADD",9,"#ba953d",true);
widget.addSpacer(5);text(widget,"快速新增",small?16:19,"#2b2923",true);widget.addSpacer(small?11:16);
function linkButton(title,symbol,kind,color){
  const row=widget.addStack();row.layoutHorizontally();row.centerAlignContent();row.setPadding(small?8:11,12,small?8:11,12);row.backgroundColor=new Color(color);row.cornerRadius=12;
  const url=URLScheme.forRunningScript();row.url=url+(url.includes("?")?"&":"?")+"openEditor=false&quickAdd="+kind;
  text(row,symbol,small?15:18,"#614b24",true);row.addSpacer(9);text(row,title,small?13:15,"#352b20",true);row.addSpacer();text(row,"＋",small?14:18,"#725c3b",true);
}
linkButton("新增任務","☑","task","#fff2cf");widget.addSpacer(9);linkButton("新增行程","▦","event","#e9f6ef");
widget.addSpacer();if(!small)text(widget,"點選後輸入，完成即同步",9,"#9a9489",false);
widget.refreshAfterDate=new Date(Date.now()+10*60*1000);
Script.setWidget(widget);if(!config.runsInWidget){if(small)await widget.presentSmall();else if(config.widgetFamily==="large")await widget.presentLarge();else await widget.presentMedium()}
Script.complete();
`;
  return source.replaceAll("__API__",origin+"/api/widget-quick-add").replaceAll("__SITE__",origin);
}

function widgetLoaderSource(_env, origin, kind) {
  const runtimePath = kind === "quick-add" ? "/api/widget-quick-add-runtime" : kind.startsWith("quadrant:") ? "/api/widget-quadrant-"+kind.split(":")[1]+(kind.endsWith(":transparent")?"-transparent":"")+"-runtime" : (kind === "today" ? "/api/widget-today-runtime" : (kind === "course" ? "/api/widget-course-runtime" : "/api/widget-calendar-runtime"));
  return String.raw`// 時間管理 Widget 自動更新載入器（Scriptable）
// 只需要安裝這一次；之後每次執行都會載入網站上的最新版。
const RUNTIME_URL = "__RUNTIME_URL__";
const tokenIdKey = "tm_cf_access_id", tokenSecretKey = "tm_cf_access_secret";
if (!Keychain.contains(tokenIdKey) || !Keychain.contains(tokenSecretKey)) {
  if (!config.runsInWidget) {
    const setup = new Alert();
    setup.title = "設定 Widget 安全連線";
    setup.message = "請填入 Cloudflare Access Service Token。憑證只會儲存在這台裝置的 Scriptable Keychain，不會寫入網站程式。";
    setup.addTextField("Client ID");
    setup.addSecureTextField("Client Secret");
    setup.addAction("儲存並連線");
    setup.addCancelAction("取消");
    if (await setup.present() === 0) {
      const id = setup.textFieldValue(0).trim();
      const secret = setup.textFieldValue(1).trim();
      if (id && secret) { Keychain.set(tokenIdKey, id); Keychain.set(tokenSecretKey, secret); }
    }
  }
}
try {
  if (!Keychain.contains(tokenIdKey) || !Keychain.contains(tokenSecretKey)) throw new Error("請先在 Scriptable App 執行此程式以設定連線");
  const request = new Request(RUNTIME_URL);
  request.headers = {
    "CF-Access-Client-Id": Keychain.get(tokenIdKey),
    "CF-Access-Client-Secret": Keychain.get(tokenSecretKey)
  };
  const latestCode = await request.loadString();
  if (/<!doctype html|<html[\\s>]/i.test(latestCode.slice(0,200))) throw new Error("Cloudflare Access 尚未授權此裝置");
  await eval("(async function(){\n" + latestCode + "\n})()");
} catch (error) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#ffffff");
  const title = widget.addText("Widget 更新失敗");
  title.font = Font.boldSystemFont(15);
  const detail = widget.addText(String(error).includes("Service") || String(error).includes("Scriptable") ? "請先打開 Scriptable App 執行 Widget 並設定安全連線" : "請檢查 Cloudflare Access 的 Service Auth 授權；資料未清空");
  detail.font = Font.systemFont(11);
  detail.textColor = new Color("#888888");
  Script.setWidget(widget);
  if (!config.runsInWidget) await widget.presentMedium();
  Script.complete();
}`
    .replaceAll("__RUNTIME_URL__", origin + runtimePath);
}

function widgetSource(env, origin) { return widgetLoaderSource(env, origin, "calendar"); }
function todayWidgetSource(env, origin) { return widgetLoaderSource(env, origin, "today"); }
function courseWidgetSource(env, origin) { return widgetLoaderSource(env, origin, "course"); }

function userId(request, env) {
  // This is intentionally a link-shared app: everyone opening the URL uses
  // the same D1 record, so no sign-in or password prompt is required.
  return env.SHARED_OWNER_ID || env.WIDGET_OWNER_USER_ID || "shared-calendar";
}

function quickAddPage(){return "<!doctype html>\n<html lang=\"zh-Hant\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\"><meta name=\"theme-color\" content=\"#fff9ed\"><meta name=\"apple-mobile-web-app-capable\" content=\"yes\"><meta name=\"apple-mobile-web-app-title\" content=\"快速新增\"><title>快速新增 | 時間管理</title><link rel=\"apple-touch-icon\" href=\"/time-management-icon.png\"><style>\n:root{color-scheme:light;font-family:Inter,\"Noto Sans TC\",-apple-system,BlinkMacSystemFont,\"PingFang TC\",sans-serif;background:#fff9ed;color:#292719}\n*{box-sizing:border-box}body{margin:0;min-height:100svh;background:radial-gradient(circle at 90% 0%,#fff1bf 0%,transparent 42%),#fff9ed}main{max-width:560px;margin:0 auto;padding:calc(env(safe-area-inset-top) + 29px) 21px calc(env(safe-area-inset-bottom) + 34px)}\n.brand{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:29px}.brand small{display:block;color:#ad9161;letter-spacing:.23em;font-size:10px;font-weight:800}.brand h1{font-size:29px;letter-spacing:.08em;margin:4px 0 0;line-height:1.25}.back{font-size:12px;color:#877761;text-decoration:none;background:#fff9;padding:10px 12px;border:1px solid #e8dcc5;border-radius:12px}\n.shell{background:#fff;border:1px solid #f0e7d8;border-radius:24px;padding:21px;box-shadow:0 14px 40px #775d2710}\n.tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:5px;border-radius:15px;background:#f8f3e9;margin-bottom:22px}.tabs button{border:0;background:transparent;border-radius:11px;padding:13px 4px;font-size:15px;color:#82776a;font-weight:760;cursor:pointer}.tabs button.active{color:#322717;background:#fff;box-shadow:0 2px 8px #74623b18}\nlabel{display:block;font-size:12px;font-weight:760;color:#6b6258;margin-bottom:8px}label span{color:#b05b3a}input,textarea,select{font:inherit;width:100%;border:1px solid #eadfcb;background:#fffdfa;border-radius:12px;padding:12px;color:#292719;min-height:46px;outline:none}input:focus,textarea:focus,select:focus{border-color:#d6ae46;box-shadow:0 0 0 3px #f8d97d40}textarea{resize:vertical;min-height:74px}.field{margin-bottom:17px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.toggle{display:flex;align-items:center;gap:9px;padding:4px 0 16px;color:#4d463e;font-weight:650;font-size:13px}.toggle input{width:18px;height:18px;min-height:0;accent-color:#d4a63b}\n.primary{width:100%;background:#f0bd43;border:1px solid #dfab30;color:#30260f;border-radius:14px;min-height:51px;font-size:16px;font-weight:850;cursor:pointer}.primary:disabled{opacity:.5;cursor:wait}.message{margin:14px 0 0;text-align:center;min-height:22px;font-size:13px;font-weight:700}.success{color:#32805f}.error{color:#bd4a42}.muted{color:#8b7f6b}.hidden{display:none!important}.note{font-size:11px;color:#a09480;margin-top:16px;text-align:center}@media(max-width:390px){main{padding-left:13px;padding-right:13px}.shell{padding:16px}.brand h1{font-size:26px}.pair{gap:8px}}\n</style></head><body><main><header class=\"brand\"><div><small>QUICK CAPTURE · 快速記錄</small><h1>快速新增<span style=\"color:#d7a62c\">.</span></h1></div></header>\n<section class=\"shell\"><div class=\"tabs\" role=\"tablist\" aria-label=\"新增類型\"><button type=\"button\" id=\"taskTab\" class=\"active\" aria-selected=\"true\">✓ 任務</button><button type=\"button\" id=\"eventTab\" aria-selected=\"false\">▦ 行程</button></div>\n<form id=\"form\"><div class=\"field\"><label for=\"title\">名稱 <span>*</span></label><input id=\"title\" name=\"title\" maxlength=\"60\" placeholder=\"要做什麼？\" autocomplete=\"off\" required autofocus></div>\n<div class=\"field\"><label for=\"date\">日期 <span>*</span></label><input id=\"date\" type=\"date\" name=\"date\" required></div>\n<div id=\"taskFields\"><div class=\"toggle\"><input id=\"daily\" type=\"checkbox\"><label for=\"daily\" style=\"margin:0;font-size:13px\">每日固定任務</label></div>\n<div class=\"field\" id=\"dueRow\"><label for=\"dueDate\">截止日期（選填）</label><input id=\"dueDate\" type=\"date\"></div>\n<div class=\"field\" id=\"quadrantRow\"><label for=\"quadrant\">任務象限</label><select id=\"quadrant\"><option value=\"in\">重要但不緊急</option><option value=\"iu\">重要且緊急</option><option value=\"nu\">緊急但較不重要</option><option value=\"nn\">不緊急也不重要</option></select></div></div>\n<div id=\"eventFields\" class=\"hidden\"><div class=\"pair\"><div class=\"field\"><label for=\"start\">開始時間</label><input id=\"start\" type=\"time\" value=\"09:00\"></div><div class=\"field\"><label for=\"end\">結束時間</label><input id=\"end\" type=\"time\" value=\"10:00\"></div></div></div>\n<div class=\"field\"><label for=\"notes\">備註（選填）</label><textarea id=\"notes\" maxlength=\"500\" placeholder=\"其他細節...\"></textarea></div>\n<button class=\"primary\" id=\"submit\" type=\"submit\">＋ 新增任務</button><p id=\"message\" class=\"message\" aria-live=\"polite\"></p></form></section><p class=\"note\">儲存後直接同步到時間管理網站</p></main>\n<script>\n(()=>{const $=id=>document.getElementById(id),p=n=>String(n).padStart(2,'0'),now=new Date(),today=now.getFullYear()+'-'+p(now.getMonth()+1)+'-'+p(now.getDate());let kind='task';$('date').value=today;$('dueDate').min=today;\nfunction mode(k){kind=k;const task=k==='task';$('taskTab').classList.toggle('active',task);$('eventTab').classList.toggle('active',!task);$('taskTab').setAttribute('aria-selected',task);$('eventTab').setAttribute('aria-selected',!task);$('taskFields').classList.toggle('hidden',!task);$('eventFields').classList.toggle('hidden',task);$('submit').textContent=task?'＋ 新增任務':'＋ 新增行程';$('message').textContent=''}\n$('taskTab').onclick=()=>mode('task');$('eventTab').onclick=()=>mode('event');\n$('date').onchange=()=>{if($('dueDate').value&&$('dueDate').value<$('date').value)$('dueDate').value=$('date').value;$('dueDate').min=$('date').value};\n$('daily').onchange=()=>{$('dueRow').classList.toggle('hidden',$('daily').checked);$('quadrant').value=$('daily').checked?'in':$('quadrant').value;$('quadrant').disabled=$('daily').checked};\nconst form=$('form');form.onsubmit=async ev=>{ev.preventDefault();const title=$('title').value.trim(),date=$('date').value;if(!title||!date)return;const body={kind,title,date,notes:$('notes').value.trim()};if(kind==='task'){body.daily=$('daily').checked;body.quadrant=body.daily?'in':$('quadrant').value;body.dueDate=body.daily?'':$('dueDate').value;if(body.dueDate&&body.dueDate<date){$('message').textContent='截止日期不能早於開始日期';$('message').className='message error';return}}else{body.start=$('start').value;body.end=$('end').value;if(body.end<=body.start){$('message').textContent='結束時間必須晚於開始時間';$('message').className='message error';return}}\nconst submit=$('submit');submit.disabled=true;$('message').className='message muted';$('message').textContent='儲存中…';try{const response=await fetch('/api/widget-quick-add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'儲存失敗');$('message').className='message success';$('message').textContent='✓ 已新增'+(kind==='task'?'任務':'行程');$('title').value='';$('notes').value='';$('title').focus()}catch(e){$('message').className='message error';$('message').textContent=e.message||'儲存失敗，請重試'}finally{submit.disabled=false}}})();\n</script></body></html>";}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if(url.pathname==="/quick-add"||url.pathname==="/quick-add/"){if(request.method!=="GET")return json({error:"不支援的操作。"},405);return new Response(quickAddPage(),{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});}
    if (url.pathname === '/api/apple-calendar') return handleAppleCalendar(request, env);
    if (url.pathname === '/api/ai/study-plan') return handleStudyPlan(request, env);
    if(url.pathname==="/api/widget-quick-add-script"){
      if(request.method!=="GET")return json({error:"不支援的操作。"},405);
      return javascript(widgetLoaderSource(env,url.origin,"quick-add"),"Time-Management-Quick-Add.js");
    }
    if(url.pathname==="/api/widget-quick-add-runtime"){
      if(request.method!=="GET")return json({error:"不支援的操作。"},405);
      return javascript(quickAddWidgetRuntimeSource(env,url.origin),"Time-Management-Quick-Add-Runtime.js");
    }
    if(url.pathname==="/api/widget-quick-add"){
      if(request.method!=="POST")return json({error:"不支援的操作。"},405);
      let body;
      try{body=await request.json()}catch{return json({error:"資料格式錯誤"},400)}
      const kind=body?.kind;
      if(kind!=="task"&&kind!=="event")return json({error:"只能新增任務或行程"},400);
      const title=cleanText(body.title,60),notes=cleanText(body.notes,500),date=body.date;
      const dateValid=(value)=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+"T12:00:00"))&&new Date(value+"T12:00:00").toISOString().slice(0,10)===value;
      const timeValid=(value)=>typeof value==="string"&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
      if(!title||!dateValid(date))return json({error:"名稱或日期無效"},400);
      if(kind==="task"&&body.dueDate&&(!dateValid(body.dueDate)||body.dueDate<date))return json({error:"截止日期無效"},400);
      if(kind==="task"&&body.quadrant&&!["iu","in","nu","nn"].includes(body.quadrant))return json({error:"四象限設定無效"},400);
      if(kind==="event"&&(!timeValid(body.start)||!timeValid(body.end)||body.end<=body.start))return json({error:"行程時間無效"},400);
      const uid=env.WIDGET_OWNER_USER_ID||userId(request,env);
      const row=await env.DB.prepare("SELECT state_json FROM user_state WHERE user_id=?").bind(uid).first();
      if(!row?.state_json)return json({error:"網站資料尚未初始化，請先開啟時間管理網站"},404);
      const state=JSON.parse(row.state_json);
      state.tasks=Array.isArray(state.tasks)?state.tasks:[];
      state.events=Array.isArray(state.events)?state.events:[];
      const id=crypto.randomUUID();
      const category=state.categories?.[0]?.name||"一般";
      if(kind==="task"){
        const daily=body.daily===true,dueDate=daily?"":body.dueDate||"",quadrant=daily?"in":body.quadrant||"in";
        const daysUntil=dueDate?Math.round((Date.parse(dueDate+"T12:00:00")-Date.now())/86400000):null;
        const finalQuadrant=!daily&&daysUntil!==null&&daysUntil<=2?"iu":quadrant;
        state.tasks.push({id,title,notes,date,category,owner:"me",startTime:"00:00",dueDate,dueTime:dueDate?"23:59":"",allDay:false,daily,quadrant:finalQuadrant,priority:finalQuadrant==="iu"?"high":finalQuadrant==="in"?"medium":"normal",reminderMinutes:"none",reminderSentFor:"",reminders:[],done:false,completedDates:[],subtasks:[]});
      }else{
        state.events.push({id,title,notes,date,category,owner:"me",start:body.start,end:body.end,allDay:false,isCourse:false,isExam:false,subtasks:[]});
      }
      await env.DB.batch([
        env.DB.prepare("INSERT INTO state_versions (user_id,state_json,created_at) VALUES (?,?,CURRENT_TIMESTAMP)").bind(uid,row.state_json),
        env.DB.prepare("INSERT INTO user_state (user_id,state_json,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json,updated_at=CURRENT_TIMESTAMP").bind(uid,JSON.stringify(state)),
      ]);
      return json({ok:true,id,kind});
    }

    if (url.pathname === "/api/widget-state") {
      if (request.method !== "GET") return json({ error: "不支援的操作。" }, 405);
      const row = await env.DB.prepare(
        "SELECT state_json, updated_at FROM user_state WHERE user_id = ?"
      ).bind(env.WIDGET_OWNER_USER_ID).first();
      return json(row ? { state: JSON.parse(row.state_json), updatedAt: row.updated_at } : { state: null });
    }

    if (url.pathname === "/api/widget-task-complete") {
      if (request.method !== "POST") return json({ error: "不支援的操作。" }, 405);
      let body;
      try { body = await request.json(); } catch { return json({ error: "資料格式不正確。" }, 400); }
      const taskId = typeof body?.id === "string" ? body.id : "";
      const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : "";
      if (!taskId || !date) return json({ error: "缺少任務資料。" }, 400);
      const row = await env.DB.prepare(
        "SELECT state_json FROM user_state WHERE user_id = ?"
      ).bind(env.WIDGET_OWNER_USER_ID).first();
      if (!row?.state_json) return json({ error: "找不到同步資料。" }, 404);
      const state = JSON.parse(row.state_json);
      // 舊版任務可能使用數字 ID，Widget 網址參數則一定是文字。
      const task = (state.tasks || []).find((item) => String(item.id) === taskId);
      if (!task) return json({ error: "找不到這個任務。" }, 404);
      if (task.daily) {
        task.completedDates = Array.isArray(task.completedDates) ? task.completedDates : [];
        if (!task.completedDates.includes(date)) task.completedDates.push(date);
      } else {
        task.done = true;
      }
      const payload = JSON.stringify(state);
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO state_versions (user_id, state_json, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)"
        ).bind(env.WIDGET_OWNER_USER_ID, row.state_json),
        env.DB.prepare(
          `INSERT INTO user_state (user_id, state_json, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = CURRENT_TIMESTAMP`
        ).bind(env.WIDGET_OWNER_USER_ID, payload),
      ]);
      return json({ ok: true, state });
    }

    const quadrantMatch=url.pathname.match(/^\/api\/widget-quadrant-(iu|in|nu|nn)-(transparent-)?(script|runtime)$/);
    if(quadrantMatch){
      if(request.method!=="GET")return json({error:"不支援的操作。"},405);
      const [,quadrant,transparentPart,kind]=quadrantMatch;
      const transparent=!!transparentPart;
      return javascript(kind==="script"?quadrantWidgetSource(env,url.origin,quadrant,transparent):quadrantWidgetRuntimeSource(env,url.origin,quadrant,transparent),"Task-Quadrant-"+quadrant+(transparent?"-Transparent":"")+".js");
    }
    if (url.pathname === "/api/widget-script") {
      return javascript(widgetSource(env, url.origin), "Time-Management-Calendar-Widget.js");
    }

    if (url.pathname === "/api/widget-calendar-runtime") {
      if (request.method !== "GET") return json({ error: "不支援的操作。" }, 405);
      return javascript(calendarWidgetRuntimeSource(env, url.origin), "Time-Management-Calendar-Runtime.js");
    }

    if (url.pathname === "/api/widget-today-script") {
      return javascript(todayWidgetSource(env, url.origin), "Time-Management-Today-Widget.js");
    }

    if (url.pathname === "/api/widget-today-runtime") {
      if (request.method !== "GET") return json({ error: "不支援的操作。" }, 405);
      return javascript(todayWidgetRuntimeSource(env, url.origin), "Time-Management-Today-Runtime.js");
    }

    if (url.pathname === "/api/widget-course-script") {
      return javascript(courseWidgetSource(env, url.origin), "Time-Management-Weekly-Course-Widget.js");
    }

    if (url.pathname === "/api/widget-course-runtime") {
      if (request.method !== "GET") return json({ error: "不支援的操作。" }, 405);
      return javascript(courseWidgetRuntimeSource(env, url.origin), "Time-Management-Weekly-Course-Runtime.js");
    }

    if (url.pathname === "/api/state/versions") {
      const uid = userId(request, env);
      if (!uid) return json({ error: "請先登入 ChatGPT。" }, 401);
      if (request.method !== "GET") return json({ error: "不支援的操作。" }, 405);
      const result = await env.DB.prepare(
        "SELECT id, created_at FROM state_versions WHERE user_id = ? ORDER BY id DESC LIMIT 20"
      ).bind(uid).all();
      return json({ versions: result.results || [] });
    }

    if (url.pathname === "/api/state/restore") {
      const uid = userId(request, env);
      if (!uid) return json({ error: "請先登入 ChatGPT。" }, 401);
      if (request.method !== "POST") return json({ error: "不支援的操作。" }, 405);
      let body;
      try { body = await request.json(); } catch { return json({ error: "資料格式不正確。" }, 400); }
      const versionId = Number(body?.id);
      if (!Number.isInteger(versionId) || versionId <= 0) return json({ error: "版本編號不正確。" }, 400);
      const version = await env.DB.prepare(
        "SELECT state_json FROM state_versions WHERE id = ? AND user_id = ?"
      ).bind(versionId, uid).first();
      if (!version) return json({ error: "找不到這個備份版本。" }, 404);
      const current = await env.DB.prepare(
        "SELECT state_json FROM user_state WHERE user_id = ?"
      ).bind(uid).first();
      const writes = [];
      if (current?.state_json) writes.push(env.DB.prepare(
        "INSERT INTO state_versions (user_id, state_json, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)"
      ).bind(uid, current.state_json));
      writes.push(env.DB.prepare(
        `INSERT INTO user_state (user_id, state_json, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = CURRENT_TIMESTAMP`
      ).bind(uid, version.state_json));
      await env.DB.batch(writes);
      return json({ ok: true, state: JSON.parse(version.state_json) });
    }

    if (url.pathname !== "/api/state") return env.ASSETS.fetch(request);

    const uid = userId(request, env);
    if (!uid) return json({ error: "請先登入 ChatGPT 後再使用同步功能。" }, 401);

    if (request.method === "GET") {
      const row = await env.DB.prepare(
        "SELECT state_json, updated_at FROM user_state WHERE user_id = ?"
      ).bind(uid).first();
      return json(row ? { state: JSON.parse(row.state_json), updatedAt: row.updated_at } : { state: null });
    }

    if (request.method === "PUT") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "資料格式不正確。" }, 400); }
      if (!body?.state || typeof body.state !== "object") return json({ error: "缺少可儲存的資料。" }, 400);
      const payload = JSON.stringify(body.state);
      if (payload.length > 800000) return json({ error: "資料量過大，請先匯出備份。" }, 413);
      const current = await env.DB.prepare(
        "SELECT state_json FROM user_state WHERE user_id = ?"
      ).bind(uid).first();
      const writes = [];
      if (current?.state_json && current.state_json !== payload) writes.push(env.DB.prepare(
        "INSERT INTO state_versions (user_id, state_json, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)"
      ).bind(uid, current.state_json));
      writes.push(env.DB.prepare(
        `INSERT INTO user_state (user_id, state_json, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = CURRENT_TIMESTAMP`
      ).bind(uid, payload));
      await env.DB.batch(writes);
      await env.DB.prepare(
        "DELETE FROM state_versions WHERE user_id = ? AND id NOT IN (SELECT id FROM state_versions WHERE user_id = ? ORDER BY id DESC LIMIT 20)"
      ).bind(uid, uid).run();
      return json({ ok: true });
    }

    return json({ error: "不支援的操作。" }, 405);
  },
};
