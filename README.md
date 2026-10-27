# 時間管理

俐華與培茲共用的時間管理網站。介面程式公開，但行程、任務、備忘錄與 Widget 權杖只存放在 Cloudflare D1／Secrets，不會寫入 GitHub。

## Cloudflare 部署設定

- Worker entry：`dist/server/index.js`
- Static assets：`dist/client`
- D1 binding：`DB`
- D1 database：`time-management-db`
- Shared data key：`shared-calendar`
- Secret：`WIDGET_ACCESS_TOKEN`
- Secret：`WIDGET_SITE_ACCESS`（搬移完成後可留空或移除）

部署前，先建立 D1，將它的 Database ID 填入 `wrangler.jsonc`，執行 migration，再以 Cloudflare Access 限制只有指定的兩個 Email 可以開啟網站。

舊網站資料請從「更多 → 匯出備份」下載 JSON；新網站部署後再用「更多 → 匯入備份」恢復。

## TronClass 自動同步

網站保留原本的手動課務匯入，另外提供電腦版 Chrome 的配套擴充功能：使用**已登入 TronClass 的瀏覽器工作階段**，每 30 分鐘檢查各科作業並存入待確認清單，不需將學校密碼交給時間管理網站。安裝方式與限制見 [`tronclass-extension/README.md`](tronclass-extension/README.md)。
