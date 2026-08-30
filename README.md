# poit

md/html/txt アップロード・共有アプリ (旧称 ageage)。`poit.rowicy.com` で稼働。モノレポ構成:

- `apps/app` — Cloudflare Worker (API `/api/v1/*` + 静的SPA)。本文はR2、メタデータ(公開設定/永続化フラグ/mime種別等)はWorkers KVに保存。
- `cli/poit` — Go製CLI (`poit share <file>`)
- `infra` — Terraform (Cloudflareプロバイダ)。Worker本体(コード/静的アセット/バインディング/カスタムドメイン/cron)、R2バケット、R2 Lifecycle、KV Namespace、Access Application/Policy、Service Tokenをすべて管理

> このリポジトリ名は移行前の `ageage` のまま残っています。改名手順は末尾の「リポジトリ名の変更」を参照してください。

## 主な機能

- テキストのペースト、またはファイルのドラッグ&ドロップ/選択で共有
- 公開設定 (パブリック / プライベート=rowicy内)、永続化(オフの場合90日で自動削除)
- カスタムURL: 共有時に `[A-Z0-9_-]` のIDを指定可能(省略時はランダムID)
- 一覧の「⋯」メニューから編集(内容/公開設定/永続化の変更)・削除

## キャッシュ/永続化戦略

- `GET /artifact/<id>/raw` の**公開**アーティファクトはCloudflareのCache API (`caches.default`) でエッジキャッシュする(`Cache-Control: public, max-age=60, s-maxage=31536000`)。同じ共有リンクが多数回閲覧される想定のため。PUT/DELETE成功時に該当キャッシュを明示的に`cache.delete()`するので、編集・削除後に古い内容が配信され続けることはない。private なアーティファクトはキャッシュしない。
- 永続化オフ(default)のアーティファクトは、KVの`expirationTtl`(残りTTL秒数、最低60秒)と、R2の`ephemeral/`プレフィックス向けLifecycle Rule(**90日**で削除)によりネイティブに自動削除される。この90日はapps/app/src/store.tsの`DEFAULT_TTL_SECONDS`とinfra/main.tfのlifecycle ruleで値を合わせているので、変更する場合は両方直すこと。cronによる全件スキャンは行わず、`scheduled()`はごく軽量なセーフティネットとしてのみ残している。
- `/assets/*` は `public/_headers` で `Cache-Control: public, max-age=3600` を付与。ビルドステップでファイル名のcontent hashをしていないため、`app.js`/`style.css`を編集したら `index.html` 側の `?v=N` を必ずインクリメントしてキャッシュを外すこと。
- `marked`/`DOMPurify` はCDNではなく `public/assets/vendor/` にバージョン固定で同梱し、Markdown表示時のみ動的読み込みする(ホーム画面では読み込まない)。Markdownは`DOMPurify.sanitize()`を通してから`innerHTML`に挿入している(XSS対策)。

## 認証設計

- ブラウザ (`/`): Cloudflare Access で rowicy メンバー (許可メールアドレス) のみログイン可能。ログイン後の `CF_Authorization` Cookie を Worker 自身が検証する。
- `/api/v1/artifacts` (GET) と `/api/v1/artifact` (POST/PUT/DELETE) は上記と**同じ** Access Application (同一aud) が保護する。別appに分けると、ブラウザ側の1つのAccessセッションではもう一方のaud向けJWTを持たず、SPAの`fetch()`がクロスオリジンのログインページへ302されてブラウザに`Load failed`という不透明なネットワークエラーとして見える不具合があったため、1つのAccess Applicationに統合している。
- `/artifact/<id>` と `/artifact/<id>/raw`、`/assets/*`: Access のパスマッチはプレフィックス一致のみで HTTP メソッド単位の制御ができないため、この配下は Access の対象外 (bypass) にして誰でも到達可能にし、private なアーティファクトかどうかは Worker 側で Cookie/JWT を検証して判定する。

## デプロイ手順

Worker本体(コード・静的アセット・バインディング・カスタムドメイン・cron)はすべて `infra/main.tf` の `cloudflare_workers_script` 等で管理しており、`wrangler deploy` は使わない。`wrangler dev` はローカル開発用にのみ残している。

```sh
pnpm install
pnpm --filter poit-app build   # src/index.ts を esbuild で dist/index.js にバンドル (terraformが参照する)
cd infra
terraform init
terraform apply   # R2 / KV / Access / Worker本体 / カスタムドメイン / cron をまとめて作成 (ローカルapply)
```

コードや静的アセットを変更した場合は、`pnpm --filter poit-app build` を再実行してから `terraform apply` すること(`content_sha256`/assetsのdirectory内容の変更を検知して再デプロイされる)。

CLIをビルドする場合:

```sh
cd cli/poit
go build -o poit .
POIT_CF_ACCESS_CLIENT_ID=... POIT_CF_ACCESS_CLIENT_SECRET=... ./poit share ./README.md
```

(Client ID/Secretは `terraform output cli_service_token_client_id` / `cli_service_token_client_secret`)

## リポジトリ名の変更

サービス名は `poit` に変更済みだが、GitHubリポジトリ名は `rowicy/ageage` のまま。変更する場合の手順:

1. GitHubで `Settings > General > Repository name` から `rowicy/ageage` を新しい名前 (例: `rowicy/poit`) にリネームする(GitHubは旧URLからのリダイレクトを自動設定する)。
2. ローカルのリモートURLを更新: `git remote set-url origin https://github.com/rowicy/<new-name>.git`
3. `cli/poit/go.mod` と `cli/poit/main.go` のモジュールパスは `github.com/rowicy/ageage/cli/poit` のように**リポジトリ名を含んでいる**ため、`github.com/rowicy/<new-name>/cli/poit` に置換する(`go.mod`の`module`行、`main.go`の import 文)。
4. GitHub Actions は `.github/workflows/ci.yml` のpush先ブランチ等リポジトリ名に依存する記述はないため変更不要。
5. `infra/variables.tf` の `github_owner`/`github_repo` (現状Terraformでは未使用の記録用変数)を更新するか、不要なら削除する。

## 既知の課題

- CLI の Cloudflare Access Service Token (`CF-Access-Client-Id`/`CF-Access-Client-Secret` ヘッダ) による認証は、Terraform側の設定 (Access Policyへのservice_token登録、有効なsecretの発行) を確認済みだが、今回のCloudflareアカウントの動作検証では Access エッジ側がこのヘッダを検証せずログイン画面へリダイレクトし続ける現象が解消できなかった(Access Applicationを1つに統合した後も同様)。設定自体はCloudflareの公式スキーマ通りで、ブラウザ経由 (rowicyメンバーのメールでのログイン) のフローはこの制約を受けない。CLIから疎通しない場合はCloudflareダッシュボードでService Tokenの状態を確認するか、サポートに問い合わせてください。
