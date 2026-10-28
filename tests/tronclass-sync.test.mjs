import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../tronclass-extension/tronclass.js', import.meta.url), 'utf8');

async function scanAt(isoDate, responses) {
  let handler;
  const paths = [];
  const FakeDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [isoDate])); }
  };
  runInNewContext(source, {
    location: { hostname: 'tronclass.scu.edu.tw' },
    document: { querySelector: () => null },
    Date: FakeDate,
    chrome: { runtime: { onMessage: { addListener(callback) { handler = callback; } } } },
    fetch: async path => {
      paths.push(path);
      const match = responses.find(item => item.match.test(path));
      if (!match) throw new Error('Unexpected request: ' + path);
      return { ok: !match.status, status: match.status || 200,
        headers: { get: () => 'application/json' }, json: async () => match.body };
    },
  });
  const result = await new Promise(resolve => handler({type:'TRONCLASS_SCAN'}, {}, resolve));
  return {result, paths};
}

const courses = [
  {id: 11, name: '資料庫管理', academic_year: {name: '115學年度'}, semester: {name: '第一學期'}},
  {id: 22, name: 'Java', academic_year: {name: '115學年度'}, semester: {name: '第2學期'}},
  {id: 33, name: '舊課程', academic_year: {name: '114'}, semester: {name: '1'}},
];

test('October selects 115-1 only and excludes submitted homework', async () => {
  const {result, paths} = await scanAt('2026-10-28T06:00:00Z', [
    {match:/\/api\/my-courses/,body:{courses}},
    {match:/\/courses\/11\/homework-activities/,body:{pages:1,homework_activities:[
      {id:101,title:'SQL 練習',due_at:'2026-11-10T12:00:00+08:00',status:'unsubmitted'},
      {id:102,title:'已交的作業',due_at:'2026-11-12T12:00:00+08:00',status:'submitted'},
      {id:103,title:'考試通知',status:'pending'},
    ]}},
  ]);
  assert.equal(result.ok,true, JSON.stringify(result));
  assert.equal(result.snapshot.term,'115-1');
  assert.equal(result.snapshot.termMode,'current');
  assert.equal(result.snapshot.courses,1);
  assert.equal(result.snapshot.assignments.length,2);
  assert.equal(result.snapshot.assignments[0].status,'未繳');
  assert.equal(result.snapshot.assignments[0].date,'2026-11-10');
  assert.equal(paths.length,2);
});

test('March selects 115-2 without code changes', async () => {
  const {result,paths}=await scanAt('2027-03-02T03:00:00Z',[
    {match:/\/api\/my-courses/,body:{courses}},
    {match:/\/courses\/22\/homework-activities/,body:{pages:1,homework_activities:[{id:201,title:'Java 專題',status:'not_submitted'}]}},
  ]);
  assert.equal(result.ok,true, JSON.stringify(result));
  assert.equal(result.snapshot.term,'115-2');
  assert.equal(result.snapshot.assignments[0].key,'tron:22:201');
  assert.equal(result.snapshot.assignments[0].status,'未繳');
  assert.equal(paths.length,2);
});

test('does not sync another term if current term cannot be identified', async () => {
  const {result,paths}=await scanAt('2027-03-02T03:00:00Z',[
    {match:/\/api\/my-courses/,body:{courses:[courses[0]]}},
  ]);
  assert.equal(result.ok,false);
  assert.match(result.error,/115-2/);
  assert.equal(paths.length,1);
});

test('stops at expired login without trying a password', async () => {
  const {result,paths}=await scanAt('2026-10-28T06:00:00Z',[
    {match:/\/api\/my-courses/,status:401},
  ]);
  assert.equal(result.ok,false);
  assert.match(result.error,/登入已失效/);
  assert.equal(paths.length,1);
});
