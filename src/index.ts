import { Hono } from 'hono'
import { auth } from './middleware/auth'

const app = new Hono<{ Bindings: CloudflareBindings }>()

// 公開路由：不需驗證，當作健康檢查
app.get('/', (c) => {
  return c.text('Hello Hono!')
})

// 受保護路由：掛上 auth middleware，證明攔截行為正確。
// 之後 #2（upload POST）/ #7（get API）可直接以同樣方式套用 `auth`。
app.get('/protected', auth, (c) => {
  return c.json({ ok: true, message: 'You are authorized.' })
})

export default app
