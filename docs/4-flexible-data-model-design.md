# Issue #4 研究報告：抗變動的清洗層與 D1 資料層設計

> 🪐 CANARY-SATURN-38
> 對應 Issue：`issue/4-research-flexible-data-model-design.md`（研究型）
> 角色：Research Agent ｜ 初版：2026-06-28 ｜ **改版：2026-06-28（依人最終決定改寫，主推方案 D→A）**

---

## 0. 一句話結論（給趕時間的人）

> **本節為改版後結論（人已拍板）。** 原研究初版推薦「混合式 JSON payload（方案 D）」；
> 人為確認後**覆寫**為 **方案 A：正規化時間序列表**。下面結論依最終決定撰寫，
> 四方案比較（第 3 節）保留為「為何最終選 A」的脈絡。

在「輸入 json 無固定 schema、清洗後只保存必要欄位、web 端要看時間序列」的前提下，
D1 採 **正規化時間序列表**：一欄一欄存正式欄位，**每次上傳 insert 一筆**（保留歷史），
以 **(device, captured_at)** 當唯一鍵＋時間序列查詢索引＋重複資料防呆。
抗變動**不靠**彈性欄位，改由三件事撐住：
①**R2 永久保留原始檔**（可重清洗 / backfill）②**Drizzle 管 schema 與 migration** ③**獨立清洗層 + Zod 輸入審核表**。
全正規化的代價是「新增欄位需 migration」——**人已理解並接受此取捨**。

---

## 1. 研究問題（這份報告要回答的決策）

Issue #4 要解掉一個「人都高度不確定、且彼此綁定」的決策：

1. D1（SQLite）在「欄位日後會變」前提下要怎麼存？（儲存策略比較，至少 3 種）
2. 清洗 / 轉換層要怎麼獨立成一層，讓 schema 變動只改這一層、不擴散到 API 與儲存？
3. 給一份可行動的建議：D1 結構 / 策略、清洗層介面邊界、schema 演進 / 遷移方向。
4. 順帶評估人提出的方向：①輸入審核表（缺欄位就擋）②欄位對應方式 ③DB schema 用 Drizzle。
5. 標明此設計如何同時服務 #5（清洗）、#6（存 D1）、#7（取數 GET）。

---

## 2. 調查過程與佐證

- 查證 Drizzle ORM 對 Cloudflare D1 的官方支援與遷移流程（官方文件，非憑記憶）。
- 查證 drizzle-zod 能否從單一定義推導型別 / 驗證 / 表結構，以及它的「方向」。
- 比較四種 SQLite/D1 儲存策略在「改動成本 / 查詢能力 / web 取數方便度」的取捨。

佐證連結見文末〈附錄 A〉。關鍵事實：

- **Drizzle + D1 可用且為官方支援**：`import { drizzle } from 'drizzle-orm/d1'`，在 Worker 內 `const db = drizzle(env.DB)` 即可。
- **遷移流程**：`drizzle-kit generate`（從 TS schema 產生 SQL migration）→ `wrangler d1 migrations apply`（用 Cloudflare 原生遷移系統套用）。`wrangler.jsonc` 的 `d1_databases[].migrations_dir` 指到 `drizzle/migrations`。也可用 `drizzle-kit push` 在本地快速試 schema。
- **drizzle-zod 的方向是「表 → Zod」**（`createInsertSchema` / `createSelectSchema` / `createUpdateSchema`），即 Drizzle 表是來源、Zod 驗證是衍生物。**它不會反過來從 Zod 生表**。
- 註：`drizzle-orm@1.0.0-beta.15` 起 drizzle-zod 被內建的 `drizzle-orm/zod` 取代。**目前（穩定版）建議仍用 `drizzle-zod`**，beta 才用 `drizzle-orm/zod`。

---

## 3. D1 儲存策略比較（至少 3 種）

對照維度：**新增/移除欄位的改動成本**、**查詢能力（SQL/索引）**、**web 端取數方便度**、**抗變動程度**。

