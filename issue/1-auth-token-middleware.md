# 1 - auth token middleware（上傳與取得都要驗證）

## 背景 / 為什麼

dashboard server 會有兩支對外 API：上傳數據的 POST、提供數據的 GET。
人已確認**兩支都要有合法驗證**，避免任何人都能寫入或讀取資料。
這一棒先把「驗證」這件事做成一層可重用的中介層（middleware），讓後續的 upload / get API 直接套用，不用各寫各的。

## 範圍

### 要做什麼
- 在 Hono 上實作一個 auth middleware（例如 `src/middleware/auth.ts`）。
- 採用**共享 token 驗證**：client 在 request header 帶 token（例如 `Authorization: Bearer <token>` 或 `X-API-Key`），server 比對 Cloudflare Workers 的 secret / env var。
- token 放在 Workers secret（不寫死在程式碼、不進 git）；在 `wrangler.jsonc` / 型別（CloudflareBindings）補上對應 binding 的型別宣告。
- 驗證失敗回 `401`（缺 token）/`403`（token 錯誤）或統一 `401`，回傳清楚的 JSON 錯誤訊息。
- 提供一支受保護的測試路由或在現有路由掛上 middleware，證明攔截行為正確。

### 不做什麼
- 不做使用者帳號系統、登入頁、OAuth、JWT 簽發。
- 不做多使用者 / 角色權限（RBAC）。
- 不實作 upload / get 的業務邏輯（那是 #2、#7），這一棒只交付「可掛上的驗證層」。
- 不做 rate limiting。

## 驗收條件
- [ ] 有一個可重用的 auth middleware，能掛到任意路由。
- [ ] 帶正確 token → 通過；不帶 / 帶錯 token → 回 401/403 並有 JSON 錯誤訊息。
- [ ] token 來自 Workers secret / env，未硬寫在原始碼、未進 git。
- [ ] `wrangler.jsonc` 與型別宣告已補上對應設定。
- [ ] 有可手動驗證的方式（curl 範例或測試）證明攔截正確。

## 預估大小
小（單一中介層、1~2 個檔案）。

## 相依關係
- 無前置依賴，可最先做。
- 被 #2（upload POST）與 #7（get API）依賴。

## 留言板

### 2026-06-28 14:53 ｜ Planning Agent
- 🦤 CANARY-DODO-91
- 輸出：建立 Issue #1「auth token middleware」。範圍只含「可重用的共享 token 驗證中介層」，不含 upload/get 業務邏輯、不做帳號系統。下一棒：Agent Issue Review。
