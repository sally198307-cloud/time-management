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

  // Match a semester from the school's course metadata. Course IDs are not semester numbers.
  // Taiwan's school-year calendar determines which named semester we are looking for,
  // but we never take courses from a different term just because they are marked ongoing.
  function currentAcademicTerm(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric',
    }).formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    const year = (parts.month >= 8 ? parts.year : parts.year - 1) - 1911;
    return String(year) + '-' + (parts.month >= 8 || parts.month === 1 ? '1' : '2');
  }

  function courseAcademicTerm(course, semesterIndex = new Map(), yearIndex = new Map()) {
    const semesterInfo = semesterIndex.get(String(course.semester_id ?? ''));
    const yearInfo = yearIndex.get(String(course.academic_year_id ?? semesterInfo?.academic_year_id ?? ''));
    course = {...course, semester: course.semester || course.semester_name || semesterInfo,
      academic_year: course.academic_year || course.academic_year_name || yearInfo};
    const name = v => typeof v === 'object' && v !== null
      ? String(v.name ?? v.title ?? v.display_name ?? '') : String(v ?? '');
    const academicYear = name(course.academic_year || course.academicYear ||
      course.academic_year_name || course.school_year || course.year).normalize('NFKC');
    const semester = name(course.semester || course.semester_name ||
      course.term || course.term_name).normalize('NFKC');
    const yearMatch = academicYear.match(/(?:^|[^\d])((?:1[01]\d|12\d|20\d{2}))(?!\d)/);
    let year = yearMatch ? Number(yearMatch[1]) : null;
    if (year >= 2000) year -= 1911;
    const semesterMatch = semester.match(/(?:^|[^\d])([12])(?!\d)/);
    let semesterNum = semesterMatch ? Number(semesterMatch[1]) : null;
    if (!semesterNum && /上學期|第一學期|秋季|fall|first/i.test(semester)) semesterNum = 1;
    if (!semesterNum && /下學期|第二學期|春季|spring|second/i.test(semester)) semesterNum = 2;
    // Names can include a combined term even when separate fields are unavailable.
    if (!year || !semesterNum) {
      const combined = [academicYear, semester, name(course.display_name),
        name(course.course_code || course.code)].join(' ').normalize('NFKC');
      const match = combined.match(/(?:^|[^\d])((?:1[01]\d|12\d|20\d{2}))\s*[-/／_]\s*([12])(?!\d)/);
      if (match) {
        year = Number(match[1]);
        if (year >= 2000) year -= 1911;
        semesterNum = Number(match[2]);
      }
    }
    return year && semesterNum ? String(year) + '-' + semesterNum : null;
  }

  // Explicit 115-1 whitelist from the user's course list.
  // IDs are used when known; names must match the whole normalized course name.
  const TARGET_COURSES = [
    {name:'AI應用新手村-iPAS AI應用規劃師考照初階引導工作坊'},
    {name:'資訊管理',id:138917},
    {name:'人工智慧服務設計',id:141965},
    {name:'計算機程式設計',id:139520},
    {name:'資料庫管理'},
    {name:'富蘭克林講座－金融投資與資產管理(Ａ組)'},
    {name:'職涯錨定(５１企ＡＢ)'},
    {name:'人工智慧跨域應用(５１企ＡＢ)'},
    {name:'專業ｏｆｆｉｃｅ套裝軟體（一）(城中校區)'},
    {name:'ＰＨＰ與ＭＹＳＱＬ資料庫程式初探(資訊遠距)',id:140504},
    {name:'115-1 TA training'},
  ];
  const normCourse = name => String(name || '').normalize('NFKC')
    .replace(/[\s（）()－—–-]/g,'').toLowerCase();
  function selectedUserCourses(courses, term, semesters, years) {
    if (term !== '115-1') return null; // Explicit list applies to 115-1 only.
    const used = new Set();
    const selected = [];
    const missing = [];
    for (const target of TARGET_COURSES) {
      const byId = target.id != null ? courses.find(c => String(c.id) === String(target.id)) : null;
      // For a name-only course, do not select one of several ambiguous names
      // unless course semester metadata identifies the 115-1 class.
      const names = byId ? [byId] : courses.filter(c => normCourse(c.name) === normCourse(target.name));
      const candidates = names.filter(c => !used.has(String(c.id)));
      const exactTerm = candidates.filter(c => courseAcademicTerm(c, semesters, years) === term);
      const eligible = exactTerm.length ? exactTerm : candidates.filter(c => {
        const t = courseAcademicTerm(c, semesters, years);
        return t === null || t === term;
      });
      const chosen = byId ? eligible[0] : eligible.length === 1 ? eligible[0] : null;
      if (chosen) {selected.push(chosen);used.add(String(chosen.id));}
      else missing.push(target.name);
    }
    return {selected,missing};
  }

  async function getJson(path) {
    const response = await fetch(path, { credentials: 'include', headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (response.status === 401 || response.status === 403) throw new Error('TronClass 登入已失效，請先在東吳 TronClass 重新登入。');
    if (!response.ok) throw new Error(`TronClass API 回傳 ${response.status}。`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) throw new Error('尚未登入 TronClass，或學校的資料介面已變更。');
    return response.json();
  }

  function normalizeHomework(course, activity, fromTodo = false) {
    if (!activity || course.id == null) return null;
    const activityId = activity.activity_id ?? activity.homework_activity_id ?? activity.assignment_id ?? activity.id;
    if (activityId == null) return null;
    const courseName = text(course.name || activity.course_name, 120), originalTitle = text(activity.title || activity.name, 180);
    if (!courseName || !originalTitle) return null;
    const due = timeParts(activity.due_at || activity.due_date || activity.end_at || activity.end_date || activity.end_time || activity.deadline || activity.close_at);
    const open = timeParts(activity.start_at || activity.open_at || activity.start_time || activity.begin_at);
    const statusText = text(activity.status, 50).toLowerCase();
    const submitText = text(activity.submission_status || activity.submit_status, 50).toLowerCase();
    const pendingPattern = /unsubmitted|not[_ -]?submitted|pending|未繳|未交|未提交/;
    const explicitPending = activity.submitted === false || activity.is_submitted === false ||
      pendingPattern.test(statusText) || pendingPattern.test(submitText);
    const submitted = activity.submitted === true || activity.is_submitted === true ||
      !!activity.submitted_at || !!activity.submission?.submitted_at ||
      /^(submitted|completed|graded|已繳|已交|已提交)$/.test(submitText) ||
      (/^(submitted|已繳|已交|已提交)$/.test(statusText) && !explicitPending);
    // Do not confuse an ended activity with an already-submitted assignment.
    if (submitted || (!fromTodo && !explicitPending)) return null;
    const link = text(activity.url || activity.link || '', 500);
    return {
      key: `tron:${course.id}:${activityId}`,
      course: courseName, courseId: String(course.id), activityId: String(activityId),
      originalTitle, title: `${courseName}｜${originalTitle}`,
      startDate: (open || due)?.date || '', startTime: open?.time || '00:00',
      date: due?.date || '', time: due?.time || '',
      status: '未繳',
      kind: 'task', category: '考試／報告',
      description: text(activity.description || activity.content, 500),
      link: /^https:\/\/tronclass\.scu\.edu\.tw(?:\/|$)/.test(link) ? link : 'https://tronclass.scu.edu.tw/',
      source: 'auto',
    };
  }

  function normalizeExam(course, exam) {
    if (!exam || course.id == null) return null;
    const id = exam.id ?? exam.exam_id ?? exam.activity_id;
    const title = text(exam.title || exam.name || exam.exam_name, 180);
    if (id == null || !title) return null;
    const status = text(exam.submission_status || exam.status, 80).toLowerCase();
    if (exam.is_submitted === true || exam.submitted === true ||
        exam.completed === true || exam.is_completed === true ||
        /^(completed|submitted|graded|finished|已完成|已交卷|已繳交)$/.test(status)) return null;
    const start = timeParts(exam.exam_at || exam.exam_time || exam.start_at || exam.start_time || exam.begin_at);
    const end = timeParts(exam.end_at || exam.end_time || exam.due_at || exam.deadline);
    const when = start || end;
    const link = text(exam.url || exam.link, 500);
    return {
      key: `tron:${course.id}:exam:${id}`,
      course: text(course.name, 120), courseId: String(course.id), activityId: String(id),
      originalTitle: title, title: text(course.name,120) + '｜' + title,
      startDate: start?.date || when?.date || '', startTime: start?.time || '00:00',
      date: end?.date || when?.date || '', time: end?.time || '',
      status: '待確認', kind: 'exam', category: '考試／報告',
      description: text(exam.description || exam.content, 500),
      link: /^https:\/\/tronclass\.scu\.edu\.tw(?:\/|$)/.test(link) ? link : 'https://tronclass.scu.edu.tw/',
      source: 'auto',
    };
  }

  async function scan() {
    if (document.querySelector('input[type="password"]')) throw new Error('請先登入 TronClass 再同步。');
    // Get all enrolled courses: ended courses may still have overdue submissions.
    const coursesResult = await getJson('/api/my-courses');
    const courses = coursesResult?.courses;
    if (!Array.isArray(courses)) throw new Error('TronClass 課程資料格式不符，請確認學校平台是否更新。');
    if (!courses.length) throw new Error('TronClass 未回傳課程，請確認登入狀態。');
    if (courses.length > 200) throw new Error('課程數量異常，已停止同步。');
    async function optionalList(path, key) {
      try {
        const result = await getJson(path);
        return Array.isArray(result?.[key]) ? result[key] : null;
      } catch (error) {
        if (/登入已失效/.test(String(error?.message))) throw error;
        return null;
      }
    }
    const [semesters, years] = await Promise.all([
      optionalList('/api/my-semesters', 'semesters'),
      optionalList('/api/my-academic-years', 'academic_years'),
    ]);
    const semesterIndex = new Map((semesters || []).map(x => [String(x.id), x]));
    const yearIndex = new Map((years || []).map(x => [String(x.id), x]));
    const term = currentAcademicTerm();
    const userSelection = selectedUserCourses(courses, term, semesterIndex, yearIndex);
    const selected = userSelection ? userSelection.selected
      : courses.filter(c => courseAcademicTerm(c, semesterIndex, yearIndex) === term);
    if (!selected.length) throw new Error('讀取 ' + courses.length + ' 門課，但找不到指定的 ' + term + ' 課程；已保留既有資料。');
    const selectedById = new Map(selected.map(c => [String(c.id), c]));
    const assignments = new Map();
    const diagnostics = { totalCourses: courses.length, matchedCourses: selected.length,
      todosFound: 0, todosMatched: 0, homeworkMatched: 0, examsMatched: 0, failedCourses: 0,
      targetCourses: userSelection ? TARGET_COURSES.length : null,
      missingCourses: userSelection ? userSelection.missing : [] };
    function add(item) {
      if (!item) return;
      const duplicate = [...assignments.values()].find(previous =>
        previous.courseId === item.courseId &&
        previous.originalTitle.normalize('NFKC').trim() === item.originalTitle.normalize('NFKC').trim() &&
        (!previous.date || !item.date || previous.date === item.date));
      if (duplicate) {
        if (item.date && !duplicate.date) Object.assign(duplicate, {date:item.date,time:item.time});
        return;
      }
      assignments.set(item.key, item);
    }
    const todos = await optionalList('/api/todos', 'todo_list');
    if (todos) {
      diagnostics.todosFound = todos.length;
      for (const todo of todos) {
        const id = todo.course_id ?? todo.course?.id;
        let course = id == null ? null : selectedById.get(String(id));
        if (!course && typeof todo.course_name === 'string') {
          const matches = selected.filter(c => c.name === todo.course_name);
          if (matches.length === 1) course = matches[0];
        }
        if (!course) continue;
        const item = normalizeHomework(course, todo, true);
        if (item) { add(item); diagnostics.todosMatched++; }
      }
    }
    for (const course of selected) {
      if (!Number.isSafeInteger(Number(course.id))) continue;
      let page = 1, pages = 1;
      do {
        let result;
        try {
          result = await getJson('/api/courses/' + encodeURIComponent(course.id) +
            '/homework-activities?page=' + page + '&page_size=100');
        } catch (error) {
          if (/登入已失效/.test(String(error?.message))) throw error;
          diagnostics.failedCourses++;
          break;
        }
        if (!Array.isArray(result.homework_activities)) throw new Error((course.name || '某堂課') + '的作業資料格式不符。');
        for (const raw of result.homework_activities) {
          const item = normalizeHomework(course, raw);
          if (item) { add(item); diagnostics.homeworkMatched++; }
        }
        pages = Math.min(20, Math.max(1, Number(result.pages) ||
          Math.ceil((Number(result.total) || 0) / (Number(result.page_size) || 100)) || 1));
        page++;
      } while (page <= pages);
      if (assignments.size > 1500) throw new Error('作業資料過多，已停止同步以保護瀏覽器。');
    }
    // Exams are a separate TronClass activity type, not homework deadlines.
    for (const course of selected) {
      if (!Number.isSafeInteger(Number(course.id))) continue;
      const exams = await optionalList('/api/courses/' + encodeURIComponent(course.id) + '/exam-list', 'exams');
      if (!exams) continue;
      for (const raw of exams.slice(0,200)) {
        const item = normalizeExam(course, raw);
        if (item) { add(item); diagnostics.examsMatched++; }
      }
    }
    return { source:'tronclass.scu.edu.tw', term, termMode:'current',
      fetchedAt:new Date().toISOString(), courses:selected.length,
      assignments:[...assignments.values()], diagnostics, partial: diagnostics.failedCourses > 0 };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'TRONCLASS_SCAN') return;
    scan().then(snapshot => sendResponse({ ok: true, snapshot }), error => sendResponse({ ok: false, error: error?.message || '同步失敗。' }));
    return true;
  });
})();