### 方案 A：全正規化欄位表（one column per field）★ **最終採用**
- 結構：`CREATE TABLE metric (id, device, captured_at, cpu REAL, mem REAL, latency REAL, ...)`，每個清洗後欄位一個 DB 欄位。
- 改動成本：**新增欄位需 migration**（改 Zod 審核表 + 加 Drizzle 欄位 + 產 migration）。**人已接受此代價**，並用 R2 原始檔 backfill 來補舊資料。
- 查詢能力：**最佳**。可直接 WHERE / 索引 / 聚合，特別適合 **(device, captured_at) 時間序列查詢**。
- web 取數：**最佳**。欄位即回傳欄位，#7 直接 select 後序列化，無需解析 JSON。
- 抗變動：欄位變動本身成本高，但**本專案清洗層只洗出必要欄位才存**，欄位集合相對收斂；抗變動改由 R2 + 清洗層 + Drizzle migration 撐住（見第 0、6 節）。

### 方案 B：JSON 欄位（彈性資料塞進一個 JSON/TEXT column）
- 結構：`snapshot (id, ..., payload TEXT)`，清洗後資料整包序列化進 `payload`。
- 改動成本：低（多半免 migration）。查詢能力：中（JSON1 `json_extract`，可加 generated column 升級）。web 取數：好（整包回傳）。抗變動：佳。
- 為何**未採用**：人指出清洗層本就只保存必要欄位，沒必要把已知欄位藏進 JSON；且時間序列查詢用真欄位 + 索引更直接、更好維護。JSON 內無 DB 層約束、臨機查詢不順手。

### 方案 C：EAV / key-value（entity-attribute-value）
- 結構：`attribute(snapshot_id, key, value, type)`，一筆拆成多列。
- 改動成本：最低（schema 永不動）。但查詢需 pivot / self-join、型別遺失、web 取數差、#7 會很複雜。
- 為何**未採用**：與 #7 的「回結構化時間序列 JSON」需求衝突，複雜度轉嫁到每次讀寫，對本專案過度設計。

### 方案 D：混合式（穩定信封欄位 + JSON payload）— 原研究初版推薦，已被覆寫
- 結構：少數穩定真欄位 + 一個 `payload` JSON 欄位。
- 改動成本低、抗變動佳，但 payload 內無 DB 約束、查詢需 JSON1。
- 為何**未採用**：人選擇用全正規化換取最佳查詢能力與最簡單的 #7 取數路徑，並接受「新增欄位需 migration」的代價。

### 比較總表

| 維度 | A 全正規化（採用） | B JSON 欄位 | C EAV | D 混合（初版推薦） |
|---|---|---|---|---|
| 加/減欄位成本 | 高（需 migration） | 低 | 最低 | 低 |
| 查詢/索引能力 | **最佳** | 中（JSON1/可升級） | 差 | 中→可成長 |
| web 取數方便 | **最佳** | 好 | 差 | 好 |
| 抗變動（欄位變動本身） | 較弱（靠外部三件事補） | 佳 | 表面強/維護重 | 最佳 |
| 時間序列查詢契合 | **最佳** | 中 | 差 | 中 |

**最終採用：方案 A（正規化時間序列表）。**
人的判斷：清洗層只洗出必要欄位才存，DB 直接一欄一欄存即可；web 要的是時間序列，正規化 + 索引最直接。
欄位變動的脆弱性，改由「R2 永久原始檔 + Drizzle migration + 獨立清洗層」三件事補足（取捨已被接受）。

---

## 4. 對人提出方向的評估

### 方向 ①：輸入「審核表」——宣告必須欄位、缺欄位就擋 → **採納（精修，沿用）**
- 採納。這是 schema validation / 白名單，在入口擋掉壞資料，是抗變動的起點。
- 精修：用 **Zod** 把審核表寫成程式化契約；區分「**硬必填**（缺就 reject）」與「**選填**（給預設值 / 允許 null）」；不論通過與否，原始 json 都已先存 R2（#3），被擋的 payload 可回溯重灌；錯誤回應指出「缺哪個欄位 / 型別不符」。

### 方向 ②：欄位對應方式 → **用宣告式程式對應（不靠註解）**
- 註解不被編譯器檢查、不被測試覆蓋、容易脫節，正是欄位變動時最會悄悄爛掉的東西。
- 改用程式化宣告：輸入端 Zod schema 宣告每欄（名稱/型別/必填）；清洗層的轉換函式以程式表達「raw json 欄位 → 正規化欄位」的對應。
- **在正規化方案下**：清洗層輸出的正規化欄位會 **1:1 對應到 D1 真欄位**，對應關係由 Drizzle 表型別 + `z.infer` 型別在編譯期把關，對不上會編譯錯誤——比註解可靠得多。
- 若要人類可讀的欄位清單，由 Zod schema 程式產生對照表，而非手寫註解。

