# poit アーキテクチャ概要

md/html/txt を共有するアプリ。`apps/`, `cli/`, `infra/` の3つが1つのサービスとして連携して動く、モノレポ構成。このファイルは、変更時にモノレポ横断のバグ(ある場所の変更が別の場所の前提を壊す)を見つけるための共有コンテキスト。

## コンポーネントと責務

- **apps/app** — Cloudflare Worker。`poit.rowicy.com` で以下2つを兼ねる:
  - 静的SPA配信 (`public/` 配下、Workers Assetsバインディング)
  - JSON API (`/api/v1/*`, `src/index.ts`)
  - 本文(content)はR2、メタデータ(visibility/persist/mime/owner等)はWorkers KVに保存 (`src/store.ts`)
  - Cloudflare AccessのJWT検証は自前実装 (`src/access.ts`)、mime判定は `src/mime.ts`
- **cli/poit** — Go製CLI。同じ `/api/v1/artifact` APIをCloudflare Access Service Token経由で叩く。
- **infra** — Terraform。Worker本体(コード/静的アセット/バインディング/カスタムドメイン/cron)、R2、KV、Access Application/Policy、Service Tokenをすべて管理。`wrangler deploy`は使わず、`terraform apply`が唯一のデプロイ手段(ローカル実行)。

## 三者間の契約(ここが壊れるとクロスカッティングなバグになる)

1. **APIコントラクト**: `apps/app/src/index.ts` の `ArtifactWriteBody`(content/filename/slug/visibility/persist)と、`cli/poit/cmd/client.go` の `artifactRequest` structは同じJSON形状でなければならない。片方だけ変更すると、CLIまたはSPAのどちらかが動かなくなる。
2. **認証**: CLIは `CF-Access-Client-Id`/`CF-Access-Client-Secret` ヘッダ(環境変数 `POIT_CF_ACCESS_CLIENT_ID`/`POIT_CF_ACCESS_CLIENT_SECRET`)、SPAは `CF_Authorization` Cookie。どちらも最終的に `infra/main.tf` の `cloudflare_zero_trust_access_policy.members_or_cli_allow` に登録されたService Token/メールでしか通らない。Access Applicationを分割すると(過去に実際に起きた `Load failed` バグ)、SPAのfetch()が壊れる。
3. **デフォルトTTL(90日)は2箇所で値を合わせる必要がある**:
   - `apps/app/src/store.ts` の `DEFAULT_TTL_SECONDS`
   - `infra/main.tf` の `cloudflare_r2_bucket_lifecycle` の `max_age`
   片方だけ変更すると、KV上のメタデータは消えたのにR2の本体だけ90日以上残る(またはその逆)という不整合が起きる。
4. **Worker本体のデプロイ経路は `infra/main.tf` の `cloudflare_workers_script.app` のみ**。`content_file`は `apps/app/dist/index.js`(`pnpm --filter poit-app build` でesbuildバンドル)、`assets.directory`は `apps/app/public`。`apps/app/wrangler.jsonc` は `wrangler dev` 専用で、本番デプロイには一切使われない。この2つ(wrangler.jsoncとmain.tf)のバインディング名・R2バケット名・KV namespace名がズレると、ローカル開発と本番で挙動が変わる。
5. **`public/_headers` はTerraform経由だと自動検出されない**。`infra/main.tf` の `cloudflare_workers_script.app.assets.config.headers` に `file("...public/_headers")` として明示的に渡している。`_headers` ファイルを編集したら、`terraform apply` を再実行しないと反映されない(wranglerと違い、ファイルを置くだけでは効かない)。
6. **Access のパスマッチはプレフィックス一致のみ**(HTTPメソッド単位の制御は不可)。`/artifact/*` と `/assets/*` はAccess非保護(`artifact_public` app)、それ以外の `/` 配下(`/api/v1/*` 含む)は保護(`shell` app)。新しいAPIルートを追加するときは、このパス設計(保護されるべきか、外部の未ログインユーザーに見えて良いか)を必ず意識すること。
7. **カスタムスラグ**: SPA (`app.js`)・API (`index.ts`)・CLI (`cmd/share.go`) の3箇所すべてで `[A-Z0-9_-]{1,64}` のバリデーション正規表現を独立に持っている。パターンを変えるなら3箇所とも直す。

## 既知の制約

- CLIのService Token認証(ヘッダ経由)は、Terraform側の設定は正しいことを確認済みだが、このCloudflareアカウントでのAccessエッジの実際の検証動作が確認できていない(README「既知の課題」参照)。
