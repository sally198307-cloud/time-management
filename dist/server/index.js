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

function todayWidgetRuntimeSource(env, origin) {
  const source = String.raw`// 今日行程＋我的代辦 Widget（Scriptable）
// 由「時間管理」網站產生；請勿把這份程式碼分享給其他人。
const SITE_URL = "__SITE_URL__";
const API_URL = "__API_URL__";
const COMPLETE_URL = "__COMPLETE_URL__";
const SITE_ACCESS = "__SITE_ACCESS__";
const WIDGET_ACCESS = "__WIDGET_ACCESS__";

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
    completeRequest.method = "POST";
    completeRequest.headers = {
      "OAI-Sites-Authorization": "Bearer " + SITE_ACCESS,
      "X-Widget-Token": WIDGET_ACCESS,
      "Content-Type": "application/json"
    };
    completeRequest.body = JSON.stringify({ id: taskId, date: args.queryParameters.date || today });
    const result = await completeRequest.loadJSON();
    actionSucceeded = !!(result && result.ok);
  } catch (error) {}
}

const request = new Request(API_URL + "?refresh=" + Date.now());
request.headers = { "OAI-Sites-Authorization": "Bearer " + SITE_ACCESS, "X-Widget-Token": WIDGET_ACCESS };
let payload = null, syncError = false;
try { payload = await request.loadJSON(); } catch (error) { syncError = true; }
const state = payload && payload.state ? payload.state : { events: [], tasks: [] };
const currentMinutes = now.getHours() * 60 + now.getMinutes();
const events = (state.events || []).filter(function(event) {
  return event.date === today && toMinutes(event.end) > currentMinutes;
}).sort(function(a, b) {
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
    const detail = [(event.start || "") + (event.end ? "–" + event.end : ""), event.notes, ownerName(event.owner)].filter(Boolean).join(" · ");
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
widget.setPadding(12, 12, 12, 12);
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
    .replaceAll("__COMPLETE_URL__", origin + "/api/widget-task-complete")
    .replaceAll("__SITE_ACCESS__", env.WIDGET_SITE_ACCESS || "")
    .replaceAll("__WIDGET_ACCESS__", env.WIDGET_ACCESS_TOKEN || "");
}

function calendarWidgetRuntimeSource(env, origin) {
  const source = String.raw`// 時間管理主畫面 Widget（Scriptable）
// 由「時間管理」網站產生；請勿把這份程式碼分享給其他人。
const SITE_URL = "__SITE_URL__";
const API_URL = "__API_URL__";
const SITE_ACCESS = "__SITE_ACCESS__";
const WIDGET_ACCESS = "__WIDGET_ACCESS__";

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
request.headers = { "OAI-Sites-Authorization": "Bearer " + SITE_ACCESS, "X-Widget-Token": WIDGET_ACCESS };
let payload = null, syncError = false;
try { payload = await request.loadJSON(); } catch (error) { syncError = true; }
const state = payload && payload.state ? payload.state : { events: [], tasks: [], categories: [] };
const now = new Date(), today = ymd(now);
const monthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
const calendarStart = addDays(monthFirst, -monthFirst.getDay()), calendarEnd = addDays(calendarStart, 41);
const currentWeek = Math.max(0, Math.min(5, Math.floor(dayDiff(ymd(calendarStart), today) / 7)));
const records = [];
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
    .replaceAll("__API_URL__", origin + "/api/widget-state")
    .replaceAll("__SITE_ACCESS__", env.WIDGET_SITE_ACCESS || "")
    .replaceAll("__WIDGET_ACCESS__", env.WIDGET_ACCESS_TOKEN || "");
}

function courseWidgetRuntimeSource(env, origin) {
  const source = String.raw`// 本週課表 Widget（Scriptable）
const SITE_URL="__SITE_URL__",API_URL="__API_URL__";
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
let payload=null,error="";try{const req=new Request(API_URL);req.timeoutInterval=15;payload=await req.loadJSON();if(!payload||!payload.state)throw new Error("沒有同步資料")}catch(e){error=String(e)}
const state=payload&&payload.state?payload.state:{events:[],tasks:[],categories:[]},now=new Date(),start=monday(now),finish=add(start,6),days=Array.from({length:7},function(_,i){return add(start,i)});
const events=(state.events||[]).filter(function(e){return course(e)&&e.date>=ymd(start)&&e.date<=ymd(finish)}).sort(function(a,b){return a.date.localeCompare(b.date)||a.start.localeCompare(b.start)});
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

function widgetLoaderSource(env, origin, kind) {
  const runtimePath = kind === "today" ? "/api/widget-today-runtime" : (kind === "course" ? "/api/widget-course-runtime" : "/api/widget-calendar-runtime");
  return String.raw`// 時間管理 Widget 自動更新載入器（Scriptable）
// 只需要安裝這一次；之後每次執行都會載入網站上的最新版。
const RUNTIME_URL = "__RUNTIME_URL__";
const SITE_ACCESS = "__SITE_ACCESS__";
const WIDGET_ACCESS = "__WIDGET_ACCESS__";
try {
  const request = new Request(RUNTIME_URL);
  request.headers = { "OAI-Sites-Authorization": "Bearer " + SITE_ACCESS, "X-Widget-Token": WIDGET_ACCESS };
  const latestCode = await request.loadString();
  await eval("(async function(){\n" + latestCode + "\n})()");
} catch (error) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#ffffff");
  const title = widget.addText("Widget 更新失敗");
  title.font = Font.boldSystemFont(15);
  const detail = widget.addText("請確認網路後再試一次");
  detail.font = Font.systemFont(11);
  detail.textColor = new Color("#888888");
  Script.setWidget(widget);
  if (!config.runsInWidget) await widget.presentMedium();
  Script.complete();
}`
    .replaceAll("__RUNTIME_URL__", origin + runtimePath)
    .replaceAll("__SITE_ACCESS__", env.WIDGET_SITE_ACCESS || "")
    .replaceAll("__WIDGET_ACCESS__", env.WIDGET_ACCESS_TOKEN || "");
}

function widgetSource(env, origin) { return widgetLoaderSource(env, origin, "calendar"); }
function todayWidgetSource(env, origin) { return widgetLoaderSource(env, origin, "today"); }
function courseWidgetSource(env, origin) { return widgetLoaderSource(env, origin, "course"); }

function userId(request, env) {
  // This is intentionally a link-shared app: everyone opening the URL uses
  // the same D1 record, so no sign-in or password prompt is required.
  return env.SHARED_OWNER_ID || env.WIDGET_OWNER_USER_ID || "shared-calendar";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
