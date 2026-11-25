/* [dsh-purge-plus] 取自 dsh-purge-safe v2.0.2（Apache-2.0）原样移植；仅改设置目录名与加本行来源标注。
 * 上游许可与 NOTICE 见包内 LICENSE-SAFE-APACHE-2.0.txt / NOTICE-SAFE.txt；移植清单见 NOTICE-PLUS.md §8。
 *
 * 作用：`keepMnemon` 开关。identity.js 的 prompt 改写默认会把宿主 mnemon（记忆层）
 * 那一段从注入里摘掉；打开这个开关就保留它。设置落 `$DSH_HOME/dsh-purge-plus/mnemon.json`。
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_SETTINGS = Object.freeze({ keepMnemon: false });
const SETTINGS_FILE = "mnemon.json";

function mnemonSettingsPath(dshHome) {
  return path.join(dshHome, "dsh-purge-plus", SETTINGS_FILE);
}

export function loadMnemonSettings(dshHome, configValue) {
  let file = {};
  try {
    const fp = mnemonSettingsPath(dshHome);
    if (fs.existsSync(fp)) {
      const parsed = JSON.parse(fs.readFileSync(fp, "utf8"));
      if (parsed && typeof parsed === "object") file = parsed;
    }
  } catch {
    file = {};
  }
  const pick = [file.keepMnemon, configValue, DEFAULT_SETTINGS.keepMnemon];
  const value = pick.find((v) => typeof v === "boolean");
  return { keepMnemon: value === undefined ? false : value };
}

function atomicWriteFileSync(fp, content, encoding = "utf8") {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, content, encoding);
    try { fs.fsyncSync(fd); } catch { /* FS 不支持 fsync 时忽略 */ }
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, fp);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

export function saveMnemonSettings(dshHome, patch) {
  const fp = mnemonSettingsPath(dshHome);
  const current = loadMnemonSettings(dshHome);
  const next = {
    keepMnemon: typeof patch?.keepMnemon === "boolean"
      ? patch.keepMnemon
      : current.keepMnemon,
  };
  atomicWriteFileSync(fp, `${JSON.stringify(next, null, 2)}\n`);
  return { ok: true, ...next, path: fp };
}
