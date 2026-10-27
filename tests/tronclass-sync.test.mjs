import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../tronclass-extension/tronclass.js', import.meta.url), 'utf8');

async function runScan(responses) {
  let handler;
  const fetchedPaths = [];
  runInNewContext(script, {
    location: { hostname: 'tronclass.scu.edu.tw' },
    document: { querySelector: () => null },
    chrome: { runtime: { onMessage: { addListener(callback) { handler = callback; } } } },
    fetch: async path => {
      fetchedPaths.push(path);
      const data = responses.find(item => item.match.test(path));
      if (!data) throw Error(`Unexpected request: ${path}`);
      return { ok: data.status === undefined, status: data.status || 200,
        headers: { get: () => 'application/json' }, json: async () => data.body };
    },
  });
  const result = await new Promise(resolve => handler({ type: 'TRONCLASS_SCAN' }, {}, resolve));
  return { result, fetchedPaths };
}

test('collects all ongoing courses, paginated homework, stable identifiers, and Taipei deadlines', async () => {
  const { result, fetchedPaths } = await runScan([
    { match: /\/api\/my-courses/, body: { courses: [{ id: 101, name: '資料庫管理' }, { id: 202, name: 'PHP 與 MySQL' }] } },
    { match: /courses\/101\/homework-activities\?page=1/, body: { pages: 2, homework_activities: [
      { id: 11, title: 'SQL 第五週', due_at: '2026-10-27T08:30:00Z', start_at: '2026-10-21 09:00:00', status: 'unsubmitted' },
    ] } },
    { match: /courses\/101\/homework-activities\?page=2/, body: { pages: 2, homework_activities: [
      { id: 12, title: 'ERD 報告', due_at: '2026-11-03T12:00:00+08:00', submitted_at: '2026-10-26T02:00:00Z' },
    ] } },
    { match: /courses\/202\/homework-activities/, body: { pages: 1, homework_activities: [
      { id: 31, title: '第三次作業' },
    ] } },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.courses, 2);
  assert.equal(result.snapshot.assignments.length, 3);
  assert.equal(result.snapshot.assignments[0].key, 'tron:101:11');
  assert.equal(result.snapshot.assignments[0].date, '2026-10-27');
  assert.equal(result.snapshot.assignments[0].time, '16:30');
  assert.equal(result.snapshot.assignments[0].startTime, '09:00');
  assert.equal(result.snapshot.assignments[1].status, '已繳');
  assert.equal(result.snapshot.assignments[2].date, '');
  assert.equal(fetchedPaths.length, 4);
});

test('reports expired school login without trying password authentication', async () => {
  const { result, fetchedPaths } = await runScan([
    { match: /\/api\/my-courses/, status: 401 },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, /登入已失效/);
  assert.equal(fetchedPaths.length, 1);
});
