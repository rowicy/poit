## コミットOK判定

- lint通る

## コミットメッセージ

`type: 件名` 形式。`apps/`, `cli/`, `infra/` を変更したときだけ、対応するscope(`app` / `cli` / `infra`)を `type(scope):` で必ず含める。複数にまたがるならカンマ区切り。該当しなければscopeなしでよい。

## push条件

親エージェントに確認して承認されたら

## モノレポ横断チェック

`apps/`, `cli/`, `infra/` のうち複数にまたがる変更をしたら、`/monorepo-bug-check` スキルを実行して3者間の契約(ARCHITECTURE.md参照)が壊れていないか確認すること。