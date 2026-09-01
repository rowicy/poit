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

```sh
pnpm install
pnpm --filter poit-app build            # src/index.ts を esbuild で dist/index.js にバンドル (Worker本体)
pnpm --filter poit-app build:frontend   # filekind.wasmをビルド → Solid.js SPAをviteでビルド (apps/app/public に出力)
cd infra
source .env
terraform init -backend-config=backend.tfvars
terraform apply
```

コードや静的アセットを変更した場合は、上記の `build`/`build:frontend` を再実行してから `terraform apply`


