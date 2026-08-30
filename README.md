# ageage

md/html/txt アップロード・共有アプリ。モノレポ構成:

- `apps/app` — Cloudflare Worker (API `/api/v1/*` + 静的SPA)。本文はR2、メタデータ(公開設定/永続化フラグ/mime種別等)はWorkers KVに保存。
- `cli/ageage` — Go製CLI (`ageage share <file>`)
- `infra` — Terraform (Cloudflareプロバイダ)。Access Application/Policy, R2バケット, R2 Lifecycle, KV Namespace, Service Tokenを管理

## キャッシュ/永続化戦略

- `GET /artifact/<id>/raw` の**公開**アーティファクトはCloudflareのCache API (`caches.default`) でエッジキャッシュする(`Cache-Control: public, max-age=60, s-maxage=31536000`)。同じ共有リンクが多数回閲覧される想定のため。PUT/DELETE成功時に該当キャッシュを明示的に`cache.delete()`するので、編集・削除後に古い内容が配信され続けることはない。private なアーティファクトはキャッシュしない。
- 永続化オフ(default)のアーティファクトは、KVの`expirationTtl`(残りTTL秒数、最低60秒)と、R2の`ephemeral/`プレフィックス向けLifecycle Rule(24時間で削除)によりネイティブに自動削除される。cronによる全件スキャンは行わず、`scheduled()`はごく軽量なセーフティネットとしてのみ残している。
- `/assets/*` は `public/_headers` で `Cache-Control: public, max-age=3600` を付与。ビルドステップがなくファイル名のcontent hashもないため、`app.js`/`style.css`を編集したら `index.html` 側の `?v=N` を必ずインクリメントしてキャッシュを外すこと。
- `marked`/`DOMPurify` はCDNではなく `public/assets/vendor/` にバージョン固定で同梱し、Markdown表示時のみ動的読み込みする(ホーム画面では読み込まない)。Markdownは`DOMPurify.sanitize()`を通してから`innerHTML`に挿入している(XSS対策)。

## 認証設計

- ブラウザ (`/`): Cloudflare Access で rowicy メンバー (許可メールアドレス) のみログイン可能。ログイン後の `CF_Authorization` Cookie を Worker 自身が検証する。
- `/api/v1/artifacts` (GET) と `/api/v1/artifact` (POST/PUT/DELETE) は上記と**同じ** Access Application (同一aud) が保護する。別appに分けると、ブラウザ側の1つのAccessセッションではもう一方のaud向けJWTを持たず、SPAの`fetch()`がクロスオリジンのログインページへ302されてブラウザに`Load failed`という不透明なネットワークエラーとして見える不具合があったため、1つのAccess Applicationに統合している。
- `/artifact/<id>` と `/artifact/<id>/raw`、`/assets/*`: Access のパスマッチはプレフィックス一致のみで HTTP メソッド単位の制御ができないため、この配下は Access の対象外 (bypass) にして誰でも到達可能にし、private なアーティファクトかどうかは Worker 側で Cookie/JWT を検証して判定する。

## デプロイ手順

```sh
pnpm install
cd infra
terraform init
terraform apply   # R2 / KV / Access Application / Policy / Service Token を作成 (ローカルapply)
cd ../apps/app
# wrangler.jsonc の kv_namespaces[0].id を `terraform output metadata_kv_namespace_id` の値に更新
npx wrangler secret put CF_ACCESS_AUD   # infra の output `access_application_auds` の値を入力
npx wrangler deploy
```

CLIをビルドする場合:

```sh
cd cli/ageage
go build -o ageage .
AGEAGE_CF_ACCESS_CLIENT_ID=... AGEAGE_CF_ACCESS_CLIENT_SECRET=... ./ageage share ./README.md
```

(Client ID/Secretは `terraform output cli_service_token_client_id` / `cli_service_token_client_secret`)

## 既知の課題

- CLI の Cloudflare Access Service Token (`CF-Access-Client-Id`/`CF-Access-Client-Secret` ヘッダ) による認証は、Terraform側の設定 (Access Policyへのservice_token登録、有効なsecretの発行) を確認済みだが、今回のCloudflareアカウントの動作検証では Access エッジ側がこのヘッダを検証せずログイン画面へリダイレクトし続ける現象が解消できなかった(Access Applicationを1つに統合した後も同様)。設定自体はCloudflareの公式スキーマ通りで、ブラウザ経由 (rowicyメンバーのメールでのログイン) のフローはこの制約を受けない。CLIから疎通しない場合はCloudflareダッシュボードでService Tokenの状態を確認するか、サポートに問い合わせてください。
