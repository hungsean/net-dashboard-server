import { Hono } from 'hono'
import { z } from 'zod'
import { auth } from './middleware/auth'

const app = new Hono<{ Bindings: CloudflareBindings }>()

// download / upload 兩段結構相同，抽成共用子 schema（改一處即可）
const netSpeedSchema = z.object({
  bytes: z.number().int(),
  duration_ms: z.number().int(),
  mbps: z.number(),
  mean_mbps: z.number(),
  median_mbps: z.number(),
  p25_mbps: z.number(),
  p75_mbps: z.number(),
})

// 上傳資料的審核 schema：只宣告「我們要的」欄位。
// z.object 預設會忽略多餘欄位（通過後多餘 key 會被剝除），
// 所以多上傳的資料不會報錯，正好符合「不管是否有多上傳資料」。
const uploadSchema = z.object({
  timestamp_utc: z.iso.datetime(),
  meas_id: z.string().regex(/^\d+$/, "meas_id 必須是純數字字串"),
  download: netSpeedSchema,
  upload: netSpeedSchema,
})

// 公開路由：不需驗證，當作健康檢查
app.get('/', (c) => {
  return c.text('Hello Hono!')
})

// 受保護路由：掛上 auth middleware，證明攔截行為正確。
// 之後 #2（upload POST）/ #7（get API）可直接以同樣方式套用 `auth`。
app.put('/upload/:id', auth, async (c) => {
  const id = c.req.param('id');

  if (!/^\d+$/.test(id)) {
    return c.json({ error: "not valid id" }, 400);
  }

  // c.req.json() 遇到非法 JSON（空 body / 壞字串 / Content-Type 不對）會丟例外，
  // 不擋的話會變成 500。用 try/catch 收掉，改回 400。
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  // 用 safeParse 驗證，不會丟例外，方便回傳清楚的錯誤
  const result = uploadSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: "invalid payload", issues: z.treeifyError(result.error) },
      400,
    );
  }

  // result.data 是「只含我們要的欄位」且型別正確的乾淨資料（多餘欄位已被剝除）
  const data = result.data;

  return c.json({ ok: true })
})

export default app
