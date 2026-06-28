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
- [x] 有一個可重用的 auth middleware，能掛到任意路由。
- [x] 帶正確 token → 通過；不帶 / 帶錯 token → 回 401/403 並有 JSON 錯誤訊息。
- [x] token 來自 Workers secret / env，未硬寫在原始碼、未進 git。
- [x] `wrangler.jsonc` 與型別宣告已補上對應設定。
- [x] 有 curl 範例，涵蓋三種情境並說明預期回應：帶正確 token（通過）、缺 token（回 401/403）、帶錯誤 token（回 401/403）。
- [x] 實際執行 `wrangler deploy` 部署到 Cloudflare Workers，對真實 `.workers.dev` endpoint 跑上述 curl，確認回應符合預期（貼回應內容或截圖作為交付物）。

## 預估大小
小（單一中介層、1~2 個檔案）。

## 相依關係
- 無前置依賴，可最先做。
- 被 #2（upload POST）與 #7（get API）依賴。

## 留言板

### 2026-06-28 14:53 ｜ Planning Agent
- 🦤 CANARY-DODO-91
- 輸出：建立 Issue #1「auth token middleware」。範圍只含「可重用的共享 token 驗證中介層」，不含 upload/get 業務邏輯、不做帳號系統。下一棒：Agent Issue Review。

### 2026-06-28 15:46 ｜ Agent Issue Review
- 🧦 CANARY-SOCK-12
- 輸出：需要修改。
- 問題：驗收條件第 5 條「有可手動驗證的方式（curl 範例或測試）」語意模糊，可被本地 wrangler dev 或單元測試滿足，不需要真實部署到 Cloudflare Workers。人明確要求「真實上雲端測試」，但此條件未覆蓋該期望。
- 原因：Implement Agent 會以最省力方式滿足，跑 wrangler dev 本地測試就算交差，不一定部署到 workers.dev domain 做真實驗證。
- 建議：把第 5 條拆成兩點 ——（1）有 curl 範例涵蓋三情境：帶正確 token（通過）、缺 token、帶錯 token（401/403）；（2）實際 `wrangler deploy` 到 Cloudflare Workers，對真實 `.workers.dev` endpoint 跑上述 curl 確認攔截正確（貼回應或截圖為交付物）。其他部分（目標、範圍、大小、相依）均無問題。
- 下一棒：回到 Planning Agent 修改第 5 條驗收條件。

### 2026-06-28 16:08 ｜ Planning Agent
- 🦤 CANARY-DODO-91
- 輸出：依 Issue Review 建議修改驗收條件，把原第 5 條「有可手動驗證的方式（curl 範例或測試）」拆成兩個可打勾子項——（1）curl 範例涵蓋三情境：帶正確 token（通過）、缺 token（401/403）、帶錯誤 token（401/403），並說明預期回應；（2）實際 `wrangler deploy` 到 Cloudflare Workers，對真實 `.workers.dev` endpoint 跑上述 curl 確認回應符合預期（貼回應或截圖為交付物）。此修改覆蓋「人希望真實上雲端測試」的期望。其餘部分（背景、範圍、大小、相依關係）維持不變。
- 下一棒建議：交給 Agent Issue Review 再確認修改是否到位。

### 2026-06-28 15:48 ｜ Agent Issue Review（複審）
- 🧦 CANARY-SOCK-12
- 輸出：無需修改。
- 確認：Planning Agent 已把第 5 條拆成兩個子項——（1）curl 三情境範例、（2）wrangler deploy 真實部署並附上回應截圖/輸出。此修改確實覆蓋「真實上雲端測試」的期望，Implement Agent 不能再以本地 wrangler dev 代替。目標、範圍邊界、驗收條件、大小、相依關係均無問題。
- 下一棒：交給 Implement Agent。

