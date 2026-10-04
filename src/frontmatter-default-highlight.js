const { getSubtypNames, getSubtyp } = require("./subtyps");
const { subtypColor, setInlineColor, allDocuments } = require("./typ-colors");
const { VIEW_TYPE_TYP_PANE } = require("./typ-pane");

const ALL_PROPERTIES_VIEW_TYPE = "all-properties";
const HIGHLIGHT_CLASS = "typ-default-property";
// Floating properties are marked italic instead of bold.
const FLOATING_CLASS = "typ-floating-property";

// Obsidian always lowercases data-property-key, so comparisons ignore case.
function rawKeysForTyp(typ, defaults) {
  if (!typ || !defaults) return null;
  const keys = Object.keys(defaults).filter((key) => key !== "");
  return keys.length > 0 ? keys.map((key) => key.toLowerCase()) : null;
}

// A TYP's frontmatter blocks as [{ section, keys, floating }] (lowercase):
// the TYP-Frontmatter first, then optionally one Subtyp's block or, with
// ALL_SUBTYPS, every Subtyp's block (see subtyps.js).
const ALL_SUBTYPS = Symbol("all-subtyps");

function blockOf(defaults, floatingKeys, section = null) {
  const keys = rawKeysForTyp(true, defaults) ?? [];
  return { section, keys, floating: new Set((floatingKeys ?? []).map((key) => key.toLowerCase())) };
}

function blocksForTyp(plugin, typ, subtyp) {
  const { settings } = plugin;
  const blocks = [blockOf(settings.typDefaultFrontmatter[typ], settings.typFloatingKeys[typ], null)];
  const subtypNames = subtyp === ALL_SUBTYPS ? getSubtypNames(settings, typ) : subtyp ? [subtyp] : [];
  for (const name of subtypNames) {
    const data = getSubtyp(settings, typ, name);
    if (data) blocks.push(blockOf(data.frontmatter, data.floatingKeys, name));
  }
  return blocks;
}

// Separate sets of names to bold ("standard") and to italicize ("floating").
// A floating key never also counts as standard. If a key is in several blocks,
// the later block decides - for a note that is its Subtyp block, the same rule
// as for the value in getTypDefaults (main.js).
function splitKeys(blocks) {
  const isFloating = new Map();
  for (const { keys, floating } of blocks) {
    for (const key of keys) isFloating.set(key, floating.has(key));
  }
  const standard = new Set();
  const floating = new Set();
  for (const [key, flag] of isFloating) (flag ? floating : standard).add(key);
  return { standard: standard.size > 0 ? standard : null, floating: floating.size > 0 ? floating : null };
}

const NO_KEYS = { standard: null, floating: null };

function keysForFile(plugin, file) {
  const { colorViews } = plugin.settings;
  if (!colorViews.frontmatterDefaults) return NO_KEYS;
  const typ = plugin.typIndex.typOf(file);
  if (!typ) return NO_KEYS;
  const subtyp = colorViews.frontmatterDefaultsSubtyp ? plugin.typIndex.subtypOf(file) : null;
  return splitKeys(blocksForTyp(plugin, typ, subtyp));
}

// TYP-Pane detail editors: one editor per block (see typStore/subtypStore in
// typ-frontmatter-editor.js), so the marks show exactly that block's keys.
// Subtyp blocks only with the "Subtyp" sub-toggle.
function keysForStore(plugin, store) {
  const { colorViews } = plugin.settings;
  if (!colorViews.frontmatterDefaults || !store) return NO_KEYS;
  if (store.subtyp && !colorViews.frontmatterDefaultsSubtyp) return NO_KEYS;
  return splitKeys([blockOf(store.getFrontmatter(), store.getFloating())]);
}

// Property name (lowercase) -> { typs, allFloating } across every TYP whose
// frontmatter (optionally with its Subtyp blocks) has it. "All properties" is
// vault-wide with no single TYP context, so the full mapping is collected to
// tell "exactly one TYP" (color) from "several" (bold). typs maps TYP -> the
// blocks holding the key (null = the TYP-Frontmatter); only the unambiguous
// case gets colored. allFloating is true if the key is floating in EVERY block
// of EVERY TYP - anything less would make italics misleading.
//
// Own toggle (colorViews.allProperties), independent of frontmatterDefaults.
// A Subtyp property counts for its TYP.
function typsUsingKeyMap(plugin) {
  const map = new Map();
  const { colorViews } = plugin.settings;
  if (!colorViews.allProperties) return map;
  const typs = new Set([
    ...Object.keys(plugin.settings.typDefaultFrontmatter),
    ...(colorViews.allPropertiesSubtyp ? Object.keys(plugin.settings.typSubtyps ?? {}) : []),
  ]);
  for (const typ of typs) {
    const blocks = blocksForTyp(plugin, typ, colorViews.allPropertiesSubtyp ? ALL_SUBTYPS : null);
    for (const { section, keys, floating } of blocks) {
      for (const key of keys) {
        if (!map.has(key)) map.set(key, { typs: new Map(), allFloating: true });
        const entry = map.get(key);
        if (!entry.typs.has(typ)) entry.typs.set(typ, []);
        entry.typs.get(typ).push(section);
        entry.allFloating = entry.allFloating && floating.has(key);
      }
    }
  }
  return map;
}

