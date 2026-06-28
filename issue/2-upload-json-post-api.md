# 2 - upload json post api（POST 接收上傳的 .json）

## 背景 / 為什麼

dashboard 的資料來源是上傳的 .json 檔。這一棒做出**接收上傳**的 POST API：
能收到 client 傳來的 JSON、確認它是合法 JSON、回傳明確結果。
這是後面 R2 保存（#3）、清洗（#5）、存 D1（#6）的入口，先把「收得到、收得對」做穩。

## 範圍

### 要做什麼
- 新增一支 POST 路由（例如 `POST /upload`），掛上 #1 的 auth middleware。
- 接收 request body 的 JSON 內容（檔案上傳或直接 JSON body 擇一，於 Issue 實作時依 web 端慣例決定並記錄）。
- 基本輸入驗證：body 必須是合法 JSON、非空；不合法回 `400` 並附清楚訊息。
- 成功時回傳結構化 JSON 結果（例如 `{ ok: true }` 或帶一個暫定 id）。
- 把「拿到的原始 payload」以乾淨的形式交給後續流程（先在 handler 內留好串接點，不直接做 R2/清洗）。

### 不做什麼
- 不做 R2 保存（那是 #3）。
- 不做資料清洗、不寫 D1（那是 #5、#6）。
- 不實作 auth 本身（用 #1 的 middleware）。
- 不定義最終的 JSON schema（schema 尚未定案，見 #4 研究）；這一棒只驗「是合法 JSON」，不驗業務欄位。

## 驗收條件
- [ ] 有一支受 auth 保護的 POST 路由。
- [ ] 帶合法 token + 合法 JSON → 回 2xx 與結構化結果。
- [ ] 不合法 JSON / 空 body → 回 400 並有清楚訊息。
- [ ] 無 / 錯 token → 被 #1 middleware 擋下（401/403）。
- [ ] handler 內有清楚的「原始 payload 交棒點」供 #3 接續。

## 預估大小
小～中（單一路由 + 輸入驗證）。

## 相依關係
- 依賴 #1（auth middleware）。
- 被 #3（存 R2）依賴。

## 留言板

### 2026-06-28 14:53 ｜ Planning Agent
- 🦤 CANARY-DODO-91
- 輸出：建立 Issue #2「upload json post api」。範圍只含「受保護的 POST 端點 + 合法 JSON 驗證 + 交棒點」，不含 R2/清洗/D1、不定 schema。依賴 #1。下一棒：Agent Issue Review。