### 方向 ③：DB schema 用 Drizzle 解決 → **採納（已查證可行，且為抗變動三支柱之一）**
- Drizzle 官方支援 D1，遷移成熟：`drizzle-kit generate` → `wrangler d1 migrations apply`。
- 用法：用 Drizzle 定義正規化時間序列表，遷移檔放 `drizzle/migrations`，在 `wrangler.jsonc` 設 `migrations_dir`。
- 在正規化方案中 Drizzle 角色更吃重：**每次欄位變動都會走一次 migration**，因此遷移流程必須順、必須進版控。
- 注意：穩定版用 `drizzle-zod`；`drizzle-orm@beta` 才用內建 `drizzle-orm/zod`。建議先用穩定版。

### 關於「single source of truth」與 drizzle-zod 方向（沿用初版發現）
- drizzle-zod 方向是 **表 → Zod**，不能從 Zod 反推表。輸入≠資料表，硬壓成一份會把兩種變動耦死。
- 仍建議**兩份各自最小、由清洗層當唯一橋樑**：輸入 source of truth = Zod 審核表；儲存 source of truth = Drizzle 正規化表。
- **在正規化方案下兩者欄位高度一致**（清洗輸出 1:1 進 DB 欄位），可選擇用 `drizzle-zod` 由 Drizzle 表 `createSelectSchema` 衍生 #7 的回應驗證，減少重複；但**輸入審核表仍以手寫 Zod 為主**（因輸入 json 結構與 DB 欄位的命名/型別在清洗前未必一致）。

---

## 5. 建議架構（資料流與分層邊界）

```
POST /upload
  │  原始 .json
  ▼
[#2 upload handler] ──► [#3 存 R2 原始檔（保留歷史，永遠先存）]
  │  raw payload
  ▼
┌──────────────────────── #5 清洗 / 轉換層（純函式，不碰 binding）──────────────────────┐
│  1) 輸入審核：Zod 輸入 schema 驗證（缺硬必填 → reject）                                  │
│  2) 正規化：型別轉換 / 預設值 / 過濾多餘欄位 / 統一欄位名（對齊 D1 欄位）                │
│  3) 產出「正規化平面紀錄」(typed via z.infer)：device + captured_at + 各度量欄位         │
│     輸出純資料，不寫 DB                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────┘
  │  NormalizedRecord（平面欄位，1:1 對應 D1 欄位）
  ▼
┌──────────────────────── #6 儲存層（drizzle/d1）─────────────────────────────────────────┐
│  Drizzle 正規化時間序列表：device、captured_at、度量欄位、source/R2 參照、ingested_at... │
│  每次上傳 INSERT 一筆（保留歷史）；(device, captured_at) UNIQUE 做重複防呆               │
│  drizzle-kit migrations                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────┘
  │
  ▼
[#7 GET /data（掛 #1 auth）] ──► 讀 D1（依 device / 時間範圍）→ 回時間序列結構化 JSON 給 web
```

### 建議的 D1 正規化時間序列表（示意，非實作，#6 才落地）

> 以下僅為**設計示意**，說明欄位用途；真正的 Drizzle 定義與建表由 #6 實作。
> 實際的度量(metric)欄位 schema **尚未定案**，以 placeholder 表示，由 #5/#6 依當時清洗結果落地。

| 欄位 | 用途 | 備註 |
|---|---|---|
| `id` | 主鍵（autoincrement） | 穩定 |
| `device` | 裝置識別 | 唯一鍵 + 查詢索引的一部分 |
| `captured_at` | 資料量測/產生時間（epoch ms） | 唯一鍵 + 時間序列排序/範圍查詢 |
| `metric_*`（placeholder） | 清洗後的各度量正規化欄位 | 實際欄位待 schema 定案；新增走 migration |
| `source_key` | R2 原始檔 key | 回溯原始檔 / backfill 依據 |
| `ingested_at` | 寫入時間 | 稽核 |
| `schema_version`（可選） | 清洗結構版本 | 支援演進（見第 6 節） |

- **唯一鍵 / idempotency**：對 **(device, captured_at) 建 UNIQUE**。同裝置同時間視為同一筆，重複上傳不重存（`INSERT ... ON CONFLICT(device, captured_at) DO NOTHING`，或先查再插）。這同時是 R2/D1 重複資料防呆。
- **時間序列索引**：以 **(device, captured_at)** 為複合索引（UNIQUE 本身即可作為此查詢的索引），支撐 #7 依裝置取一段時間範圍。
- **保留歷史**：**每次上傳 INSERT 一筆**（不是 upsert 覆蓋），D1 因此可查時間變化。

