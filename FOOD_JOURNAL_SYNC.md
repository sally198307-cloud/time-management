# 飲食紀錄免 Email 登入版本

預定網址：https://time-management.5f6g5w9r9m.workers.dev/food-journal/

- 前台網站不需要 Email 登入。
- 雲端儲存在既有 Cloudflare D1，跟時間管理的課表、行程資料隔離。
- 雲端讀寫要求 64 字元的強隨機同步密鑰。密鑰由瀏覽器自動產生，不是使用者 Email 或密碼。
- 點「複製專屬同步連結」即可在 Safari 和 iPhone 主畫面版共用一份資料。**任何拿到這個專屬連結的人都能讀寫你的資料，請勿公開分享。**
- 網站本身公開，但每份私人資料不公開；兩者不可混為一談。

## Cloudflare Access 設定（還需要在 Dashboard 完成）

原時間管理網站有 Cloudflare Access 既有驗證；光改 GitHub Worker 程式，不能繞過 Access 門檻。請至 Cloudflare Zero Trust > Access > Applications，在目前保護 time-management Worker 的規則中設立**更明確、只限以下兩個路徑的公開／Bypass 規則**：

- `/food-journal/*`（連同 `/food-journal/`）
- `/api/food-journal`

**不要**把整個 time-management Worker 設為公開，否則原有的 `/api/state`、任務、備忘和行事曆等私人資料會暴露。實際操作依 Cloudflare Access 的保護類型（hostname/path、Worker 級別或帳號級別）調整，較具體路徑規則優先；必要時使用該 Worker 的 path-based public overrides。確認舊的時間管理登入仍然正常。

## 首次搬移（必須先備份）

1. 用原本有資料的 Safari 開啟 GitHub Pages 舊網站 `https://sally198307-cloud.github.io/diet-tracker/food-journal/`。
2. 週報 → 下載 JSON 備份，存入「檔案」。
3. 進入新的 Cloudflare 飲食紀錄網址，週報 → 匯入備份。
4. 週報 → 「建立同步空間並啟用」，等待顯示成功。
5. 點「複製專屬同步連結」並妥善保存。用 Safari 開啟這條連結再加入主畫面。若主畫面版沒有載入資料，可在「已有另一個裝置的同步碼」貼上同一連結或同步碼。
6. 再按「立即同步」，確認資料正確。不要清除舊 Safari 資料。

## 限制

同步時會用同一筆記錄 ID 和版本時間戳合併。不要在兩台裝置同時編輯同一筆餐點。照片用 base64 儲存在 D1，單筆資料可能超過大小限制；遇到失敗應保留 JSON 備份並減少照片大小。密鑰遺失又未保存在任何裝置時，雲端資料可能無法取回。

GitHub 改動成功 **不等於** Cloudflare Worker 正式部署成功或 Access path bypass 設定已完成。請在 Cloudflare dashboard 核實最新版本已部署並使用 Safari 與主畫面版實際測試。
