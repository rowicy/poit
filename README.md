# poit

md/html/txt アップロード・共有アプリ (旧称 ageage)。`poit.rowicy.com` で稼働。モノレポ構成:

- `apps/app` — Cloudflare Worker (API `/api/v1/*`) + Solid.js製 静的SPA (`apps/app/frontend`)。本文はR2、メタデータ(公開設定/永続化フラグ/mime種別/タイトル/冒頭抜粋等)はWorkers KVに保存。
- `apps/app/wasm/filekind` — mime判定ライブラリ([riiimparm/is-md-or-html-or-text](https://github.com/riiimparm/is-md-or-html-or-text))をブラウザ向けにGo-WASMビルドするためのGoソース。
- `cli/poit` — Go製CLI (`poit share <file>`)
- `infra` — Terraform (Cloudflareプロバイダ)。Worker本体(コード/静的アセット/バインディング/カスタムドメイン/cron)、R2バケット、R2 Lifecycle、KV Namespace、Access Application/Policy、Service Tokenをすべて管理

> GitHubリポジトリは `rowicy/ageage` から `rowicy/poit` にリネーム済み。

## 主な機能

- 共有は「submit → 入力」の順: `Share` ボタンを押すと分岐ポップオーバーで "クリップボードから"/"ファイルから" を選び、内容を受け取り次第即座に送信する(内容が空のまま送信されるバグを構造的に防止)。
- Shareボタン下の⚙アイコンにマウスを乗せると、送信前にカスケードドロップダウンで公開設定・永続化・カスタムURLを設定できる(デフォルトから変更した項目のみバッジ表示)。値を変えてもポップオーバーは閉じない。
- フォーム全体がドロップターゲット(常時アイコンで表示): ファイルをドロップすると内容をその場で読み込み、「Share!」ボタンのみの確認モーダルが出る(Esc/モーダル外クリックでキャンセル)。
- 一覧の「⋯」メニューから「編集」(内容をモーダルで編集)と「設定」(公開設定/永続化/ファイル種別のカスケードドロップダウン、種別は手動上書き可能)を別々に提供。設定変更はKV上のstoreを部分更新するのみで一覧全体を再取得しないため、他の行の開閉状態を壊さない。
- 一覧カードにはKVの`title`/`excerpt`を表示し、無ければファイル名、それも無ければUUIDにフォールバックする。
- カスタムURL: 共有時に `[a-z0-9_-]` のIDを指定可能(省略時はランダムID)。
- テーマ: ベース白 + アクセント `#0E172A`。「使い方」リンクから簡単なガイドをモーダルで表示。

## mime判定 (md/html/txt)

[riiimparm/is-md-or-html-or-text](https://github.com/riiimparm/is-md-or-html-or-text) の `Detect()` アルゴリズムを3箇所で使う:

- **CLI** (`cli/poit`): Goパッケージをそのままimport (`filekind.Detect`)。共有前に検出結果をstderrへ表示。
- **ブラウザ (フロントエンド)**: 同ライブラリを `apps/app/wasm/filekind` で `GOOS=js GOARCH=wasm` ビルドし、`apps/app/frontend/src/lib/filekind.ts` が `wasm_exec.js` 経由でロードする。クリップボード/ファイル取得直後の「detected: ...」表示にのみ使用(参考情報)。
- **Worker (`apps/app/src/mime.ts`)**: 同アルゴリズムを手動でTypeScriptに移植したもの。Cloudflare Workersはリクエスト時の生バイト列からのWASMコンパイルを禁止している(`Wasm code generation disallowed by embedder`)ため、Worker側だけはWASMを使わずTS移植版を権威データとして使用する。3箇所とも同じ入力に対して同じ結果を返すことを前提にしているので、アルゴリズムを変える場合は3箇所とも直すこと。

メタデータの `title`/`excerpt` は `apps/app/src/metadata.ts` がPOST/PUT時に抽出してKVに保存する(mdは最初の見出し行=title・見出し行以外の本文=excerpt、htmlは`<title>`優先で無ければ最初のh1〜h6=title・`<body>`のタグを除いたテキスト=excerpt。TerraformのHTMLRewriterを使用)。

## アーティファクト表示 (`GET /artifact/<id>`)

コンテンツ本体のみを表示する(アプリのヘッダー等は出さない)。

- **md**: [solid-markdown-wasm](https://github.com/zeon256/solid-markdown-wasm) (theme: `nord`) で描画。上部に自動で隠れるメニューバー(マウスが画面上端に近づくと表示)があり、左からの目次パネル(見出し階層、クリックでスクロール)とスライドモード(`#`見出し単位でスライド分割、キーボード ←→ / クリック左右半分でページ送り)を切り替えられる。ライブラリのWASM本体はサイズが大きい(mermaid/katexを含む)ため、md判定のアーティファクトを開いたときだけ動的importで読み込む。
- **html**: そのままsandboxed iframeで描画。
- **txt**: 1行のブロック(row)としてそのまま表示。

## キャッシュ/永続化戦略

- `GET /artifact/<id>/raw` の**公開**アーティファクトはCloudflareのCache API (`caches.default`) でエッジキャッシュする(`Cache-Control: public, max-age=60, s-maxage=31536000`)。同じ共有リンクが多数回閲覧される想定のため。PUT/DELETE成功時に該当キャッシュを明示的に`cache.delete()`するので、編集・削除後に古い内容が配信され続けることはない。private なアーティファクトはキャッシュしない。
- 永続化オフ(default)のアーティファクトは、KVの`expirationTtl`(残りTTL秒数、最低60秒)と、R2の`ephemeral/`プレフィックス向けLifecycle Rule(**90日**で削除)によりネイティブに自動削除される。この90日はapps/app/src/store.tsの`DEFAULT_TTL_SECONDS`とinfra/main.tfのlifecycle ruleで値を合わせているので、変更する場合は両方直すこと。cronによる全件スキャンは行わず、`scheduled()`はごく軽量なセーフティネットとしてのみ残している。
- `apps/app/public`(=Viteのビルド出力)は `pnpm --filter poit-app build:frontend` のたびに再生成される。`/assets/*` はVite側でcontent hashが付くファイル名なので `Cache-Control: public, max-age=31536000, immutable`、手動で置いている `/wasm/*` (filekind.wasm/wasm_exec.js、ハッシュなし)は `max-age=3600`。設定は `apps/app/frontend/public/_headers` に書き、Terraformの`assets.config.headers`に`file()`で渡す(このプロバイダは`_headers`ファイルを自動検出しないため)。

## 認証設計

- ブラウザ (`/`): Cloudflare Access で rowicy メンバー (許可メールアドレス) のみログイン可能。ログイン後の `CF_Authorization` Cookie を Worker 自身が検証する。
- `/api/v1/artifacts` (GET) と `/api/v1/artifact` (POST/PUT/DELETE) は上記と**同じ** Access Application (同一aud) が保護する。別appに分けると、ブラウザ側の1つのAccessセッションではもう一方のaud向けJWTを持たず、SPAの`fetch()`がクロスオリジンのログインページへ302されてブラウザに`Load failed`という不透明なネットワークエラーとして見える不具合があったため、1つのAccess Applicationに統合している。
- `/artifact/<id>` と `/artifact/<id>/raw`、`/assets/*`: Access のパスマッチはプレフィックス一致のみで HTTP メソッド単位の制御ができないため、この配下は Access の対象外 (bypass) にして誰でも到達可能にし、private なアーティファクトかどうかは Worker 側で Cookie/JWT を検証して判定する。
- `/wasm/*` (filekindのWASM) はこのbypass対象外 = Accessで保護されたまま。ホーム画面(要ログイン)からのみ使う想定のため問題ない。

## デプロイ手順

Worker本体(コード・静的アセット・バインディング・カスタムドメイン・cron)はすべて `infra/main.tf` の `cloudflare_workers_script` 等で管理しており、`wrangler deploy` は使わない。`wrangler dev` はローカル開発用にのみ残している。

```sh
pnpm install
pnpm --filter poit-app build            # src/index.ts を esbuild で dist/index.js にバンドル (Worker本体)
pnpm --filter poit-app build:frontend   # filekind.wasmをビルド → Solid.js SPAをviteでビルド (apps/app/public に出力)
cd infra
terraform init
terraform apply   # R2 / KV / Access / Worker本体 / カスタムドメイン / cron をまとめて作成 (ローカルapply)
```

コードや静的アセットを変更した場合は、上記の `build`/`build:frontend` を再実行してから `terraform apply` すること(`content_sha256`/assetsのdirectory内容の変更を検知して再デプロイされる)。

CLIをビルドする場合:

```sh
cd cli/poit
go build -o poit .
POIT_CF_ACCESS_CLIENT_ID=... POIT_CF_ACCESS_CLIENT_SECRET=... ./poit share ./README.md
```

(Client ID/Secretは `terraform output cli_service_token_client_id` / `cli_service_token_client_secret`)

## リポジトリ名の変更 (実施済み)

`rowicy/ageage` → `rowicy/poit` へのリネームは完了済み。実施した手順(参考用に残す):

1. GitHubで `Settings > General > Repository name` からリネーム(GitHubが旧URLからのリダイレクトを自動設定)。
2. ローカルのリモートURLを更新: `git remote set-url origin https://github.com/rowicy/poit.git`
3. `cli/poit/go.mod` の `module` 行と `cli/poit/main.go` の import 文 — リポジトリ名を含む `github.com/rowicy/ageage/cli/poit` を `github.com/rowicy/poit/cli/poit` に置換。

`infra/variables.tf` の `github_owner`/`github_repo` (Terraform内では未使用の記録用変数)は必要なら別途 `poit` に更新すること。

## 既知の課題

- CLI の Cloudflare Access Service Token (`CF-Access-Client-Id`/`CF-Access-Client-Secret` ヘッダ) による認証は、Terraform側の設定 (Access Policyへのservice_token登録、有効なsecretの発行) を確認済みだが、今回のCloudflareアカウントの動作検証では Access エッジ側がこのヘッダを検証せずログイン画面へリダイレクトし続ける現象が解消できなかった(Access Applicationを1つに統合した後も同様)。設定自体はCloudflareの公式スキーマ通りで、ブラウザ経由 (rowicyメンバーのメールでのログイン) のフローはこの制約を受けない。CLIから疎通しない場合はCloudflareダッシュボードでService Tokenの状態を確認するか、サポートに問い合わせてください。
- `solid-markdown-wasm` はmermaid/katex/シンタックスハイライトテーマを内包しておりWASM本体が非常に大きい(gzip後 約10MB)。mdアーティファクト表示時のみ動的importで読み込むようにして影響を局所化しているが、他に軽量な代替が要る場合は要検討。
