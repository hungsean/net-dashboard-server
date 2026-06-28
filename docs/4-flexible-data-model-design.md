# Issue #4 研究報告：抗變動的清洗層與 D1 資料層設計

> 🪐 CANARY-SATURN-38
> 對應 Issue：`issue/4-research-flexible-data-model-design.md`（研究型）
> 角色：Research Agent ｜ 日期：2026-06-28

---

## 0. 一句話結論（給趕時間的人）

在「輸入 json 無固定 schema、D1 欄位日後會變」的前提下，**不要走全正規化、也不要走純 EAV**，而是採用
**混合式：穩定「信封欄位」(envelope) + 一個 JSON payload 欄位** 來存清洗後資料；
用 **Zod 當「輸入審核表」(single source of truth for input)**、用 **Drizzle 管 D1 表與遷移**，
兩者之間靠一個**獨立的清洗層**當唯一橋樑。
「欄位對應靠註解」**不建議**——改用程式化的宣告（Zod schema + 明確的 mapping 函式），可被型別檢查與測試保護。

---

## 1. 研究問題（這份報告要回答的決策）

Issue #4 要解掉一個「人都高度不確定、且彼此綁定」的決策：

1. D1（SQLite）在「欄位日後會變」前提下要怎麼存？（儲存策略比較，至少 3 種）
2. 清洗 / 轉換層要怎麼獨立成一層，讓 schema 變動只改這一層、不擴散到 API 與儲存？
3. 給一份可行動的建議：D1 結構 / 彈性策略、清洗層介面邊界、schema 演進 / 遷移方向。
4. 順帶評估人提出的三點方向：①輸入審核表（缺欄位就擋）②欄位對應靠註解 ③DB schema 用 Drizzle。
5. 標明此設計如何同時服務 #5（清洗）、#6（存 D1）、#7（取數 GET）。

---

## 2. 調查過程與佐證

- 查證 Drizzle ORM 對 Cloudflare D1 的官方支援與遷移流程（官方文件，非憑記憶）。
- 查證 drizzle-zod 能否從單一定義推導型別 / 驗證 / 表結構，以及它的「方向」。
- 比較四種 SQLite/D1 儲存策略在「改動成本 / 查詢能力 / web 取數方便度」的取捨。

佐證連結見文末〈附錄 A〉。關鍵事實：

- **Drizzle + D1 可用且為官方支援**：`import { drizzle } from 'drizzle-orm/d1'`，在 Worker 內 `const db = drizzle(env.DB)` 即可。
- **遷移流程**：`drizzle-kit generate`（從 TS schema 產生 SQL migration）→ `wrangler d1 migrations apply`（用 Cloudflare 原生遷移系統套用）。`wrangler.jsonc` 的 `d1_databases[].migrations_dir` 指到 `drizzle/migrations`。也可用 `drizzle-kit push` 在本地快速試 schema。
- **drizzle-zod 的方向是「表 → Zod」**（`createInsertSchema` / `createSelectSchema` / `createUpdateSchema`），即 Drizzle 表是來源、Zod 驗證是衍生物。**它不會反過來從 Zod 生表**。這點直接影響第 4 節的「single source of truth」評估。
- 註：`drizzle-orm@1.0.0-beta.15` 起 drizzle-zod 被內建的 `drizzle-orm/zod` 取代。**目前（穩定版）建議仍用 `drizzle-zod`**，beta 才用 `drizzle-orm/zod`。

---

## 3. D1 儲存策略比較（至少 3 種）

對照維度：**新增/移除欄位的改動成本**、**查詢能力（SQL/索引）**、**web 端取數方便度**、**抗變動程度**。

