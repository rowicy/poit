# poit アーキテクチャ概要

md/html/txt を共有するアプリ。`apps/`, `cli/`, `infra/` の3つが1つのサービスとして連携して動く、モノレポ構成。このファイルは、変更時にモノレポ横断のバグ(ある場所の変更が別の場所の前提を壊す)を見つけるための共有コンテキスト。

## コンポーネントと責務

- **apps/app** — Cloudflare Worker。`poit.rowicy.com` で以下を兼ねる:
  - 静的SPA配信 (`public/` 配下 = `frontend/`をVite buildした出力、Workers Assetsバインディング)
  - JSON API (`/api/v1/*`, `src/index.ts`)
  - 本文(content)はR2、メタデータ(visibility/persist/mime/owner/title/excerpt等)はWorkers KVに保存 (`src/store.ts`)
  - Cloudflare AccessのJWT検証は自前実装 (`src/access.ts`)
  - mime判定は `src/mime.ts` (後述、Go実装の手動TS移植)、title/excerpt抽出は `src/metadata.ts`
- **apps/app/frontend** — Solid.js + Vite製SPAのソース。`apps/app/public`(Terraformが参照する静的アセットdir)にビルドする。
- **apps/app/wasm/filekind** — mime判定ライブラリをブラウザ向けにGo-WASMビルドするためのGoソース(実行はしない、ビルド専用モジュール)。
- **cli/poit** — Go製CLI。同じ `/api/v1/artifact` APIをCloudflare Access Service Token経由で叩く。
- **infra** — Terraform。Worker本体(コード/静的アセット/バインディング/カスタムドメイン/cron)、R2、KV、Access Application/Policy、Service Tokenをすべて管理。`wrangler deploy`は使わず、`terraform apply`が唯一のデプロイ手段(ローカル実行)。

## 三者間の契約(ここが壊れるとクロスカッティングなバグになる)

1. **APIコントラクト**: `apps/app/src/index.ts` の `ArtifactWriteBody`(content/filename/slug/visibility/persist)と、`cli/poit/cmd/client.go` の `artifactRequest` struct、`apps/app/frontend/src/lib/api.ts` の `createArtifact`/`updateArtifact` は同じJSON形状でなければならない。どれか1つだけ変更すると、他が動かなくなる。
2. **認証**: CLIは `CF-Access-Client-Id`/`CF-Access-Client-Secret` ヘッダ(環境変数 `POIT_CF_ACCESS_CLIENT_ID`/`POIT_CF_ACCESS_CLIENT_SECRET`)、SPAは `CF_Authorization` Cookie。どちらも最終的に `infra/main.tf` の `cloudflare_zero_trust_access_policy.members_or_cli_allow` に登録されたService Token/メールでしか通らない。Access Applicationを分割すると(過去に実際に起きた `Load failed` バグ)、SPAのfetch()が壊れる。
3. **デフォルトTTL(90日)は2箇所で値を合わせる必要がある**:
   - `apps/app/src/store.ts` の `DEFAULT_TTL_SECONDS`
   - `infra/main.tf` の `cloudflare_r2_bucket_lifecycle` の `max_age`
   片方だけ変更すると、KV上のメタデータは消えたのにR2の本体だけ90日以上残る(またはその逆)という不整合が起きる。
4. **Worker本体のデプロイ経路は `infra/main.tf` の `cloudflare_workers_script.app` のみ**。`content_file`は `apps/app/dist/index.js`(`pnpm --filter poit-app build` でesbuildバンドル)、`assets.directory`は `apps/app/public`(`pnpm --filter poit-app build:frontend` でVite buildした出力、gitignore対象・毎回再生成)。`apps/app/wrangler.jsonc` は `wrangler dev` 専用で、本番デプロイには一切使われない。この2つ(wrangler.jsoncとmain.tf)のバインディング名・R2バケット名・KV namespace名がズレると、ローカル開発と本番で挙動が変わる。
5. **`_headers` はTerraform経由だと自動検出されない**。ソースは `apps/app/frontend/public/_headers`(Viteがそのまま `public/_headers` にコピーする)。`infra/main.tf` の `cloudflare_workers_script.app.assets.config.headers` に `file("...public/_headers")` として明示的に渡している。`_headers` ファイルを編集したら、`vite build` → `terraform apply` の順で反映すること(wranglerと違い、ファイルを置くだけでは効かない)。
6. **Access のパスマッチはプレフィックス一致のみ**(HTTPメソッド単位の制御は不可)。`/artifact/*` と `/assets/*` はAccess非保護(`artifact_public` app)、それ以外の `/` 配下(`/api/v1/*`, `/wasm/*` 含む)は保護(`shell` app)。新しいAPIルートや静的ファイルを追加するときは、このパス設計(保護されるべきか、外部の未ログインユーザーに見えて良いか)を必ず意識すること。
7. **カスタムスラグ**: フロントエンド (`pages/Home.tsx`)・API (`index.ts`)・CLI (`cmd/share.go`) の3箇所すべてで `[a-z0-9_-]{1,64}` のバリデーション正規表現を独立に持っている(小文字限定)。パターンを変えるなら3箇所とも直す。
7b. **一覧データはcreateResourceで1回だけ取得し、以降はsolid-js/storeで部分更新する**(`Home.tsx`)。作成/削除/編集/設定変更のたびに一覧を`refetch()`すると、`<For>`が新しい配列/オブジェクト参照を検知して対象行を丸ごとアンマウント→再マウントし、その行の`ArtifactRow`が持つ「⋯」メニューの開閉状態やカスケードの状態が消える(過去に実際に起きたバグ)。新しいコード(一覧・行コンポーネント)を書くときはこの前提を崩さないこと。
8. **mime判定アルゴリズムは3つの実装が独立に存在し、同じ結果を返す前提**:
   - `cli/poit` — [riiimparm/is-md-or-html-or-text](https://github.com/riiimparm/is-md-or-html-or-text) をGoネイティブにimport(権威)
   - `apps/app/frontend/src/lib/filekind.ts` — 同ライブラリを `apps/app/wasm/filekind` でGo-WASMビルドしたものをブラウザで実行(参考情報表示のみ、非権威)
   - `apps/app/src/mime.ts` — 同アルゴリズムをTypeScriptへ手動移植したもの(Worker内の権威判定。CloudflareがWASMのランタイムコンパイルを禁止しているためWASMを使えない)
   アルゴリズムを変更するときはこの3箇所すべてを直す。`apps/app/src/mime.ts` の冒頭コメントにこの制約を明記済み。
9. **title/excerpt抽出 (`apps/app/src/metadata.ts`)** はPOST/PUT時にmime判定結果を使って動く。mime判定を変えると抽出結果も変わりうる。

## 既知の制約

- CLIのService Token認証(ヘッダ経由)は、Terraform側の設定は正しいことを確認済みだが、このCloudflareアカウントでのAccessエッジの実際の検証動作が確認できていない(README「既知の課題」参照)。
- `solid-markdown-wasm` のWASM本体は大きい(gzip後 約10MB、mermaid/katex等を含む)。mdアーティファクト表示時のみ動的importで読み込むことで影響を局所化している(`Artifact.tsx`の`lazy()`)。
