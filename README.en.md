# dsh-pojia (English)

A merged DeepSeek Harness plugin that combines host-level cleaning (from dsh-purge-safe) and the prompt injection armor kernel (from Fujiang / Minglink). **All features are unified under the single `/pojia` command.**

> Free, open-source, non-commercial. Licensed CC BY-NC-SA 4.0; see [NOTICE](./NOTICE) for the three-way attribution.

## Install

Targets **DSH 0.2.2-rc.5** (desktop and web).

One-click install (unzip `dsh-pojia-<version>-installer.zip`, then double-click — no terminal needed):

| Platform | Double-click | Action |
|---|---|---|
| macOS | `点我一键安装-macOS.command` | install |
| macOS | `点我检查是否生效-macOS.command` | verify |
| macOS | `点我一键卸载-macOS.command` | uninstall |
| Windows | `点我一键安装-Windows.bat` | install |
| Windows | `点我检查是否生效-Windows.bat` | verify |
| Windows | `点我一键卸载-Windows.bat` | uninstall |

The filenames are Chinese; the script itself prints Chinese messages too. If Gatekeeper blocks the `.command` on macOS: right-click → Open, or run `xattr -dr com.apple.quarantine <unzipped dir>` first.

**Missing dependencies are offered, not forced:** if Node.js (or a version < 18) or pnpm is absent, the script prints a `[Y/n]` prompt — Enter or `y` installs it: Node.js via Homebrew, else the official tarball (sha256-verified) into `<DSH home>/toolchain`; pnpm via `npm i -g` → `corepack` → the official standalone script. No sudo and no shell-config edits; `n` only warns. Non-interactive: `--yes` / `-Yes` to auto-install, `--no-deps` / `-NoDeps` to only warn (same on Windows, which uses winget or the official zip).

Terminal equivalent:

```sh
bash install.sh                 # macOS / Linux / WSL (bash 3.2+)
bash uninstall.sh               # uninstall
```

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1     # Windows
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1   # uninstall
```

`install.sh` resolves the DSH home in this order: `--dsh-home` → `$DSH_HOME` → `~/Library/Application Support/DeepSeek Harness/dsh-home` (macOS desktop) → `~/.dsh`.

Or install manually with `dsh plugin`:

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-pojia
# or
dsh plugin --profile web add /absolute/path/to/dsh-pojia
```

Fully quit and reopen the host. Click **dsh-pojia** beside the session title → Clean → Apply. A successful Apply restarts the host once.

## Unified command `/pojia`

The old `/purge`, `/rules`, `/skills`, `/rewind`, `/fujiang` commands are **all folded into `/pojia`** and no longer registered separately.

```
/pojia status                  status (patch progress + armor state)
/pojia apply                   apply all host patches
/pojia revert                  revert patches (keeps prompt-inject.md)
/pojia uninstall               uninstall
/pojia edit                    edit the inject file

/pojia armor status            armor kernel status
/pojia armor on                enable the kernel
/pojia armor off [soft|hard|new]  disable the kernel
/pojia armor mode user|legacy|both  switch injection channel

/pojia rules list | use <id> | create <id> | delete <id> | reset
/pojia skills list | import <path> | create <id> | delete <id>
/pojia rewind [once|round]     undo last step / last round
/pojia help                    help
```

## Tools

| Tool | Purpose |
|---|---|
| `pojia_status` | merged status (patches + armor) |
| `pojia_apply` / `pojia_revert` | apply / revert patches |
| `pojia_armor` | armor kernel switch (status/on/off/mode) |
| `pojia_profile` | kernel version, injection slots, capabilities |

## Two complementary layers

- **Host layer** changes Approval/Never, sandbox write denial, system-prompt identity, untrusted-content interception and similar defaults so tool execution is no longer blocked by the host.
- **Armor kernel** injects the break-armor prompt at session level (user-channel append by default, does not rewrite the user message, idempotent; legacy uses dual system sections), lowering model-side refusals.

Turning off the kernel (`/pojia armor off`) does not affect host patches; reverting host patches (`/pojia revert`) does not affect the kernel switch. The two are independent.

## Inject file

`prompt-inject.md` (`$DSH_HOME`) is a user file and is kept by `revert`/`uninstall`. The armor kernel switch lives in `$DSH_HOME/dsh-pojia-armor.state.json` (isolated from the old Fujiang state file).

## License & attribution

Overall **CC BY-NC-SA 4.0** ([LICENSE](./LICENSE)). Contains:
- dsh-purge-safe — Apache 2.0 ([LICENSE-APACHE.txt](./LICENSE-APACHE.txt))
- Fujiang / Minglink — CC BY-NC-SA 4.0 + extra terms ([armor/FUJIANG-LICENSE.txt](./armor/FUJIANG-LICENSE.txt))

Redistribution must keep all attribution and license texts, state modifications, and **must remain non-commercial**. Full credits: [NOTICE](./NOTICE). Upstream document: [README-upstream-purge-safe.md](./README-upstream-purge-safe.md).