### 正規化平面紀錄（清洗層輸出，示意）

```ts
// 僅示意設計，非要求的實作碼
type NormalizedRecord = {
  device: string;
  capturedAt: number;        // epoch ms，已正規化
  sourceKey: string;         // R2 原始檔 key
  schemaVersion?: number;
  // 各度量欄位：1:1 對應 D1 真欄位（實際欄位待 schema 定案）
  // 例如：cpu?: number; mem?: number; latency?: number; ...
};
```

---

## 6. Schema 演進 / 遷移方向（正規化版）

正規化方案下「新增欄位需 migration」，流程必須順。抗變動靠以下機制：

1. **新增 / 改名 一個欄位**
   → 改 **#5 的 Zod 審核表 + 正規化邏輯** ＋ 在 **#6 的 Drizzle 表加欄位** → `drizzle-kit generate` 產 migration → `wrangler d1 migrations apply`。
   → 新欄位對舊資料為 NULL；需要補值時，用 **R2 原始檔 backfill**（重跑清洗寫回該欄位）。

2. **移除欄位**
   → 從 Zod / Drizzle 移除並產 migration。SQLite 對 drop column 支援有限，必要時走「建新表 → 搬資料 → 換名」的 migration（drizzle-kit 會處理）。舊資料仍可由 R2 重建。

3. **清洗結構大改版（不相容）**
   → bump `schema_version`，新資料寫新版；#7 依版本解讀，或一次性用 R2 原始檔 backfill 重建全表。

4. **遷移執行方式**
   → `drizzle-kit generate` → 進版控（`drizzle/migrations`）→ `wrangler d1 migrations apply`（本地與遠端各一次）。本地試 schema 可用 `drizzle-kit push`。

> 安全網原則：**R2 永久保有原始 json（#3）**，任何欄位/結構決策都可回溯重清洗、backfill。這是正規化方案能維持抗變動的關鍵支柱。

---

## 7. 各棒實作邊界（#5 / #6 / #7 照這個做）

### #5 清洗 / 轉換層
- **擁有**：Zod 輸入審核表（白名單，缺硬必填 reject、區分必填/選填）、raw → 正規化平面紀錄的轉換、欄位對應規則（程式化，非註解）、缺漏/異常/多餘欄位處理。
- **輸出**：`NormalizedRecord`（typed，平面欄位，1:1 對應 D1 欄位，含 device、capturedAt、sourceKey、各度量欄位）。
- **邊界**：純函式，**不碰 R2 / D1 binding**，可單獨測試。
- **抗變動責任**：json 輸入結構變動時，輸入端對應改動侷限在本層（DB 欄位變動則連動 #6 的 migration）。
- **不做**：不落庫、不定義 DB 表。

### #6 儲存層（D1）
- **擁有**：Drizzle 正規化時間序列表定義（device / captured_at / 度量欄位 / source_key / ingested_at / 可選 schema_version）、**(device, captured_at) UNIQUE**、時間序列索引、drizzle-kit migrations、`wrangler.jsonc` 的 D1 binding 與型別。
- **寫入**：輸入 #5 的 `NormalizedRecord`，**每次 INSERT 一筆（保留歷史）**；以 (device, captured_at) 唯一鍵做**重複防呆**（衝突則不重存）。
- **邊界**：獨立模組（如 `src/data/store.ts`）。
- **不做**：不重做清洗、不設計輸入契約（用 #5）、不做 GET。

### #7 取數 GET API
- **擁有**：`GET /data` 路由（掛 #1 auth）、依 device / 時間範圍從 D1 讀**時間序列**、組成 web 友善 JSON、空結果（非錯誤）、讀取失敗回 5xx。
- **邊界**：因正規化，序列化簡單（select 後直接吐欄位）；基本查詢用 (device, captured_at) 索引取一段時間序列（最小實作可先「依裝置取最新 N 筆 / 全部」，範圍篩選依 web 需求逐步加）。
- **不做**：不寫入、不重設計資料層、不做複雜聚合（另開 Issue）。

---

## 8. 建議採用的套件（供 #5/#6 規劃，非本棒安裝）

