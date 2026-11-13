# 飲食紀錄獨立公開 Worker（不用 Email 登入）

**這是目前採用的部署方式。** 不需要再修改 `time-management` 的 Cloudflare Access 政策。時間管理保持原本 Email 登入，飲食紀錄建立另外一個**公開 Worker**。

## 已寫好的程式（GitHub main）
- Worker entry: `dist/server/food-journal-standalone.js`
- Wrangler config: `wrangler.food-journal.jsonc`
- 網站原始檔：`dist/client/food-journal/index.html`
- 同步客戶端：`dist/client/food-journal/cloudflare-sync.js`
- D1 使用既有 `time-management-db` binding，但獨立儲存鍵值 `food-journal-v2:<SHA256(同步密鑰)>:<type>:<id>`。

## 你在 Cloudflare 的最後操作

1. Cloudflare Dashboard → Workers & Pages → **Create application** → **Import a repository / Connect GitHub**。
2. 選擇 `sally198307-cloud/time-management`，以 `main` 為部署分支。
3. 專案名稱填：`food-journal`。Root directory 保持倉庫根目錄（`/`）。
4. **Deploy command 改成：** `npx wrangler deploy --config wrangler.food-journal.jsonc`。
5. Build command 留空，不要使用時間管理網站的預設部署命令。
6. Save and Deploy。待部署成功後，網址預期為 `https://food-journal.5f6g5w9r9m.workers.dev/food-journal/`（實際以儀表板給的網址為準）。
7. 在**舊 Safari** `https://sally198307-cloud.github.io/diet-tracker/food-journal/` 週報先下載 JSON 備份；在**新網址**週報匯入 JSON，點「建立同步空間並啟用」，確認成功後複製專屬同步連結。再用該連結於主畫面 App 開啟並啟用同步。
8. 保留既有時間管理的 Worker Access All traffic，不要修改、刪除或設為公開。

## 安全注意
- 公開的是網站，不是全世界都能存取的資料。雲端 API 必須提供隨機 64 位十六進位同步密鑰，只有持有者能存取對應紀錄。**任何取得專屬連結的人都能讀寫資料，請勿將連結公開分享。**
- 不涉及 Email/Cloudflare Access 驗證；密鑰請自己保存。
- 若部署失敗，先檢查 GitHub 的部署設定命令與 D1 binding，不要動原本時間管理網站。
- 未經實際驗證，不應視為已部署完成。
