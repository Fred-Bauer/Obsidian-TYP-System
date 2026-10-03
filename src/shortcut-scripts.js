const { TFile, Vault, debounce, normalizePath } = require("obsidian");

// Only Templater scripts with this marker in a comment are offered in the
// shortcut picker; helper scripts make no sense as shortcuts. The text after
// the marker up to the line end is the description (a closing "*/" is not
// part of it).
//
// An optional parameter list in parentheses right after the marker describes
// the COMPLETE argument list after "tp", including where the script wants the
// file or context (see RESERVED_PARAMS in shortcuts.js):
//   // @typ-shortcut(folder, year)      -> f(tp, "Literatur", 2024)
//   // @typ-shortcut(newFile, year)     -> f(tp, newFile, 2024)
//   // @typ-shortcut(property)          -> f(tp, "Familie")
//   // @typ-shortcut                    -> f(tp, newFile, ctx)
// No parentheses (params === null) is the classic call f(tp, newFile, ctx);
// empty parentheses (params === []) pass only tp.
//
// The marker must start the comment. Allowing text before it once turned
// TYP.js into a shortcut, just because its header comment mentions the marker.
// "\b" after the name rejects "@typ-shortcutXYZ" but allows the "(".
const SHORTCUT_MARKER = /^[ \t]*(?:\/\/+|\/\*+|\*)[ \t]*@typ-shortcut\b(?:\(([^)]*)\))?[ \t]*(.*?)[ \t]*(?:\*\/)?[ \t]*$/m;

// Parameter names from the marker, in declared order. Empty entries ("()", a
// stray comma) are dropped, duplicates kept once - two fields writing the same
// entry would only confuse.
function parseParams(raw) {
  const names = (raw ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  return [...new Set(names)];
}

// Keeps the list of marked Templater scripts current. It is read ahead of time
// and updated on changes, so the picker opens without waiting and without file
// access. Returns an accessor for the list ([{ name, params, description }],
// sorted by name).
function registerShortcutScripts(plugin) {
  const { app } = plugin;

  let scriptFolder = null;
  let scripts = [];

  const currentScriptFolder = () => {
    const folder = app.plugins.plugins["templater-obsidian"]?.settings?.user_scripts_folder;
    return folder ? normalizePath(folder) : null;
  };

  const isInScriptFolder = (path) => !!scriptFolder && !!path && path.startsWith(scriptFolder + "/");

  // Like Templater: every .js in the script folder including subfolders,
  // script name = file name without extension.
  async function refreshScripts() {
    const folderPath = currentScriptFolder();
    scriptFolder = folderPath;
    const folder = folderPath ? app.vault.getFolderByPath(folderPath) : null;
    const files = [];
    if (folder) {
      Vault.recurseChildren(folder, (child) => {
        if (child instanceof TFile && child.extension === "js") files.push(child);
      });
    }
    const found = [];
    for (const file of files) {
      try {
        const match = (await app.vault.cachedRead(file)).match(SHORTCUT_MARKER);
        // match[1] is undefined without parentheses and "" with empty ones;
        // that difference decides the call form.
        if (match) {
          found.push({
            name: file.basename,
            params: match[1] === undefined ? null : parseParams(match[1]),
            description: match[2] ?? "",
          });
        }
      } catch (e) {
        console.error(`TYP-System: can't read Templater script ${file.path}`, e);
      }
    }
    // Folder changed in Templater meanwhile: drop this result, the run for the
    // new folder is already scheduled.
    if (folderPath !== scriptFolder) return;
    scripts = found.sort((a, b) => a.name.localeCompare(b.name));
  }

  const scheduleRefresh = debounce(refreshScripts, 300, true);
  const onFileChange = (file, oldPath) => {
    if (isInScriptFolder(file?.path) || isInScriptFolder(oldPath)) scheduleRefresh();
  };
  plugin.registerEvent(app.vault.on("create", onFileChange));
  plugin.registerEvent(app.vault.on("modify", onFileChange));
  plugin.registerEvent(app.vault.on("delete", onFileChange));
  plugin.registerEvent(app.vault.on("rename", onFileChange));
  app.workspace.onLayoutReady(refreshScripts);

  return () => {
    // Templater folder changed: reload for the next call, answer with the
    // current list for now.
    if (currentScriptFolder() !== scriptFolder) scheduleRefresh();
    return scripts;
  };
}

module.exports = { registerShortcutScripts, SHORTCUT_MARKER, parseParams };
