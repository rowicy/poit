## コミットOK判定

- Co-Authorがいないこと
- Authorがriiimparm
- lint通る

## push条件

親エージェントに確認して承認されたら

## モノレポ横断チェック

`apps/`, `cli/`, `infra/` のうち複数にまたがる変更をしたら、`/monorepo-bug-check` スキルを実行して3者間の契約(ARCHITECTURE.md参照)が壊れていないか確認すること。