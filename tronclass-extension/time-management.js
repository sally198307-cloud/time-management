// Deliver only normalized homework metadata to the user's own app.
(() => {
  if (location.hostname !== 'time-management.5f6g5w9r9m.workers.dev') return;
  const emit = (stored) => {
    if (!stored) return;
    window.postMessage({ type: 'LIH_TRON_AUTO_SYNC', source: 'lih-tronclass-extension-v1', ...stored }, location.origin);
  };
  chrome.runtime.sendMessage({ type: 'TRON_GET_SNAPSHOT' }, emit);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'TRON_SNAPSHOT_CHANGED') emit(message.data);
  });
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'LIH_TRON_SYNC_REQUEST') return;
    chrome.runtime.sendMessage({ type: 'TRON_GET_SNAPSHOT' }, emit);
  });
})();
