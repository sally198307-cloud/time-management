// Scheduled scans use only a current TronClass browser login, never a password.
const TRON_URL = 'https://tronclass.scu.edu.tw/';
const APP_TABS = 'https://time-management.5f6g5w9r9m.workers.dev/*';
const ALARM = 'tronclass-homework-every-30-minutes';
let running = null;

async function publishToOpenApp() {
  const data = await chrome.storage.local.get(['tronSnapshot', 'tronLastError', 'tronLastAttempt']);
  const tabs = await chrome.tabs.query({ url: APP_TABS });
  await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, {
    type: 'TRON_SNAPSHOT_CHANGED', data,
  })));
}

async function ready(tabId) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === 'complete') return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => done(new Error('TronClass 頁面載入逾時。')), 30000);
    function done(error) {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onRemoved.removeListener(removed);
      error ? reject(error) : resolve();
    }
    function updated(id, info) { if (id === tabId && info.status === 'complete') done(); }
    function removed(id) { if (id === tabId) done(new Error('TronClass 分頁已關閉。')); }
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onRemoved.addListener(removed);
  });
}

async function readFromTab(tabId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: 'TRONCLASS_SCAN' });
      if (!result?.ok) throw new Error(result?.error || 'TronClass 掃描失敗。');
      return result.snapshot;
    } catch (error) {
      const message = String(error?.message || error);
      if (!/Receiving end does not exist|Could not establish connection/.test(message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 750));
    }
  }
  throw new Error('TronClass 分頁未能啟動同步程式，請先手動登入平台。');
}

async function scanOnce() {
  if (running) return running;
  running = (async () => {
    let openedByExtension = null;
    try {
      const tabs = await chrome.tabs.query({ url: `${TRON_URL}*` });
      let tab = tabs.find(item => item.status === 'complete') || tabs[0];
      if (!tab) {
        tab = await chrome.tabs.create({ url: TRON_URL, active: false });
        openedByExtension = tab.id;
      }
      await ready(tab.id);
      const snapshot = await readFromTab(tab.id);
      await chrome.storage.local.set({ tronSnapshot: snapshot, tronLastError: null, tronLastAttempt: new Date().toISOString() });
      await chrome.action.setBadgeText({ text: '' });
      await publishToOpenApp();
      return snapshot;
    } catch (error) {
      const message = String(error?.message || error || '未知錯誤').slice(0, 240);
      await chrome.storage.local.set({ tronLastError: message, tronLastAttempt: new Date().toISOString() });
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
      await publishToOpenApp();
      return null;
    } finally {
      if (openedByExtension != null) await chrome.tabs.remove(openedByExtension).catch(() => {});
    }
  })();
  try { return await running; } finally { running = null; }
}

async function ensureAlarm() {
  const alarm = await chrome.alarms.get(ALARM);
  if (!alarm) await chrome.alarms.create(ALARM, { periodInMinutes: 30 });
}

chrome.runtime.onInstalled.addListener(() => { void ensureAlarm(); void scanOnce(); });
chrome.runtime.onStartup.addListener(() => { void ensureAlarm(); void scanOnce(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void scanOnce(); });
chrome.action.onClicked.addListener(() => { void scanOnce(); });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'TRON_GET_SNAPSHOT' || !sender.url?.startsWith('https://time-management.5f6g5w9r9m.workers.dev/')) return;
  chrome.storage.local.get(['tronSnapshot', 'tronLastError', 'tronLastAttempt']).then(sendResponse);
  return true;
});
void ensureAlarm();
