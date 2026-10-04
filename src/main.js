const { Plugin } = require("obsidian");
const { DEFAULT_SETTINGS, TypSystemSettingTab } = require("./settings");
const { registerCommands } = require("./commands");
const { registerTypPane, sortTypsByMode, DEFAULT_SORT_ORDER } = require("./typ-pane");
const { TypIndex, setCanonicalProperty, deleteProperty, TYP_PROPERTY, SUBTYP_PROPERTY } = require("./typ-index");
const { getSubtyp, getSubtypNames, isSubtypManual } = require("./subtyps");
const { registerFileExplorerColors } = require("./file-explorer-colors");
const { registerGraphColors } = require("./graph-colors");
const { registerSearchColors } = require("./search-colors");
const { registerRecentFilesColors } = require("./recent-files-colors");
const { registerBacklinkColors } = require("./backlink-colors");
const { registerBookmarksColors } = require("./bookmark-colors");
const { registerActiveTitleColors } = require("./active-title-colors");
const { registerLinkColors } = require("./link-colors");
const { registerFrontmatterDefaultHighlight } = require("./frontmatter-default-highlight");
const { registerPropertyRenameSync } = require("./property-rename-sync");
const { removePropertyMenuPatch } = require("./typ-frontmatter-editor");
const { normalizeGlobalOrder, sortFrontmatterFor, placePropertyFor } = require("./frontmatter-sort");
const { resolveShortcuts, scriptNameOf, resolveCallArgs } = require("./shortcuts");
const {
  pickTyp: pickTypModal,
  pickSubtyp: pickSubtypModal,
  pickTypAndSubtyp: pickTypAndSubtypModal,
} = require("./typ-picker");
const { registerShortcutScripts } = require("./shortcut-scripts");
const { clearInlineColors, allDocuments } = require("./typ-colors");