### 方案 A：全正規化欄位表（one column per field）
- 結構：`CREATE TABLE metric (id, cpu REAL, mem REAL, latency REAL, ...)`，每個 json 欄位一個 DB 欄位。
- 改動成本：**高**。每次 json 多/少一個欄位 → 改 Drizzle schema + 產 migration + 改清洗 mapping + 可能改 API。變動會穿透三層。
- 查詢能力：**最佳**。可直接 WHERE / 索引 / 聚合。
- web 取數：**最佳**。欄位即回傳欄位。
- 抗變動：**最差**。與人的核心約束（欄位會變、別讓開發難度過大）正面衝突。
- 適用：schema 已穩定、查詢/聚合需求重的場景。**本專案前提不符。**

### 方案 B：JSON 欄位（彈性資料塞進一個 JSON/TEXT column）
- 結構：`CREATE TABLE snapshot (id, ..., payload TEXT)`，清洗後資料整包序列化成 JSON 存 `payload`。
- 改動成本：**低**。json 多/少欄位 → 多半只改清洗層，DB **不需 migration**。
- 查詢能力：**中**。SQLite/D1 內建 JSON1 函式（`json_extract(payload,'$.cpu')`）可查；必要時可加 **generated column + index** 把熱門欄位「升級」成可索引欄位。但臨機查詢不如真欄位順手。
- web 取數：**好**。整包 JSON 直接回傳，#7 幾乎是 `JSON.parse` 後吐出去。
- 抗變動：**佳**。變動被關在清洗層。
- 風險：payload 內部無 DB 層約束（靠清洗層保證）；大 payload 佔 row 空間（D1 有 row/DB 大小上限，dashboard 快照級資料無虞）。

### 方案 C：EAV / key-value（entity-attribute-value）
- 結構：`attribute(snapshot_id, key, value, type)`，一筆資料拆成多列 key/value。
- 改動成本：**最低**（schema 永遠不動，加欄位只是多幾列）。
- 查詢能力：**差**。要取一筆完整資料得 pivot / 多次 self-join；型別遺失（value 多半存字串）。
- web 取數：**差**。要在應用層重組成物件，#7 會變複雜。
- 抗變動：表面最強，但把複雜度轉嫁到「每一次讀寫」，長期維護成本高。
- 適用：欄位集合真的高度動態、且不需結構化查詢時。**本專案 #7 要回結構化 JSON，不划算。**

### 方案 D：混合式（**建議**）= 穩定信封欄位 + JSON payload（+ 視需要升級熱門欄位）
- 結構：少數**穩定**的真欄位（信封/中繼資料）+ 一個 `payload` JSON 欄位裝彈性資料。
- 改動成本：**低**。日常欄位變動只改清洗層；只有當某欄位變成「常用查詢/排序鍵」時，才把它「升級」成真欄位（generated column 或新欄位 + 一次 migration）。
- 查詢能力：**中→可成長**。信封欄位（時間、來源、版本）可直接索引查詢；payload 用 JSON1 查；熱門欄位可漸進升級。
- web 取數：**好**。回傳 = 信封欄位 + 整包 payload。
- 抗變動：**最符合需求**——把「會變的」關進 payload + 清洗層，「不會變的」放真欄位。

### 比較總表

| 維度 | A 全正規化 | B JSON 欄位 | C EAV | D 混合（建議） |
|---|---|---|---|---|
| 加/減欄位成本 | 高（穿透三層） | 低 | 最低 | 低 |
| 查詢/索引能力 | 最佳 | 中（JSON1/可升級） | 差 | 中→可成長 |
| web 取數方便 | 最佳 | 好 | 差 | 好 |
| 抗變動程度 | 最差 | 佳 | 表面強/維護重 | 最佳 |
| 與本專案契合 | ✗ | ◯ | ✗ | ✓✓ |

**推薦：方案 D（混合式）。** 理由：完全對齊人的核心約束（欄位會變、別讓開發難度過大），又保留必要的查詢能力與最簡單的 #7 取數路徑；EAV 的彈性對本專案是過度設計，全正規化則太脆。

---

## 4. 對人提出三點方向的評估

