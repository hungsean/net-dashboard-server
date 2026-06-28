# 4 - research flexible data model design（抗變動的清洗層與 D1 表設計）【研究型】

## 種類
**研究型 Issue** — 交付物是 `docs/` 設計報告，走**人為確認**（不走 Agent Issue Review）。

## 背景 / 為什麼

人明確說明：目前**沒有固定的 .json schema，也沒有固定的 D1 表設計**，而且要求
「即使 json 結構 / D1 欄位日後變動，開發難度也不要過大」（鬆耦合、抗變動）。

「清洗規則」與「D1 表設計」是彼此綁定、且人都高度不確定的決策：
清洗後資料長什麼樣，直接決定 D1 怎麼存；D1 採哪種策略，又回頭影響清洗層怎麼寫。
這種「要先查證、比較不同方案才能定」的決策，不該塞進實作型 Issue 讓 Implement Agent 邊做邊猜，
故開成研究型 Issue：先把資料層設計定下來，再讓 #5（清洗）、#6（存 D1）接著實作。

## 範圍

### 要回答 / 釐清的事
- D1（SQLite）在「欄位日後會變」前提下的**儲存策略比較**，至少涵蓋：
  - 正規化欄位表 vs. JSON 欄位（把彈性資料塞進一個 JSON column）vs. EAV / key-value vs. 混合式。
  - 各方案在「新增/移除欄位的改動成本」「查詢能力」「web 端取數方便度」上的取捨。
- **清洗 / 轉換層的架構**：如何把它獨立成一層（raw payload → 正規化中間結構 → 存儲格式），
  讓 schema 變動時只改這一層、不擴散到 API 與儲存。
- 一份**建議方案**：建議的 D1 表結構（或彈性策略）、清洗層的介面/邊界、版本演進（schema 變動時怎麼遷移）的處理方向。
- 標明此設計如何同時服務 #5（清洗）、#6（存 D1）、#7（取數 GET）。

### 不做什麼
- 不寫實際程式碼、不建表、不改 `src/`（那是 #5、#6 的事）。
- 不決定 auth / upload / R2 的實作（已分別在 #1、#2、#3）。
- 不需要產出完整正式 schema（schema 本就未定案）；產出的是**抗變動的設計原則與建議結構**。

## 驗收條件（能打勾判斷「研究有沒有回答到」）
- [ ] `docs/` 下有一份設計報告。
- [ ] 報告比較了至少 3 種 D1 儲存策略並給出推薦與理由。
- [ ] 報告說明清洗/轉換層如何獨立、schema 變動時改動如何被侷限在該層。
- [ ] 報告給出建議的 D1 結構/策略，以及未來欄位變動的演進方向。
- [ ] 報告明確指出 #5、#6、#7 各自要依此設計實作哪些邊界。

## 預估大小
研究型（單一核心決策：抗變動的資料層設計）。

## 相依關係
- 無程式碼前置依賴，**可與 #1~#3 並行**，建議盡早啟動。
- 為 #5（清洗）、#6（存 D1）的**前置**：這兩棒須等本研究結論進 `docs/` 後再實作。

## 留言板

### 2026-06-28 14:53 ｜ Planning Agent
- 🦤 CANARY-DODO-91
- 輸出：建立 Issue #4「research flexible data model design」【研究型】。把人高度不確定且彼此綁定的「清洗規則 + D1 表設計」抽成研究，產出 docs/ 設計報告以滿足抗變動要求。下一棒：**人為確認**（非 Agent Review）；人確認後交 Research Agent。