- `drizzle-orm`（含 `drizzle-orm/d1`）— D1 連接與查詢。
- `drizzle-kit`（dev）— 產生 / 管理 migration（正規化方案下會頻繁用到）。
- `zod` — 輸入審核表（#5）。
- `drizzle-zod`（穩定版；beta 改用內建 `drizzle-orm/zod`）— 可由 Drizzle 表 `createSelectSchema` 衍生 #7 回應驗證；輸入審核表仍以手寫 Zod 為主。

> 套件管理用 **pnpm**（依專案慣例）。實際安裝在 #5 / #6 進行。

---

## 9. 還缺什麼 / 需要人再決定的點

> 人最終決定已解掉原報告的問題 1（自然鍵）、2（保留歷史）、3（查詢需求）。剩餘：

1. **實際度量(metric)欄位 schema**：目前 metric_* 為 placeholder，真正欄位清單尚未定案。#5/#6 動工時需依當時的 json 樣本與 web 需求確定第一版欄位集合（之後新增走 migration）。建議人提供一兩份代表性 json 樣本給 #5。
2. **drizzle 穩定版 vs beta**：建議先用穩定版 + `drizzle-zod`；若想用內建 `drizzle-orm/zod` 需接受 beta 風險。請人拍板。
3. **device 的來源**：device 識別是來自 json 內某欄位、檔名、還是上傳 metadata？影響 #5 的擷取邏輯與 #2/#3 是否需帶 device 資訊。建議人確認。
4. **(device, captured_at) 衝突時的語意**：確認「DO NOTHING（保留先到的）」即可，還是要「以後到的覆蓋」？預設建議 DO NOTHING（純防呆、不改歷史）。

> 這些不阻塞整體設計方向；1、3 建議在 #5 動工前由人補；2、4 可在 #6 動工前確認。

---

## 10. Issue #4 驗收條件對照（改版後仍滿足）

- [x] `docs/` 下有一份設計報告 → 本檔。
- [x] 比較了至少 3 種 D1 儲存策略並給出推薦與理由 → 第 3 節（A/B/C/D 四種，最終推薦 A，並說明為何不選 B/C/D）。
- [x] 說明清洗/轉換層如何獨立、schema 變動時改動如何被侷限 → 第 5、6、7 節（純函式清洗層 + 三支柱抗變動）。
- [x] 給出建議 D1 結構/策略 + 未來欄位變動演進方向 → 第 5、6 節（正規化時間序列表 + migration/backfill 演進）。
- [x] 明確指出 #5、#6、#7 各自實作邊界 → 第 7 節。

---

## 附錄 A：佐證來源

- Drizzle ORM — Cloudflare D1 連接（官方）：https://orm.drizzle.team/docs/connect-cloudflare-d1
- Drizzle ORM — D1 HTTP with Drizzle Kit（遷移，官方）：https://orm.drizzle.team/docs/guides/d1-http-with-drizzle-kit
- Get Started with Drizzle and D1（官方）：https://orm.drizzle.team/docs/get-started/d1-new
- Drizzle ORM — Zod 整合（drizzle-zod，方向與棄用說明，官方）：https://orm.drizzle.team/docs/zod
- drizzle-zod README（GitHub）：https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-zod/README.md
- Cloudflare D1 — community projects（含 Drizzle）：https://developers.cloudflare.com/d1/reference/community-projects/

> 驗證範圍說明：本報告未在本機安裝套件或建表（依研究型 Issue 規範不改 `src/`、不建表）。Drizzle + D1 的可行性與遷移流程以官方文件查證為準；SQLite 對 drop column 的限制為 SQLite 既有特性。

---

## 附錄 B：改版紀錄

- **2026-06-28 初版**：主推方案 D（混合式 JSON payload + 信封欄位）。
- **2026-06-28 改版（人最終決定覆寫）**：主推方案改為 A（正規化時間序列表）。
  - D1 不採 JSON payload，改全正規化欄位。
  - 保留歷史：每次上傳 INSERT 一筆（非 upsert 覆蓋）。
  - 查詢需求＝時間序列；自然鍵 / 唯一鍵 / 索引＝ (device, captured_at)。
  - 抗變動改由：R2 永久原始檔 + Drizzle migration + 獨立清洗層(Zod 審核表) 三支柱維持；接受「新增欄位需 migration」的代價。
  - 連動改寫：第 0、3、4、5、6、7、8、9 節與表結構、範例片段、各棒邊界。