### 方向 ①：輸入「審核表」——宣告必須欄位、缺欄位就擋 → **採納（精修）**
- 採納。這正是 schema validation / 白名單，能在入口擋掉壞資料，是抗變動的好起點。
- 精修建議：
  - 用 **Zod** 把「審核表」寫成程式化的輸入契約（見方向②）。
  - 區分「**硬必填**（缺就 reject）」與「**選填**（給預設值 / 允許 null）」，避免一有小變動整批被擋。
  - **不論通過與否，原始 json 都已先存 R2（#3）**；被擋下的 payload 仍可回溯重灌，不會遺失。
  - 回應要清楚指出「缺哪個欄位 / 哪個型別不符」，方便上游修正。

### 方向 ②：欄位對應「靠註解」 → **不建議，改用宣告式程式對應**
- 問題：註解**不被編譯器檢查、不被測試覆蓋、容易與程式脫節**——正是最會在「欄位變動」時悄悄爛掉的東西，跟抗變動目標背道而馳。
- 建議替代：把「對應」寫成**程式化的宣告**，由型別系統與單元測試保護：
  - 輸入端用 **Zod schema** 宣告每個欄位（名稱、型別、必填與否）。
  - 「json 欄位 → 儲存」的對應放在**清洗層的轉換函式**裡，以程式表達。
  - **關鍵簡化**：因為儲存採方案 D 的 JSON payload，「json 欄位 → DB 欄位」這個對應**大部分塌縮成「json 欄位 → payload 內的標準鍵名」**，也就是清洗轉換本身。需要逐欄對應到「真欄位」的，只有少數被升級的信封/熱門欄位——對應點變得很少、很集中。
  - 若仍想要一份「人類可讀的欄位清單」，可額外輸出一份由 Zod schema 程式產生的對照表（而不是手寫註解），確保「文件 = 程式」永不脫節。

### 方向 ③：DB schema 用 Drizzle 解決 → **採納（已查證可行）**
- 採納。Drizzle 官方支援 Cloudflare D1，遷移流程成熟：`drizzle-kit generate` → `wrangler d1 migrations apply`。
- 用法：用 Drizzle 定義方案 D 的**信封表**（少數穩定真欄位 + `payload` 以 `text({ mode: 'json' })` 宣告），遷移檔放 `drizzle/migrations`，在 `wrangler.jsonc` 設 `migrations_dir`。
- 注意：穩定版用 `drizzle-zod`；`drizzle-orm@beta` 才用內建 `drizzle-orm/zod`。本專案建議先用穩定版。

### 關於「能否從同一份定義推導 型別 / 驗證 / 表結構」——誠實的發現
- drizzle-zod 的方向是 **表 → Zod**（Drizzle 表為來源，衍生出 Zod 驗證與型別）。它**不能**從 Zod 反推出 Drizzle 表。
- 因此「**一份定義同時驅動輸入驗證 + json→DB 對應 + 表結構**」在本專案**無法乾淨達成**，原因是：**輸入 json 不是資料表**——輸入契約與儲存結構是兩個不同關注點，輸入端還會「無固定 schema 且頻繁變動」。硬把兩者壓成一份反而把兩種變動耦在一起。
- 因此建議的不是「一份 source of truth」，而是**兩份各自最小、且只由清洗層連接**：
  - **輸入的 source of truth = Zod 輸入 schema**（審核表）。型別用 `z.infer` 取得，餵給清洗層。
  - **儲存的 source of truth = Drizzle 信封表**（含 payload）。因為信封表很少變，這份幾乎不動。
  - **清洗層 = 兩者之間唯一、明確、可測試的橋樑。**
- 這樣設計反而**比強行一份 schema 更抗變動**：輸入端的變動（json 欄位增減）只撞到 Zod schema + 清洗層；儲存端（真欄位升級）只撞到 Drizzle 表 + migration；兩種變動互不牽連。

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
│  2) 正規化：型別轉換 / 預設值 / 過濾多餘欄位 / 統一鍵名                                  │
│  3) 產出「canonical 中間結構」(typed via z.infer) + 信封中繼資料                         │
│     輸出純資料，不寫 DB                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────┘
  │  { envelope, payload }
  ▼