module.exports = class TypSystemPlugin extends Plugin {
  async onload() {
    // Read once here: no data.json (loadData() resolves null) means the plugin
    // is loaded for the very first time in this vault, and the TYP-Pane opens
    // on its own once (see registerTypPane).
    const data = await this.loadData();
    this.isFirstRun = data == null;
    await this.loadSettings(data);

    // Disabling the plugin takes its inline colors out of the explorer,
    // search, Recent Files, backlinks, bookmarks, note titles and "All
    // properties" (see setInlineColor in typ-colors.js); those views would
    // keep them until they happen to re-render. Registered first so it runs
    // last on unload, after the modules have stopped observing and listening.
    this.register(() => {
      for (const doc of allDocuments(this.app)) clearInlineColors(doc);
    });

    // Before all other modules: they listen to its "change" event and read
    // TYP/SUBTYP only through it (see typ-index.js).
    this.typIndex = new TypIndex(this);
    this.typIndex.register();

    registerCommands(this);
    this.addSettingTab(new TypSystemSettingTab(this.app, this));
    // Carries renames from "All properties"/Bases into the TYP-Frontmatter.
    registerPropertyRenameSync(this);
    // The TYP-Pane patches the property menu lazily (ensurePropertyMenuPatch).
    this.register(removePropertyMenuPatch);
    // Accessor for the Templater scripts marked "@typ-shortcut", used by the
    // shortcut picker of the property rows.
    this.getShortcutScripts = registerShortcutScripts(this);

    // Kept separate from refreshFns: after mounting its editors the TYP-Pane
    // needs only this refresh (bold property names). The whole
    // refreshTypColors() bundle would also trigger the view's own re-render and
    // recurse into a stack overflow on every TYP opened.
    this.refreshFrontmatterHighlight = registerFrontmatterDefaultHighlight(this);

    // Two variants, like refreshFrontmatterHighlight above:
    //  - refreshTypColors() refreshes every view, the TYP-Pane included
    //    (re-rendered from the settings) - for changes made elsewhere (settings
    //    tab, property rename sync, Sync, Undo).
    //  - refreshTypColorsExcept(view) leaves that one TYP-Pane out - for its
    //    own actions. A full re-render there would throw away focus, an open
    //    inline input or the editor being typed in, so the pane updates itself
    //    and calls render() only where it really has to rebuild. Other
    //    TYP-Pane leaves (rare - see activateTypPane) are still re-rendered.
    const refreshTypPane = registerTypPane(this);
    const refreshFns = [
      registerFileExplorerColors(this),
      registerGraphColors(this),
      registerSearchColors(this),
      registerRecentFilesColors(this),
      registerBacklinkColors(this),
      registerBookmarksColors(this),
      registerActiveTitleColors(this),
      registerLinkColors(this),
      this.refreshFrontmatterHighlight,
    ];
    this.refreshTypColorsExcept = (exceptView) => {
      refreshTypPane(exceptView);
      refreshFns.forEach((fn) => fn());
    };
    this.refreshTypColors = () => this.refreshTypColorsExcept(null);

    // Style Settings reads stylesheets when it loads and afterwards only on
    // "css-change", which fires for themes and snippets but not for a plugin's
    // styles.css. A plugin loaded later (or hot-reloaded) would be missing
    // there; "parse-style-settings" is the intended hook. Without Style
    // Settings nobody listens and nothing happens.
    //
    // Next tick, because Obsidian adds a plugin's styles.css only AFTER
    // onload(). onLayoutReady doesn't help: on hot reload the layout is long
    // ready and the callback would run at once, just as early.
    const parseStyleSettings = window.setTimeout(() => this.app.workspace.trigger("parse-style-settings"), 0);
    this.register(() => window.clearTimeout(parseStyleSettings));
  }

  onunload() {}

  // For _obsidian/templater-scripts/TYP.js: the TYP-Frontmatter of a TYP, so
  // Templater can apply it to a new note instead of keeping a second copy. A
  // copy, so callers may change it freely.
  //
  // Properties with a fixed shortcut (today/now/created, see shortcuts.js)
  // carry its value, computed fresh on each call. Properties with a script
  // shortcut carry null: only Templater can resolve them, TYP.js gets them via
  // getTypShortcuts() and fills them in. Key and position stay either way.
  //
  // includeFloating (default false) keeps floating keys in the result; they
  // are not created for every new note, only when a script asks for them.
  //
  // file (optional) goes to resolveShortcuts() for "created", which returns
  // the file's creation date instead of the call time.
  //
  // subtyp (optional) appends that Subtyp's block. A key in BOTH blocks keeps
  // the TYP-Frontmatter position, but value, floating flag and shortcut come
  // from the Subtyp. Frontmatter sorting must use the same rule (see
  // orderedDefaultKeys in frontmatter-sort.js), or it would re-sort a new note
  // right away.
  getTypDefaults(typ, { includeFloating = false, file, subtyp = null } = {}) {
    const { defaults, shortcuts } = this.collectBlocks(typ, subtyp, includeFloating);
    return resolveShortcuts(defaults, shortcuts, { file, app: this.app });
  }

  // Shared base of getTypDefaults() and getTypShortcuts(): the TYP-Frontmatter
  // plus the Subtyp's block. A key in BOTH keeps the TYP-Frontmatter position;
  // value, floating flag AND shortcut come from the Subtyp - "no shortcut"
  // counts as the Subtyp's choice too and cancels the TYP's.
  collectBlocks(typ, subtyp, includeFloating) {
    const defaults = {};
    const shortcuts = {};
    const isFloating = new Map();
    const addBlock = (frontmatter, floatingKeys, blockShortcuts) => {
      const actualKeys = new Map(Object.keys(defaults).map((key) => [key.toLowerCase(), key]));
      for (const [key, value] of Object.entries(frontmatter ?? {})) {
        if (key === "") continue;
        const target = actualKeys.get(key.toLowerCase()) ?? key;
        defaults[target] = value;
        isFloating.set(target, (floatingKeys ?? []).includes(key));
        const record = (blockShortcuts ?? {})[key];
        if (record) shortcuts[target] = record;
        else delete shortcuts[target];
      }
    };
    const subtypData = subtyp ? getSubtyp(this.settings, typ, subtyp) : null;
    addBlock(
      this.settings.typDefaultFrontmatter[typ],
      this.settings.typFloatingKeys[typ],
      this.settings.typShortcuts[typ]
    );
    if (subtypData) addBlock(subtypData.frontmatter, subtypData.floatingKeys, subtypData.shortcuts);

    if (!includeFloating) {
      for (const [key, floating] of isFloating) {
        if (!floating) continue;
        delete defaults[key];
        delete shortcuts[key];
      }
    }
    return { defaults, shortcuts };
  }

  // For TYP.js: the properties of this TYP whose value comes from a Templater
  // script, as { [property]: { name, params, args, fallback } } in
  // TYP-Frontmatter order (the scripts run in turn and see earlier results).
  //
  //   name      script name without "tp.", i.e. tp.user.<name>
  //   params    the parameter list declared in the @typ-shortcut marker, or
  //             null without parentheses. Taken from the current scan, so a
  //             changed declaration applies at once. TYP.js turns it into the
  //             call's arguments with resolveShortcutArgs()
  //   args      the typed arguments, named after the non-reserved parameters;
  //             an empty field is missing so "args.x ?? fallback" works
  //   fallback  the fixed value stored for the property. Only a FALLBACK:
  //             TYP.js writes it if the script is missing or throws. A script
  //             that deliberately returns null/"" (ESC in a picker) has not
  //             failed - the property stays empty then.
  //
  // Fixed shortcuts (today/now/created) don't appear here; getTypDefaults()
  // already resolves them and returns the script keys as null.
  //
  // Options as in getTypDefaults(); includeFloating defaults to false so no
  // script runs unasked for a floating property.
  getTypShortcuts(typ, { includeFloating = false, subtyp = null } = {}) {
    const { defaults, shortcuts } = this.collectBlocks(typ, subtyp, includeFloating);
    const scripts = this.getShortcutScripts?.() ?? [];
    const result = {};
    for (const [key, record] of Object.entries(shortcuts)) {
      const name = scriptNameOf(record.name);
      if (name === null) continue;
      const script = scripts.find((s) => s.name === name);
      result[key] = {
        name,
        params: script?.params ?? null,
        args: { ...(record.args ?? {}) },
        fallback: defaults[key] ?? null,
      };
    }
    return result;
  }

  // For TYP.js: turns a shortcut's parameter list into the arguments of
  // tp.user.<name>(tp, ...) - see resolveCallArgs in shortcuts.js. Lives here
  // so the rules (reserved names, dotted names) exist in one place; only
  // TYP.js knows newFile and ctx, so it passes them in.
  resolveShortcutArgs(params, args, { newFile = null, ctx = null, key = null } = {}) {
    return resolveCallArgs(params, args, { newFile, ctx, key });
  }

  // For TYP.js: registered Subtyps of a TYP in block order, with note counts.
  // Subtyps that aren't manually creatable are left out unless
  // includeManualOff is set, like such TYP entries in getTyps().
  getSubtyps(typ, { includeManualOff = false } = {}) {
    const { counts } = this.typIndex.subtypBucket(typ);
    return getSubtypNames(this.settings, typ)
      .filter((subtyp) => includeManualOff || isSubtypManual(this.settings, typ, subtyp))
      .map((subtyp) => ({ subtyp, count: counts.get(subtyp) ?? 0 }));
  }

  // For TYP.js: the Subtyp-Picker (see typ-picker.js). Resolves with the
  // Subtyp, "" for "no Subtyp" (or without a picker if the TYP has none), or
  // null on ESC (TYP.js then goes back to the TYP choice). query (optional):
  // an already typed search that pre-sorts the list. options as in getSubtyps.
  pickSubtyp(typ, query = "", options = {}) {
    return pickSubtypModal(this.app, this, typ, query, options);
  }

  // For TYP.js, inside processFrontMatter: sets TYP and SUBTYP in canonical
  // spelling - a variant like "typ" or "Subtyp" is renamed in place rather than
  // duplicated. subtyp null removes an existing SUBTYP.
  applyTypProperties(frontmatter, typ, subtyp) {
    setCanonicalProperty(frontmatter, TYP_PROPERTY, typ);
    if (subtyp) setCanonicalProperty(frontmatter, SUBTYP_PROPERTY, subtyp);
    else deleteProperty(frontmatter, SUBTYP_PROPERTY);
  }

  // For TYP.js, inside processFrontMatter and after all other changes: puts the
  // frontmatter into sorting order, or newly added properties (SUBTYP in an
  // existing note, say) would end up last.
  sortFrontmatter(frontmatter, typ, subtyp = null) {
    return sortFrontmatterFor(this, frontmatter, typ, subtyp);
  }

  // Inside processFrontMatter: moves only property `key` to its sorted place
  // (TYP/SUBTYP read from the object), everything else stays - for Fred's
  // property backlinking, so a new property doesn't end up last.
  placeProperty(frontmatter, key) {
    return placePropertyFor(this, frontmatter, key);
  }

  // For TYP.js: the registered TYP entries with their descriptions, in the
  // order of the TYP-List (its current sort setting). TYP entries that aren't
  // manually creatable are left out unless includeManualOff is true.
  getTyps({ includeManualOff = false } = {}) {
    const { counts } = this.typIndex.typCounts();
    const sortOrder = this.settings.typSortOrder ?? DEFAULT_SORT_ORDER;
    return sortTypsByMode(this.settings.typs, sortOrder, counts, this.settings.typColors)
      .filter((typ) => includeManualOff || (this.settings.typManual ?? {})[typ] !== false)
      .map((typ) => ({
        typ,
        description: this.settings.typDescriptions[typ] ?? "",
        count: counts.get(typ) ?? 0,
      }));
  }

  // For TYP.js: the native TYP-Picker (see typ-picker.js) with color,
  // description and note count. includeManualOff as in getTyps(). Resolves
  // with the TYP, or null on ESC.
  pickTyp(options) {
    return pickTypModal(this.app, this, options);
  }

  // For TYP.js: TYP and Subtyp in one go (see typ-picker.js) - one picker with
  // indented Subtyps or both pickers in turn, per "Separate Subtyp-Picker".
  // Resolves with { typ, subtyp } (subtyp null for "no Subtyp"), or null on
  // ESC.
  pickTypAndSubtyp(options) {
    return pickTypAndSubtypModal(this.app, this, options);
  }

  // data: what loadData() returned, if the caller already has it (onload);
  // without it (onExternalSettingsChange) data.json is read here.
  async loadSettings(data) {
    if (data === undefined) data = await this.loadData();
    // A deep copy as the base: without data.json (a fresh install) or with keys
    // missing from it, settings.typs, typColors and so on would otherwise BE
    // the objects in DEFAULT_SETTINGS, and every change would alter the
    // defaults along with them.
    this.settings = Object.assign(structuredClone(DEFAULT_SETTINGS), data);
    // Object.assign replaces nested objects whole; views added later (e.g.
    // colorViews.links) would otherwise be silently off in older settings.
    this.settings.colorViews = { ...DEFAULT_SETTINGS.colorViews, ...this.settings.colorViews };
    this.settings.globalPropertyOrder = normalizeGlobalOrder(this.settings.globalPropertyOrder);
  }

  // settingsRevision counts every change of the settings (here and in
  // onExternalSettingsChange). Undo (undo.js) compares it to tell whether
  // anything happened after the action it would revert. Bumped synchronously,
  // before the await, so a caller that doesn't await still counts at once.
  async saveSettings() {
    this.settingsRevision = (this.settingsRevision ?? 0) + 1;
    await this.saveData(this.settings);
  }

  // Called when data.json changes from outside, in practice through Obsidian
  // Sync. Without it this device would keep its old settings in memory and
  // overwrite the new ones on the next save. Obsidian rebuilds an open
  // settings tab itself; colors and the TYP-Pane are refreshed here.
  async onExternalSettingsChange() {
    // Invalidates a pending undo: its snapshot predates the synced settings.
    this.settingsRevision = (this.settingsRevision ?? 0) + 1;
    await this.loadSettings();
    this.refreshTypColors();
  }
};
