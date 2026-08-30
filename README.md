# ageage

md/html/txt アップロード・共有アプリ。モノレポ構成:

- `apps/app` — Cloudflare Worker (API `/api/v1/*` + 静的SPA)。R2にアーティファクトを保存。
- `cli/ageage` — Go製CLI (`ageage share <file>`)
- `infra` — Terraform (Cloudflareプロバイダ)。Access Application/Policy, R2バケット, Service Tokenを管理

## 認証設計

- ブラウザ (`/`): Cloudflare Access で rowicy メンバー (許可メールアドレス) のみログイン可能。ログイン後の `CF_Authorization` Cookie を Worker 自身が検証する。
- `/artifact/<id>` と `/artifact/<id>/raw`: Access のパスマッチはプレフィックス一致のみで HTTP メソッド単位の制御ができないため、この配下は Access の対象外 (bypass) にして誰でも到達可能にし、private なアーティファクトかどうかは Worker 側で Cookie/JWT を検証して判定する。
- `/api/v1/artifact` (POST/PUT/DELETE, および前方一致する `/api/v1/artifacts`): rowicy メンバーのメール、または CLI 用 Access Service Token のどちらかを許可。

## デプロイ手順

```sh
pnpm install
cd infra
terraform init
terraform apply   # R2 / Access Application / Policy / Service Token を作成 (ローカルapply)
cd ../apps/app
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

- CLI の Cloudflare Access Service Token (`CF-Access-Client-Id`/`CF-Access-Client-Secret` ヘッダ) による認証は、Terraform側の設定 (Access Policyへのservice_token登録、有効なsecretの発行) を確認済みだが、今回のCloudflareアカウントの動作検証では Access エッジ側がこのヘッダを検証せずログイン画面へリダイレクトし続ける現象が解消できなかった。設定自体はCloudflareの公式スキーマ通りで、ブラウザ経由 (rowicyメンバーのメールでのログイン) のフローはこの制約を受けない。CLIから疎通しない場合はCloudflareダッシュボードでService Tokenの状態を確認するか、サポートに問い合わせてください。
