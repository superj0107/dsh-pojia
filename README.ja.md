# dsh-pojia（日本語）

DeepSeek Harness 向けの統合プラグインです。**ホスト側クリーニング**（dsh-purge-safe 由来）と**破甲カーネル**（富江破甲 / Minglink 由来）の 2 層を 1 つにまとめ、全機能を単一の `/pojia` コマンドに集約しています。

> 無料・オープンソース・非商用。全体は CC BY-NC-SA 4.0。3 者の帰属は [NOTICE](./NOTICE) を参照。

## インストール

対象は **DSH 0.2.2-rc.5**（デスクトップ / Web）。

ワンクリックインストール（`dsh-pojia-<version>-installer.zip` を展開し、ダブルクリックするだけ。ターミナル不要）：

| プラットフォーム | ダブルクリック | 動作 |
|---|---|---|
| macOS | `点我一键安装-macOS.command` | インストール |
| macOS | `点我检查是否生效-macOS.command` | 動作確認 |
| macOS | `点我一键卸载-macOS.command` | アンインストール |
| Windows | `点我一键安装-Windows.bat` | インストール |
| Windows | `点我检查是否生效-Windows.bat` | 動作確認 |
| Windows | `点我一键卸载-Windows.bat` | アンインストール |

ファイル名とスクリプト内のメッセージは中国語です。macOS で Gatekeeper に止められた場合は、右クリック → 開く、または `xattr -dr com.apple.quarantine <展開先>` を先に実行してください。

**依存関係は勝手に入れず、まず確認します**：Node.js（または 18 未満）や pnpm が無い場合、スクリプトは `[Y/n]` を表示します。Enter か `y` で自動インストール（Node.js は Homebrew、無ければ公式 tarball を sha256 検証して `<DSH home>/toolchain` へ。pnpm は `npm i -g` → `corepack` → 公式スタンドアロンの順）。sudo 不要、シェル設定も変更しません。`n` なら警告のみ。非対話なら `--yes` / `-Yes` で自動、`--no-deps` / `-NoDeps` で警告のみ（Windows は winget または公式 zip を使用）。

**`pnpm install` の失敗は正直に報告します**（成功と偽りません）：pnpm のエラーをそのまま表示し、よくある原因には具体的な対処を示し、直せるものは確認のうえ自動修正します（例：GitHub のパッケージを `onlyBuiltDependencies` に追加して 1 回だけ再試行）。それでも駄目ならプラグインを `node_modules` に手動リンクして DSH が読み込める状態を保ちます。終了コード `2` は「プラグインは導入済み、profile の依存に問題あり」を意味します。

ターミナルで実行する場合：

```sh
bash install.sh                 # macOS / Linux / WSL（bash 3.2 以上）
bash uninstall.sh               # アンインストール
```

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1     # Windows
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1   # アンインストール
```

`install.sh` の DSH home 解決順：`--dsh-home` → `$DSH_HOME` → `~/Library/Application Support/DeepSeek Harness/dsh-home`（macOS デスクトップ）→ `~/.dsh`。

手動で `dsh plugin` を使う場合：

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-pojia
# または
dsh plugin --profile web add /absolute/path/to/dsh-pojia
```

ホストを完全に終了して再起動してください。セッション名横の **dsh-pojia** → クリーン → 適用。成功するとホストが 1 回再起動します。

## 統一コマンド `/pojia`

旧 `/purge` `/rules` `/skills` `/rewind` `/fujiang` は**すべて `/pojia` に統合**され、個別には登録されません。

```
/pojia status                  状態表示（先頭 2 行が結論 + 次の一手）
/pojia doctor                  診断：導入 / 注入 / 有効性（exit 0/1/2）
/pojia apply                   全ホストパッチを適用
/pojia revert                  パッチを戻す（prompt-inject.md は保持）
/pojia uninstall               アンインストール
/pojia edit                    注入ファイルを編集

/pojia armor status            カーネル状態
/pojia armor on                カーネル有効化
/pojia armor off [soft|hard|new]  カーネル無効化
/pojia armor mode user|legacy|both  注入チャネル切替

/pojia rules list | use <id> | create <id> | delete <id> | reset
/pojia skills list | import <路径> | create <id> | delete <id>
/pojia rewind [once|round]     直前のステップ / ラウンドを取り消し
/pojia help                    ヘルプ
```

## 統一ツール

| ツール | 用途 |
|---|---|
| `pojia_status` | 統合状態（パッチ + カーネル） |
| `pojia_apply` / `pojia_revert` | パッチの適用 / 復元 |
| `pojia_armor` | カーネル开关（status/on/off/mode） |
| `pojia_profile` | カーネル版数・注入スロット・機能一覧 |

## 2 層の役割

- **ホスト層**：Approval/Never、サンドボックス書き込み拒否、システムプロンプトの身元、外部コンテンツの untrusted 判定などの既定値を変更し、ツール実行がホストに遮断されないようにします。
- **カーネル層**：セッションに破甲プロンプトを注入します（既定は user チャネルの追記でユーザー原文は書き換えず冪等。legacy は system 2 段）。

カーネルを切っても（`/pojia armor off`）ホストパッチには影響せず、パッチを戻しても（`/pojia revert`）カーネル开关には影響しません。両者は独立しています。

## 注入ファイル

`prompt-inject.md`（`$DSH_HOME`）はユーザーファイルで、`revert` / `uninstall` でも保持されます。カーネル开关の状態は `$DSH_HOME/dsh-pojia-armor.state.json`（旧富江の状態とは分離）に保存されます。

## ライセンスと帰属

全体は **CC BY-NC-SA 4.0**（[LICENSE](./LICENSE)）。内訳：
- dsh-purge-safe — Apache 2.0（[LICENSE-APACHE.txt](./LICENSE-APACHE.txt)）
- 富江破甲 / Minglink — CC BY-NC-SA 4.0 + 追加条項（[armor/FUJIANG-LICENSE.txt](./armor/FUJIANG-LICENSE.txt)）

再配布では 3 者の帰属とライセンス原文を保持し、変更点を明記し、**商用利用は禁止**です。詳細は [NOTICE](./NOTICE)。上流文書：[README-upstream-purge-safe.md](./README-upstream-purge-safe.md)。