### 2026-06-28 16:42 ｜ Implement Agent
- 🛸 CANARY-UFO-23
- 輸出（Implement）：完成可重用的共享 token 驗證 middleware，並真實部署到 Cloudflare Workers 驗證通過。六條驗收條件全數達成。
- 改了哪些檔：
  - 新增 `src/middleware/auth.ts`：以 `createMiddleware<{ Bindings: CloudflareBindings }>` 實作 `auth`，比對 `c.env.AUTH_TOKEN`（Workers secret）。缺 header/格式錯 → 401、token 不符 → 403、未設定 secret → 500，皆回結構化 JSON `{ error, message }`。token 比對用自寫常數時間比較避免 timing attack。
  - 修改 `src/index.ts`：`Hono` 改帶 `<{ Bindings: CloudflareBindings }>`；新增受保護路由 `GET /protected` 掛上 `auth`（公開路由 `GET /` 保留作健康檢查）。
  - 新增 `src/env.d.ts`：以 interface 合併把 `AUTH_TOKEN: string` 補進 `CloudflareBindings`（放獨立檔，避免被 `cf-typegen` 重生時覆寫）。
  - 修改 `wrangler.jsonc`：補上 AUTH_TOKEN secret 的設定說明註解（secret 不寫進設定檔，避免進 git）。
  - 新增 `.dev.vars.example`：本地開發範本（`.dev.vars` 已被 .gitignore 忽略）。
- 怎麼驗證（含真實雲端 curl）：
  - `wrangler deploy --dry-run` bundling 成功（64.07 KiB）。註：專案未裝 typescript，無法跑完整 tsc 型別檢查，依賴 bundling 結果。
  - 已 `wrangler deploy` 上線：`https://net-dashboard-server.hungsean0419.workers.dev`（Version ID: abc01755-5889-44f5-8f16-6ea045fe7a34）。
  - secret 已用非互動方式設定：`AUTH_TOKEN`（名稱），值見回傳報告（不寫進 git/留言板）。
  - 對真實 endpoint `GET /protected` 跑三情境：
    - 正確 token → `HTTP 200` `{"ok":true,"message":"You are authorized."}`
    - 缺 token → `HTTP 401` `{"error":"Unauthorized","message":"Missing Authorization header."}`
    - 錯誤 token → `HTTP 403` `{"error":"Forbidden","message":"Invalid token."}`
  - 已確認 secret 未進 git：`.dev.vars`/`.env` 被 .gitignore 忽略，原始碼中 grep 不到 token 值。
- 風險/取捨：
  - 採 401（缺/格式錯）+ 403（token 錯）分流，與 Issue「401/403 或統一 401」相容。
  - 常數時間比對為自寫版本（Hono `hono/utils/buffer` 未在 package exports 公開故不採用）；長度不同會提早回 false，會洩漏「長度是否相符」這點極微弱資訊，對共享 token 場景可接受。
  - 未裝 typescript 故未跑 tsc；建議後續可加 typescript devDep 與 lint。
- 下一棒建議：交給 Agent Code Review（改動適中、單一中介層）。

### 2026-06-28 15:56 ｜ Agent Code Review
- 🦦 CANARY-OTTER-65
- 輸出（Review Report）：結論「無需修改」（審查通過）。
- 逐改動點：
  - src/middleware/auth.ts：從 c.env.AUTH_TOKEN 取 secret、未硬寫；錯誤分流正確（缺→401、格式錯→401、token 錯→403、secret 未設→500），皆回 JSON {error,message}；自寫常數時間比對實作正確（逐 byte XOR、無提早 break）。
  - src/index.ts：Hono 帶 Bindings 型別，公開 GET / 保留、受保護 GET /protected 掛 auth，乾淨無夾帶。
  - src/env.d.ts：以 declaration merging 補 AUTH_TOKEN，避開 cf-typegen 覆寫，理由正當。
  - wrangler.jsonc：僅註解說明 secret，無寫入 token 值。
  - .dev.vars.example：僅佔位字串，.dev.vars 已被 gitignore。
- 驗證：六條驗收條件全數達成；token 未進 git 已實證（gitignore 含 .env/.dev.vars、check-ignore 通過、磁碟無 .dev.vars、source 掃描無真實 token、tracked 僅註解提及）；真實部署三情境 200/401/403 回應符合預期。
- 風險：無需擋下的風險。小觀察（不阻擋）：Bearer regex 區分大小寫、未裝 typescript 無 tsc、無自動化測試（已由 curl+真實部署替代）、worker-configuration.d.ts 為 untracked。建議日後另開 Issue 補 typescript + lint。
- 下一步：人看 Review Report → PR 推送（推送前需先 commit 工作區改動）；推送後請人手動把 Issue 移到 /closed。
