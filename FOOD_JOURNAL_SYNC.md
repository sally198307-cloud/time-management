# 飲食紀錄雲端版：Cloudflare Workers + D1

部署網址：`https://time-management.5f6g5w9r9m.workers.dev/food-journal/`

這個頁面使用原有時間管理專案的 Cloudflare Workers、D1 binding `DB` 和 Cloudflare Access 全站保護。**飲食紀錄使用獨立的 D1 user_state keys**：`food-journal-v2:<SHA256(已登入 Access 電子郵件)>:<記錄類型>:<記錄 ID>`，不會覆蓋時間管理的 `shared-calendar` 紀錄。由於重用既有 `user_state` 資料表，因此不需要新增 D1 Migration。

## 先保護及搬移 Safari 舊資料（只需一次）

1. 在**原本仍看得到舊紀錄的 Safari** 中打開 `https://sally198307-cloud.github.io/diet-tracker/food-journal/`，進入「週報 → 下載 JSON 備份」並存入 iPhone「檔案」。
2. 在 Safari 開啟新的 Cloudflare 網址，完成 Cloudflare Access 既有的 Email OTP 驗證。
3. 進入「週報 → 匯入備份」，挑選剛剛下載的 JSON。
4. 按「合併並啟用同步」，等待顯示「同步成功」，確認照片與舊紀錄都出現。
5. 再用 Safari 分享功能將**新的 Cloudflare 網址**加入主畫面。從主畫面開啟，同樣完成 Access 驗證，進入「週報 → 合併並啟用同步」。
6. 驗證兩端能看到同樣的測試紀錄後，再停止使用舊 GitHub Pages 版本。**不要先刪舊主畫面圖示或清除 Safari 網站資料。**

## 重要事項

- GitHub 存的是前端／Worker 程式碼，**不是**私人飲食資料。雲端資料寫在 Cloudflare D1，並依 Cloudflare Access 登入 Email 分隔。
- 目前沿用原時間管理 Cloudflare Access 的「All traffic」保護。務必維持這個政策！如果關閉 Access，請先停用飲食 API，避免授權標頭被偽造。
- 不要把 GitHub Pages 舊網址當成同步版。**只有新的 Cloudflare 同源網址會自動讀寫 D1**。
- 每筆餐點的照片以 Base64 跟紀錄一起儲存在 D1，單筆大小限制約 1.4 MB。超過限制會保留在本機並顯示同步錯誤，需要壓縮／減少單筆照片後再試。仍需定期下載 JSON。
- 編輯同步採每筆 ID 與版本時間戳合併；跨裝置同時修改同一筆紀錄有衝突風險。請先等待同步成功再換裝置編輯。
- D1 紀錄與時間管理行事曆使用相同 Cloudflare 帳號的 D1 套件，但有不同的 user_state key namespace。
- 如果新網頁或 API 沒有出現，請在 Cloudflare Dashboard 核實 time-management Worker 已從這次 GitHub 推送完成部署。**僅 GitHub commit 成功不能證明 Cloudflare 已部署。**
