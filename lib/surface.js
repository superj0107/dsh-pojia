import path from "node:path";

/** 当前已接线的宿主面。gui / tui 先能识别，适配仍回退 web。 */
export const SURFACES = Object.freeze(["web", "desktop", "gui", "tui"]);

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

function slash(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function exeName(execPath) {
  return path.basename(String(execPath || "")).toLowerCase();
}

export function pathLooksDesktop(p) {
  const n = slash(p);
  if (!n) return false;
  // 安装目录可能叫 "DeepSeek Harness" / "deepseek-harness" / "DeepseekHarnessDesktop"。
  // 源码仓库也常带 deepseek-harness 名字，所以还要带 resources/、exe、.app/ 才算桌面安装。
  const harnessDir =
    n.includes("/deepseek harness/") ||
    n.includes("/deepseek-harness/") ||
    n.includes("/deepseekharness") ||
    /\/deepseek[\s._-]*harness/.test(n);
  return (
    n.includes("/dsh desktop/") ||
    n.includes("/dsh desktop.app/") ||
    n.includes("dsh-desktop") ||
    n.includes("dsh-plugin-desktop") ||
    n.includes("/deepseek harness.app/") ||
    (harnessDir && (n.includes("/resources/") || n.includes("/contents/resources/") || n.endsWith("/resources"))) ||
    /\/dsh desktop\.exe$/i.test(n) ||
    /\/deepseek[\s._-]*harness\.exe$/i.test(n) ||
    n.endsWith("/host-process-entry.js") ||
    n.endsWith("/desktop-cli.js")
  );
}

function isOfficialHarnessExeName(name) {
  return (
    name === "dsh desktop.exe" ||
    name === "dsh desktop" ||
    name === "deepseek harness.exe" ||
    name === "deepseek-harness.exe" ||
    name === "deepseek harness" ||
    name === "deepseek-harness" ||
    /^deepseek[\s._-]*harness(\.exe)?$/.test(name)
  );
}

function isElectronRunAsNode(env) {
  const v = norm(env.ELECTRON_RUN_AS_NODE);
  return v !== "" && v !== "0" && v !== "false";
}

/** Electron 当 Node 跑 CLI（官方 `dsh web` 常这样）不算桌面 GUI。 */
function isElectronGuiProcess(input = {}) {
  const env = input.env ?? process.env;
  if (isElectronRunAsNode(env)) return false;
  const versions = input.versions ?? process.versions;
  if (versions && versions.electron) return true;
  const execPath = input.execPath ?? process.execPath;
  return isOfficialHarnessExeName(exeName(execPath));
}

function argvList(argv) {
  return Array.isArray(argv) ? argv : [];
}

/** 裸命令：`dsh web` / `dsh tui`。路径和 `--flag` 不算。 */
export function argvHasBareCommand(argv, name) {
  const want = String(name || "").toLowerCase();
  if (!want) return false;
  for (const raw of argvList(argv)) {
    const a = String(raw || "").trim();
    if (!a || a.startsWith("-")) continue;
    if (/[\\/]/.test(a) || /\.(js|mjs|cjs|exe|cmd|bat|asar)$/i.test(a)) continue;
    if (a.toLowerCase() === want) return true;
  }
  return false;
}

function profileFromArgv(argv) {
  const list = argvList(argv);
  for (let i = 0; i < list.length; i += 1) {
    const a = String(list[i] || "").trim();
    const low = a.toLowerCase();
    if (low === "--profile" && list[i + 1]) return norm(list[i + 1]);
    if (low.startsWith("--profile=")) return norm(a.slice("--profile=".length));
  }
  return "";
}

function profileName(env, argv) {
  return norm(env.DSH_PROFILE) || profileFromArgv(argv);
}

export function argvLooksDesktopHost(argv) {
  const list = argvList(argv);
  if (argvHasBareCommand(list, "web")) return false;
  return list.some((arg) => {
    const n = slash(arg);
    return (
      n.endsWith("/host-process-entry.js") ||
      n.endsWith("/desktop-cli.js") ||
      n.includes("/dsh-desktop-host/") ||
      n.includes("/dsh-plugin-desktop/") ||
      // 0.2.0 桌面 host：resources/app.asar/lib/bin.js，没有 web 子命令。
      ((n.includes("/resources/app.asar/") || n.includes("/resources/app/")) &&
        (n.endsWith("/bin.js") || n.endsWith("/lib/bin.js")))
    );
  });
}

/** 本进程就是官方桌面 Host（Electron-as-node + dsh-desktop-host），不是独立 `dsh web`。 */
export function looksOfficialDesktopHost(input = {}) {
  const argv = input.argv ?? process.argv;
  if (argvHasBareCommand(argv, "web")) return false;
  if (argvLooksDesktopHost(argv)) return true;
  const env = input.env ?? process.env;
  if (forcedSurface(env) === "desktop") return true;
  if (norm(env.DSH_PROFILE) === "desktop" && isElectronRunAsNode(env)) {
    if (isOfficialHarnessExeName(exeName(input.execPath ?? process.execPath))) return true;
  }
  return false;
}

function forcedSurface(env) {
  const forced = norm(env.DSH_SURFACE);
  return SURFACES.includes(forced) ? forced : "";
}

export function detectSurface(input = {}) {
  const env = input.env ?? process.env;
  const forced = forcedSurface(env);
  if (forced) return forced;

  const argv = input.argv ?? process.argv;
  // 官方 `dsh web` 经常住在桌面安装的 app.asar 里，argv 带 /resources/，
  // execPath 甚至就是 Harness.exe + ELECTRON_RUN_AS_NODE。命令本身说了算。
  if (argvHasBareCommand(argv, "web")) return "web";
  if (argvHasBareCommand(argv, "tui")) return "tui";
  if (argvHasBareCommand(argv, "gui")) return "gui";
  if (argvHasBareCommand(argv, "desktop")) return "desktop";
  // 官方 Host 的 argv 带 dsh-desktop-host，必须压过误设的 DSH_PROFILE=web。
  if (argvLooksDesktopHost(argv)) return "desktop";

  const profile = profileName(env, argv);
  // `--profile web` / DSH_PROFILE=web 就是 web。官方 web 常从 .app 里的 bin.js 起来，
  // 路径看起来像桌面安装，不能因此显示「桌面端」。
  if (profile === "web" || profile === "tui" || profile === "gui") return profile;
  if (profile === "desktop") return "desktop";

  const execPath = input.execPath ?? process.execPath;
  if (isElectronRunAsNode(env) && isOfficialHarnessExeName(exeName(execPath))) {
    return "desktop";
  }

  if (isElectronGuiProcess(input)) return "desktop";
  return "web";
}

export function isDesktopSurface(input = {}) {
  return detectSurface(input) === "desktop";
}

export function normalizeSurface(value) {
  const n = norm(value);
  return SURFACES.includes(n) ? n : "";
}

export function thisProcessIsElectronGui(input = {}) {
  return isElectronGuiProcess(input);
}

/**
 * 用户点的那一面。浏览器 = web，Electron 窗口 = desktop。
 * 官方桌面里的内嵌 `dsh web` 进程 argv 带 web，不能因此把桌面应用当成 web。
 */
export function controlSurface(input = {}) {
  // 窗口面 / 内嵌桌面优先。客户端误报 surface=web 不能把桌面点应用带去重启 dsh web。
  if (input.electron === true) return "desktop";
  if (input.embeddedDesktop === true) return "desktop";
  if (isElectronGuiProcess(input)) return "desktop";
  const hinted = normalizeSurface(input.hint);
  if (hinted === "desktop") return "desktop";
  if (hinted === "web") return "web";
  return detectSurface(input);
}

/** gui / tui 尚未单独适配，先走 web 重启与探测。 */
export function adapterFor(kind) {
  return kind === "desktop" ? "desktop" : "web";
}
