# poit

**Markdown, HTMLを"ぽい"と共有**

### 対応ファイル

- Markdown
- HTML
- text

## アップロードインターフェース

- [poit.rowicy.com](https://poit.rowicy.com)
- CLIツール poit

## CLI

### アップロード

```sh
poit share /path/to/file.md
```

### インストール

#### Mac, Linux (Homebrew)

```sh
brew tap rowicy/tools
brew trust rowicy/tools
brew install poit
```

#### Windows

1. [Releases](https://github.com/rowicy/poit/releases) から `poit_windows_amd64.zip` をダウンロード
2. 展開して任意のフォルダ(例: `C:\tools\poit`)に配置
3. そのフォルダをPATHに追加

## デプロイ手順

mainへのマージで `.github/workflows/infra.yml` が `terraform apply` する(PRでは `plan` のみ)。以下は緊急時にローカルから実行する場合の手順。`infra/.env` に `AWS_ENDPOINT_URL_S3` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `TF_VAR_*` を書いておく。

```sh
pnpm install
pnpm --filter poit-app build            # src/index.ts を esbuild で dist/index.js にバンドル (Worker本体)
pnpm --filter poit-app build:frontend   # filekind.wasmをビルド → Solid.js SPAをviteでビルド (apps/app/public に出力)
cd infra
source .env
terraform init
terraform apply
```

コードや静的アセットを変更した場合は、上記の `build`/`build:frontend` を再実行してから `terraform apply`