// Marks only the name (key input), not the value - in notes (frontmatter and
// properties sidebar) as well as in the plugin's own TYP-Pane.
function applyToContainer(containerEl, standardKeys, floatingKeys) {
  if (!containerEl) return;
  const rows = containerEl.querySelectorAll(".metadata-property[data-property-key]");
  for (const row of rows) {
    const keyEl = row.querySelector(".metadata-property-key-input");
    if (!keyEl) continue;
    const propertyKey = row.getAttribute("data-property-key");
    keyEl.classList.toggle(HIGHLIGHT_CLASS, !!standardKeys && standardKeys.has(propertyKey));
    keyEl.classList.toggle(FLOATING_CLASS, !!floatingKeys && floatingKeys.has(propertyKey));
  }
}

// "All properties" doesn't use the metadata widget but its own tree items,
// reachable via view.doms (name -> component); their title element is
// .tree-item-inner-text.
//
// One TYP using the property: the name gets that TYP's color. Several: a
// single color would mislead, so bold instead (same mark as in a note).
function applyToAllPropertiesView(plugin) {
  const usageMap = typsUsingKeyMap(plugin);
  for (const leaf of plugin.app.workspace.getLeavesOfType(ALL_PROPERTIES_VIEW_TYPE)) {
    const doms = leaf.view?.doms;
    if (!doms) continue;
    for (const [key, dom] of Object.entries(doms)) {
      const titleEl = dom?.titleEl;
      if (!titleEl) continue;

      const entry = usageMap.get(key.toLowerCase());
      const typs = entry?.typs;
      const count = typs ? typs.size : 0;
      titleEl.classList.toggle(HIGHLIGHT_CLASS, count > 1);

      // Italic as soon as it is floating EVERYWHERE. Unlike bold this isn't
      // limited to one TYP, so both can apply at once.
      titleEl.classList.toggle(FLOATING_CLASS, count > 0 && entry.allFloating);

      // With "Subtyp", the color of the Subtyp block the property comes from -
      // but only if exactly one block of that TYP has it. Otherwise the choice
      // would be arbitrary and change with block order, so the TYP color
      // (subtypColor with null) is used.
      if (count === 1) {
        const [[onlyTyp, sections]] = typs;
        const color = plugin.settings.colorViews.allPropertiesSubtyp
          ? subtypColor(plugin.settings, onlyTyp, sections.length === 1 ? sections[0] : null)
          : plugin.settings.typColors[onlyTyp];
        // !important, because the bold rule in styles.css also sets color
        // !important and could still be attached from an earlier state.
        setInlineColor(titleEl, color, "important");
      } else {
        setInlineColor(titleEl, null);
      }
    }
  }
}

function applyFrontmatterDefaultHighlight(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view;
    const { standard, floating } = keysForFile(plugin, view?.file);
    applyToContainer(view?.metadataEditor?.containerEl, standard, floating);
  }

  // The properties sidebar always shows the active file but keeps no reliable
  // reference to it, hence the fallback to the workspace's active file.
  for (const leaf of plugin.app.workspace.getLeavesOfType("file-properties")) {
    const view = leaf.view;
    const file = view?.file ?? plugin.app.workspace.getActiveFile();
    const { standard, floating } = keysForFile(plugin, file);
    applyToContainer(view?.metadataEditor?.containerEl, standard, floating);
  }

  // The TYP-Pane: each editor shows exactly one block (TYP or Subtyp).
  for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TYP_PANE)) {
    for (const editor of leaf.view?.frontmatterEditors ?? []) {
      const { standard, floating } = keysForStore(plugin, editor.owner?.typStore);
      applyToContainer(editor.containerEl, standard, floating);
    }
  }

  applyToAllPropertiesView(plugin);
}

function registerFrontmatterDefaultHighlight(plugin) {
  const refresh = () => applyFrontmatterDefaultHighlight(plugin);

  plugin.registerEvent(plugin.app.metadataCache.on("changed", refresh));
  plugin.registerEvent(plugin.app.metadataCache.on("resolved", refresh));
  plugin.registerEvent(plugin.app.workspace.on("layout-change", refresh));
  plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", refresh));

  plugin.app.workspace.onLayoutReady(refresh);

  // Bold/italic marks would otherwise stay on property names in open notes,
  // the properties sidebar and "All properties" after the plugin is disabled.
  // The color in "All properties" goes with the other inline colors
  // (clearInlineColors, see main.js).
  plugin.register(() => {
    for (const doc of allDocuments(plugin.app)) {
      for (const el of doc.querySelectorAll(`.${HIGHLIGHT_CLASS}, .${FLOATING_CLASS}`)) {
        el.classList.remove(HIGHLIGHT_CLASS, FLOATING_CLASS);
      }
    }
  });

  return refresh;
}

module.exports = { registerFrontmatterDefaultHighlight };