### 2026-06-28 15:20 ｜ Research Agent
- 🧭 CANARY-COMPASS-50 ｜ 📜 CANARY-SCROLL-33 ｜ 🌵 CANARY-CACTUS-79 ｜ 🪐 CANARY-SATURN-38
- 輸出（研究結果）：完成抗變動資料層設計研究，報告 → `docs/4-flexible-data-model-design.md`。
- 結論摘要：
  - **D1 儲存策略推薦「混合式（方案 D）」**＝穩定信封欄位（id/source_key/captured_at/ingested_at/schema_version）+ 一個 `payload` JSON 欄位。比較了 A 全正規化、B JSON 欄位、C EAV、D 混合四種，D 最契合「欄位會變、別讓開發難度過大」。
  - **清洗層獨立**為純函式（#5），擁有 Zod 輸入審核表 + raw→canonical 轉換；json 結構變動只撞這層，DB 多數情況免 migration。
  - **對人三點方向**：①輸入審核表→採納（用 Zod、區分硬必填/選填、R2 永留原始檔當安全網）；②欄位對應靠註解→**不建議**，改宣告式程式對應（且因 JSON payload，對應大多塌縮成清洗轉換，對應點變很少）；③Drizzle 管 D1→採納，已查證官方支援，遷移走 `drizzle-kit generate`→`wrangler d1 migrations apply`。
  - **single source of truth 的誠實發現**：drizzle-zod 方向是「表→Zod」，無法從 Zod 反推表；輸入≠資料表，硬壓成一份會把兩種變動耦死。建議**兩份各自最小、由清洗層當唯一橋樑**（輸入=Zod schema、儲存=Drizzle 信封表），反而更抗變動。
  - 已標明 #5/#6/#7 各自實作邊界與 schema 演進/遷移方向。
- 還缺（需人決定，不阻塞 #5；建議 #6 前確認 1、2）：①自然鍵用什麼（建議 R2 object key）②D1 留歷史快照 vs 只留最新(upsert)③#7 查詢需求（最新一筆 vs 範圍篩選）④drizzle 穩定版 vs beta。
- 下一棒：**人為確認**。人看過覺得足夠 → PR 推送收尾，並把本 Issue 移到 `/closed`（人手動）；不足 → 留在 Research Agent 補。

### 2026-06-28 ｜ Research Agent（依人最終決定改版）
- 🧭 CANARY-COMPASS-50 ｜ 📜 CANARY-SCROLL-33 ｜ 🌵 CANARY-CACTUS-79 ｜ 🪐 CANARY-SATURN-38
- **【人最終決定／覆寫】**（人為確認後拍板，覆寫上一筆的「混合式 payload」建議）：
  1. **D1 不採 JSON payload，改全正規化欄位（方案 A）**。理由：清洗層本就只洗出必要欄位才存，DB 一欄一欄存正式欄位即可。
  2. **保留歷史**：每次上傳 **INSERT 一筆**（非 upsert 覆蓋），D1 要能查時間變化。
  3. **查詢需求＝時間序列**：web 看 time-series，於 (device, captured_at) 建索引。
  4. **自然鍵＝(device, captured_at)**：同時當唯一鍵 + 時間序列查詢索引 + R2/D1 重複防呆(idempotency)。
  - 抗變動取捨：全正規化「新增欄位需 migration」由人接受；改由三支柱撐住 → ①R2 永久原始檔(可重清洗/backfill) ②Drizzle 管 schema/migration ③獨立清洗層 + Zod 審核表。
- 輸出（Research Agent 改版）：已將 `docs/4-flexible-data-model-design.md` **改版**（非新建），主推方案 D→A。更新章節：第 0(結論)、3(四方案比較、最終選 A)、4(三方向評估)、5(資料流+正規化時間序列表結構+範例)、6(正規化 schema 演進/migration/backfill)、7(#5/#6/#7 邊界對齊新決定)、8(套件)、9(剩餘待決)、10(驗收對照)、附錄 B(改版紀錄)。
- 最終建議結構摘要：D1 正規化時間序列表 = `id` / `device` / `captured_at` / `metric_*`(placeholder，實際 metric schema 未定) / `source_key`(R2 參照) / `ingested_at` / 可選 `schema_version`；**(device, captured_at) UNIQUE** + 時間序列索引；每筆 INSERT 保留歷史；衝突 DO NOTHING 防呆。Issue #4 五條驗收條件改版後仍全數滿足（見報告第 10 節）。
- 還缺（需人再決定，不阻塞設計方向）：①第一版實際 metric 欄位清單（建議人給代表性 json 樣本）②drizzle 穩定版 vs beta ③device 來源(json 欄位/檔名/metadata) ④(device,captured_at) 衝突語意(建議 DO NOTHING)。
- 下一棒：**人為確認**改版內容。足夠 → PR 推送收尾，把本 Issue 移到 `/closed`（人手動）；不足 → 留在 Research Agent 續補。