┌──────────────────────── #6 儲存層（drizzle/d1）─────────────────────────────────────────┐
│  Drizzle 信封表：穩定真欄位 + payload(JSON)                                              │
│  序列化 canonical → payload；upsert by 自然鍵；drizzle-kit migrations                    │
└──────────────────────────────────────────────────────────────────────────────────────┘
  │
  ▼
[#7 GET /data（掛 #1 auth）] ──► 讀 D1 → 反序列化 payload → 回結構化 JSON 給 web
```

### 建議的 D1 信封表（示意，非實作，#6 才落地）

> 以下僅為**設計示意**，說明欄位用途；真正的 Drizzle 定義與建表由 #6 實作。

| 欄位 | 用途 | 為何放真欄位（而非 payload） |
|---|---|---|
| `id` | 主鍵 | 穩定 |
| `source_key` | R2 原始檔 key / 自然鍵 | 用於 upsert 去重、回溯原始檔 |
| `captured_at` | 資料量測/產生時間 | dashboard 必用的查詢/排序鍵 → 需索引 |
| `ingested_at` | 寫入時間 | 稽核、排序 |
| `schema_version` | 清洗結構版本 | 支援演進（見第 6 節） |
| `payload` | 清洗後彈性資料（JSON/TEXT, `mode:'json'`） | **會變的全部關在這** |

- **去重/更新策略**：以 `source_key`（或 `captured_at` + 來源）為自然鍵做 **upsert**（`ON CONFLICT DO UPDATE`），避免同一份資料重灌堆積髒資料（對齊 #6 驗收）。
- **索引**：對 `captured_at`、`source_key` 建索引。payload 內若有高頻查詢欄位，再用 generated column + index「升級」。

### canonical 中間結構（清洗層輸出，示意）

```ts
// 僅示意設計，非要求的實作碼
type CanonicalSnapshot = {
  envelope: {
    sourceKey: string;
    capturedAt: number;   // epoch ms，已正規化
    schemaVersion: number;
  };
  payload: Record<string, unknown>; // 由 Zod 驗證過、鍵名已統一的彈性資料
};
```

---

## 6. Schema 演進 / 遷移方向

抗變動的關鍵是「**不同變動撞到不同地方，且都很小**」：

1. **新增/移除/改名 一個 json 輸入欄位**（最常見）
   → 只改 **#5 清洗層的 Zod schema + 轉換**。DB **不需 migration**（資料進 payload）。
   → 改名時在清洗層做相容對應（舊鍵 → 新鍵），歷史 payload 不必回填。

2. **某 payload 欄位變成高頻查詢/排序鍵**（需要索引）
   → 在 **#6** 用 generated column（`json_extract(payload,'$.x')`）+ index「升級」，或加一個真欄位由清洗層回填。**一次 migration**，影響面集中在 #6。

3. **清洗結構本身大改版**（不相容）
   → bump `schema_version`。新資料寫新版；#7 讀取時依 `schema_version` 決定如何解讀，或提供一個 payload 正規化讀取器。舊資料留在 R2 可隨時重灌。

4. **遷移執行方式**
   → `drizzle-kit generate` 產 SQL → 進版控（`drizzle/migrations`）→ `wrangler d1 migrations apply` 套用（本地與遠端各一次）。本地試 schema 可用 `drizzle-kit push`。

> 原則：**R2 永遠保有原始 json（#3）**，所以任何清洗/結構決策都可回溯重灌——這是整個抗變動設計的安全網。

---

## 7. 各棒實作邊界（#5 / #6 / #7 照這個做）

### #5 清洗 / 轉換層
- **擁有**：Zod 輸入 schema（審核表 / 白名單）、raw → canonical 的轉換、欄位對應規則、缺漏/異常/多餘欄位處理。
- **輸出**：`CanonicalSnapshot`（typed），純資料。
- **邊界**：純函式，**不碰 R2 / D1 binding**，可單獨測試（對齊 #5 驗收）。
- **抗變動責任**：json 結構變動時，**改動必須侷限在本層**。
- **不做**：不落庫、不定義 DB 表。

### #6 儲存層（D1）
- **擁有**：Drizzle 信封表定義 + `payload` JSON 欄位、drizzle-kit migrations、`wrangler.jsonc` 的 D1 binding 與型別、序列化 canonical → payload、upsert by 自然鍵。
- **邊界**：獨立模組（如 `src/data/store.ts`），輸入 #5 的 `CanonicalSnapshot`，寫入 D1。
- **不做**：不重做清洗、不設計輸入契約（用 #5）、不做 GET。

### #7 取數 GET API
- **擁有**：`GET /data` 路由（掛 #1 auth）、讀 D1（信封欄位查詢 + 反序列化 payload）、組成 web 友善 JSON、空結果（非錯誤）、讀取失敗回 5xx。
- **邊界**：因採 JSON payload，序列化幾乎是「讀列 → parse payload → 合併信封欄位 → 回傳」。基本查詢用信封欄位（如依 `captured_at` 取最新）。
- **不做**：不寫入、不重設計資料層、不做複雜聚合（另開 Issue）。

---

## 8. 建議採用的套件（供 #6 規劃，非本棒安裝）

- `drizzle-orm`（含 `drizzle-orm/d1`）— D1 連接與查詢。
- `drizzle-kit`（dev）— 產生 / 管理 migration。
- `zod` — 輸入審核表（#5）。
- `drizzle-zod`（穩定版；beta 改用內建 `drizzle-orm/zod`）— 若要為「已升級的真欄位」由表衍生 DB-shape 驗證時才需要；輸入端的審核表仍以手寫 Zod 為主。

> 套件管理用 **pnpm**（依專案慣例）。實際安裝在 #5 / #6 進行。

---

## 9. 還缺什麼 / 需要人決定的點

1. **自然鍵怎麼定**：用 R2 的 object key、檔名、還是 payload 內的某時間戳？影響 #6 的 upsert 去重。建議優先用 R2 object key（一定唯一且可回溯），請人確認。
2. **是否需要保留每次上傳的歷史快照於 D1**（多筆），或同一來源只留最新一筆（upsert 覆蓋）？兩種都支援，取決於 dashboard 是否要看時間序列。請人指定。
3. **#7 的查詢需求**：web 只要「最新一筆」還是「一段時間範圍/篩選」？這決定哪些 payload 欄位要先「升級」成索引欄位。可先最小實作（最新一筆），日後再升級。
4. **drizzle 穩定版 vs beta**：建議先用穩定版 + `drizzle-zod`；若團隊想要內建 `drizzle-orm/zod`，需接受 beta 風險。請人拍板。

> 這四點不阻塞 #5（清洗層不依賴它們）；主要影響 #6 的去重/歷史策略與 #7 的查詢面，建議在 #6 動工前由人確認 1、2。

---

## 附錄 A：佐證來源

- Drizzle ORM — Cloudflare D1 連接（官方）：https://orm.drizzle.team/docs/connect-cloudflare-d1
- Drizzle ORM — D1 HTTP with Drizzle Kit（遷移，官方）：https://orm.drizzle.team/docs/guides/d1-http-with-drizzle-kit
- Get Started with Drizzle and D1（官方）：https://orm.drizzle.team/docs/get-started/d1-new
- Drizzle ORM — Zod 整合（drizzle-zod，方向與棄用說明，官方）：https://orm.drizzle.team/docs/zod
- drizzle-zod README（GitHub）：https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-zod/README.md
- Cloudflare D1 — community projects（含 Drizzle）：https://developers.cloudflare.com/d1/reference/community-projects/

> 驗證範圍說明：本報告未在本機安裝套件或建表（依研究型 Issue 規範不改 `src/`、不建表）。Drizzle + D1 的可行性與遷移流程以官方文件查證為準；SQLite JSON1 / generated column 為 SQLite 既有能力。
