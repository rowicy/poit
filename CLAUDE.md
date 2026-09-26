## コミットOK判定

- lint通る

## コミットメッセージ

`type(scope): 件名` 形式。`apps/`, `cli/`, `infra/` を変更したら、対応するscope(`app` / `cli` / `infra`)を必ず含める。複数にまたがるならカンマ区切り。

- 例: `feat(cli): poit ls を追加` / `fix(app,cli): ...` / `chore(infra): ...`
- `.githooks/commit-msg` が強制する(`pnpm install` で有効化)。`--no-verify` で回避しないこと
- CLIのリリースノートは `(cli)` を含むコミットだけで作られる(`cli/poit/.goreleaser.yml`)

## push条件

親エージェントに確認して承認されたら

## モノレポ横断チェック

`apps/`, `cli/`, `infra/` のうち複数にまたがる変更をしたら、`/monorepo-bug-check` スキルを実行して3者間の契約(ARCHITECTURE.md参照)が壊れていないか確認すること。