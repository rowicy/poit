# poit

**Markdown, HTMLを"ぽい"と共有**

### 対応ファイル

- Markdown
- HTML
- text

いずれもテキストファイルのみ。バイナリファイル(画像・PDF・zipなど)はSPA/CLI/APIのそれぞれで共有前に弾かれる。

文字コードはUTF-8とShift_JIS(CP932)に対応(Shift_JISはアップロード時にUTF-8へ変換して保存)。それ以外の文字コード(UTF-16・EUC-JPなど)はバイナリ扱いで弾かれる。

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

mainへマージ
