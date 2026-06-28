import { createMiddleware } from 'hono/factory'

/**
 * 共享 token 驗證中介層（reusable auth middleware）。
 *
 * client 需在 request header 帶上：
 *   Authorization: Bearer <token>
 * server 會比對 Cloudflare Workers secret `AUTH_TOKEN`。
 *
 * 回應行為：
 *   - 缺 Authorization header / 格式錯誤 → 401（缺 token）
 *   - token 不符                      → 403（token 錯誤）
 *   - 通過                            → 放行至下一個 handler
 *   - server 未設定 AUTH_TOKEN          → 500（設定錯誤，方便排查）
 *
 * 所有錯誤都回傳結構化 JSON：{ error, message }
 */

/**
 * 常數時間字串比較，避免以「比較耗時長短」推測 token 的時序攻擊（timing attack）。
 * 先比長度再逐 byte XOR；長度不同直接回 false。
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.byteLength !== bb.byteLength) {
    return false
  }
  let diff = 0
  for (let i = 0; i < ab.byteLength; i++) {
    diff |= ab[i] ^ bb[i]
  }
  return diff === 0
}

export const auth = createMiddleware<{ Bindings: CloudflareBindings }>(
  async (c, next) => {
    const expected = c.env.AUTH_TOKEN

    // server 端未設定 secret：屬於部署設定問題，明確回 500 方便排查
    if (!expected) {
      return c.json(
        {
          error: 'Server Misconfiguration',
          message: 'AUTH_TOKEN secret is not configured on the server.',
        },
        500
      )
    }

    const header = c.req.header('Authorization')

    // 缺 token → 401
    if (!header) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Missing Authorization header.',
        },
        401
      )
    }

    const match = header.match(/^Bearer\s+(.+)$/)
    if (!match) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Invalid Authorization header format. Expected: Bearer <token>.',
        },
        401
      )
    }

    const token = match[1]

    // token 錯誤 → 403
    if (!timingSafeEqual(token, expected)) {
      return c.json(
        {
          error: 'Forbidden',
          message: 'Invalid token.',
        },
        403
      )
    }

    // 驗證通過，放行
    await next()
  }
)
