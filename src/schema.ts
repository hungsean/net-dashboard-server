import { z } from 'zod'

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
export const uploadSchema = z.object({
  timestamp_utc: z.iso.datetime(),
  meas_id: z.string().regex(/^\d+$/, "meas_id 必須是純數字字串"),
  download: netSpeedSchema,
  upload: netSpeedSchema,
})