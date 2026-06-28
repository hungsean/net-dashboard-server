/**
 * Cloudflare Workers 環境變數 / secret 的型別宣告。
 *
 * `worker-configuration.d.ts` 由 `pnpm cf-typegen`（wrangler types）自動產生，
 * 重新產生時會被覆寫，所以「secret」的型別放在這支手寫檔，
 * 透過 interface 合併（declaration merging）補進 `CloudflareBindings`。
 *
 * AUTH_TOKEN：共享驗證 token，存放於 Workers secret（不寫死、不進 git）。
 *   - 線上：`wrangler secret put AUTH_TOKEN`
 *   - 本地：放在 `.dev.vars`（已被 .gitignore 忽略，範本見 .dev.vars.example）
 */
interface CloudflareBindings {
  AUTH_TOKEN: string
}
