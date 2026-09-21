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
