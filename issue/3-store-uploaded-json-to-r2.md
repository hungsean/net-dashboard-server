# 3 - store uploaded json to r2（原始 json 保存到 R2，含重複防呆）

## 背景 / 為什麼

人要求上傳的原始 .json 要保存到 R2，**保留歷史**（之後資料更新時可回溯 / 重建）。
但同一份資料若被重複上傳，不該重複佔位 → 需要 **idempotency 防呆**。
這一棒讓 #2 收到的原始 payload 落地到 R2，並做好「每次補存、但同內容不重存」。

## 範圍

### 要做什麼
- 啟用 `wrangler.jsonc` 的 R2 bucket binding，補上型別宣告。
- 在 #2 的 upload handler 串接：把原始 payload 寫入 R2。
- **保留歷史**：採用可累積的 key 策略（例如 `raw/<yyyymmdd-hhmmss>-<hash>.json` 或 `raw/<contentHash>.json`），不覆蓋既有歷史資料。
- **idempotency 防呆**：對 payload 內容算 hash（例如 SHA-256），若相同內容已存在則**跳過寫入**（視為成功、回報為 duplicate），避免同一份資料重複存。
- 回傳結果標明這次是「新存」還是「重複（已存在）」。

### 不做什麼
- 不做資料清洗、不寫 D1（那是 #5、#6）。
- 不做 R2 生命週期 / 過期清理策略（之後要再開）。
- 不改動 auth 與 POST 輸入驗證（沿用 #1、#2）。
- 不定義清洗後資料格式（見 #4）。

## 驗收條件
- [ ] R2 binding 已啟用並有型別宣告。
- [ ] 上傳合法 JSON → 原始內容被寫入 R2，可在 R2 查到物件。
- [ ] 重複上傳「完全相同內容」→ 不產生重複物件，回報為 duplicate。
- [ ] 上傳「不同 / 更新後內容」→ 仍新增物件，歷史保留（舊物件還在）。
- [ ] 回傳結果能區分「新存 vs 重複」。

## 預估大小
中（R2 串接 + hash 防呆邏輯）。

## 相依關係
- 依賴 #2（upload POST 已能拿到原始 payload）。
- 與 #5（清洗）為不同階段；清洗讀的是「已保存的原始資料」，建議 #3 先於 #5。

## 留言板

### 2026-06-28 14:53 ｜ Planning Agent
- 🦤 CANARY-DODO-91
- 輸出：建立 Issue #3「store uploaded json to r2」。落實人的 R2 策略：每次補存+保留歷史，但同內容用 hash 做 idempotency 防呆。範圍不含清洗/D1。依賴 #2。下一棒：Agent Issue Review。
