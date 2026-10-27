// Runs only on tronclass.scu.edu.tw. Uses the user's existing browser session.
// It never reads or stores the school's username, password, or session cookies.
(() => {
  if (location.hostname !== 'tronclass.scu.edu.tw') return;

  const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
  const timeParts = (value) => {
    if (!value) return null;
    const source = String(value).trim();
    const local = source.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/);
    if (local) return { date: local[1], time: local[2] };
    const instant = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(source);
    if (!Number.isFinite(instant.getTime())) return null;
    const pieces = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23',
    }).formatToParts(instant).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    return { date: `${pieces.year}-${pieces.month}-${pieces.day}`, time: `${pieces.hour}:${pieces.minute}` };
  };

  async function getJson(path) {
    const response = await fetch(path, { credentials: 'include', headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (response.status === 401 || response.status === 403) throw new Error('TronClass 登入已失效，請先在東吳 TronClass 重新登入。');
    if (!response.ok) throw new Error(`TronClass API 回傳 ${response.status}。`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) throw new Error('尚未登入 TronClass，或學校的資料介面已變更。');
    return response.json();
  }

  function normalizeHomework(course, activity) {
    if (!activity || activity.id == null || course.id == null) return null;
    const courseName = text(course.name, 120), originalTitle = text(activity.title || activity.name, 180);
    if (!courseName || !originalTitle) return null;
    const due = timeParts(activity.due_at || activity.end_at || activity.end_time || activity.deadline || activity.close_at);
    const open = timeParts(activity.start_at || activity.open_at || activity.start_time || activity.begin_at);
    const statusText = text(activity.status, 50).toLowerCase();
    const submitted = !!activity.submitted_at || !!activity.is_submitted || /submitted|completed|finished|已繳|已交/.test(statusText);
    const explicitPending = /pending|unsubmitted|not_submitted|未繳|未交/.test(statusText);
    const link = text(activity.url || activity.link || '', 500);
    return {
      key: `tron:${course.id}:${activity.id}`,
      course: courseName, courseId: String(course.id), activityId: String(activity.id),
      originalTitle, title: `${courseName}｜${originalTitle}`,
      startDate: (open || due)?.date || '', startTime: open?.time || '00:00',
      date: due?.date || '', time: due?.time || '',
      status: submitted ? '已繳' : explicitPending ? '未繳' : '待確認',
      kind: 'task', category: '考試／報告',
      description: text(activity.description || activity.content, 500),
      link: /^https:\/\/tronclass\.scu\.edu\.tw(?:\/|$)/.test(link) ? link : 'https://tronclass.scu.edu.tw/',
      source: 'auto',
    };
  }

  async function scan() {
    if (document.querySelector('input[type="password"]')) throw new Error('請先登入 TronClass 再同步。');
    const coursesResult = await getJson('/api/my-courses?conditions=' + encodeURIComponent(JSON.stringify({ status: 'ongoing' })));
    const courses = coursesResult?.courses;
    if (!Array.isArray(courses)) throw new Error('TronClass 課程資料格式不符，請確認學校平台是否更新。');
    if (!courses.length) throw new Error('沒有找到進行中的課程；請確認 TronClass 的學期與登入狀態。');
    if (courses.length > 60) throw new Error('課程數量異常，已停止同步避免大量請求。');
    const assignments = [];
    for (const course of courses) {
      if (!Number.isSafeInteger(Number(course.id))) continue;
      let page = 1, pages = 1;
      do {
        const result = await getJson(`/api/courses/${encodeURIComponent(course.id)}/homework-activities?page=${page}&page_size=100`);
        if (!Array.isArray(result.homework_activities)) throw new Error(`${course.name || '某堂課'}的作業資料格式不符。`);
        for (const raw of result.homework_activities) {
          const item = normalizeHomework(course, raw);
          if (item) assignments.push(item);
        }
        pages = Math.min(20, Math.max(1, Number(result.pages) || Math.ceil((Number(result.total) || 0) / (Number(result.page_size) || 100)) || 1));
        page++;
      } while (page <= pages);
      if (assignments.length > 1500) throw new Error('作業資料過多，已停止同步以保護瀏覽器。');
    }
    return { source: 'tronclass.scu.edu.tw', fetchedAt: new Date().toISOString(), courses: courses.length, assignments };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'TRONCLASS_SCAN') return;
    scan().then(snapshot => sendResponse({ ok: true, snapshot }), error => sendResponse({ ok: false, error: error?.message || '同步失敗。' }));
    return true;
  });
})();
