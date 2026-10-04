const { MarkdownView, Menu, WorkspaceLeaf, setIcon } = require("obsidian");
const { shortcutLabel, scriptNameOf } = require("./shortcuts");
const { pickShortcut } = require("./shortcut-picker");
const { getSubtyp, ensureSubtyp } = require("./subtyps");
const { TYP_PROPERTY, SUBTYP_PROPERTY } = require("./typ-index");
const { snapshotSettings, offerUndo } = require("./undo");

// Marks the TYP-Frontmatter editor's container so the shortcut rules in
// styles.css apply only here, never in real notes.
const EDITOR_CLASS = "typ-frontmatter-editor";

const SYSTEM_PROPERTIES = [TYP_PROPERTY.toLowerCase(), SUBTYP_PROPERTY.toLowerCase()];

// The value of TYP/SUBTYP is by definition the TYP or Subtyp name itself; as
// a standard property it would be redundant and could silently drift from the
// real name after a rename, so it never appears as a row here.
// Mutates in place instead of returning a copy: Obsidian's property editor
// seems to rely on a stable object reference in synchronize(); a fresh copy
// caused a stack overflow in its renderProperty() pipeline on first render.
function stripTypProperty(frontmatter) {
  for (const key of Object.keys(frontmatter)) {
    if (SYSTEM_PROPERTIES.includes(key.trim().toLowerCase())) delete frontmatter[key];
  }
  return frontmatter;
}

// Where a frontmatter block lives in the settings: a TYP's TYP-Frontmatter
// (typDefaultFrontmatter/typFloatingKeys/typShortcuts) or one of its Subtyp
// blocks (typSubtyps, see subtyps.js). Editor, floating menu, shortcut button
// and property rename only use this interface and needn't know which.
//
// getShortcuts/setShortcuts hold the shortcut records per key (see
// shortcuts.js) - next to the frontmatter, not in it, so the value stays
// type-clean. With a shortcut set, the value remains as fallback.
function typStore(plugin, typ) {
  return {
    typ,
    subtyp: null,
    getFrontmatter: () => plugin.settings.typDefaultFrontmatter[typ] ?? {},
    setFrontmatter: (frontmatter) => {
      plugin.settings.typDefaultFrontmatter[typ] = frontmatter;
    },
    getFloating: () => plugin.settings.typFloatingKeys[typ] ?? [],
    setFloating: (keys) => {
      if (keys.length > 0) plugin.settings.typFloatingKeys[typ] = keys;
      else delete plugin.settings.typFloatingKeys[typ];
    },
    getShortcuts: () => plugin.settings.typShortcuts[typ] ?? {},
    setShortcuts: (shortcuts) => {
      if (Object.keys(shortcuts).length > 0) plugin.settings.typShortcuts[typ] = shortcuts;
      else delete plugin.settings.typShortcuts[typ];
    },
  };
}

function subtypStore(plugin, typ, subtyp) {
  return {
    typ,
    subtyp,
    getFrontmatter: () => getSubtyp(plugin.settings, typ, subtyp)?.frontmatter ?? {},
    setFrontmatter: (frontmatter) => {
      ensureSubtyp(plugin.settings, typ, subtyp).frontmatter = frontmatter;
    },
    getFloating: () => getSubtyp(plugin.settings, typ, subtyp)?.floatingKeys ?? [],
    setFloating: (keys) => {
      ensureSubtyp(plugin.settings, typ, subtyp).floatingKeys = keys;
    },
    getShortcuts: () => getSubtyp(plugin.settings, typ, subtyp)?.shortcuts ?? {},
    setShortcuts: (shortcuts) => {
      ensureSubtyp(plugin.settings, typ, subtyp).shortcuts = shortcuts;
    },
  };
}

// Obsidian's properties widget is no official API. Internally it is a
// component class (minified "MetadataEditor") that every MarkdownView and the
// file properties pane instantiate as view.metadataEditor. It isn't exported,
// but any instance reaches it via .constructor, and it is stable for the
// session - grabbing it once is enough.
let cachedEditorClass = null;

function getMetadataEditorClass(app) {
  if (cachedEditorClass) return cachedEditorClass;

  const active = app.workspace.getActiveViewOfType(MarkdownView);
  if (active?.metadataEditor) {
    cachedEditorClass = active.metadataEditor.constructor;
    return cachedEditorClass;
  }
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    if (leaf.view?.metadataEditor) {
      cachedEditorClass = leaf.view.metadataEditor.constructor;
      return cachedEditorClass;
    }
  }
  cachedEditorClass = harvestEditorClass(app);
  return cachedEditorClass;
}

// Before any note was open this session there is no instance to reach the
// class through. Then we build one: a free WorkspaceLeaf (no parent, never in
// the DOM) with a MarkdownView from Obsidian's view registry, whose
// constructor creates metadataEditor. Only the class is needed; the view is
// unloaded right away. Deliberately NOT leaf.detach(): that expects a parent
// this leaf never had.
function harvestEditorClass(app) {
  let view = null;
  try {
    const createView = app.viewRegistry?.getViewCreatorByType?.("markdown");
    if (!createView) return null;
    view = createView(new WorkspaceLeaf(app));
    return view.metadataEditor?.constructor ?? null;
  } catch (error) {
    console.error("[typ-system] couldn't find the MetadataEditor class", error);
    return null;
  } finally {
    try {
      view?.unload();
    } catch (error) {
      console.error("[typ-system] couldn't discard the helper MarkdownView", error);
    }
  }
}

// Like getMetadataEditorClass: the private property row class, taken from an
// already rendered row. Only ensurePropertyMenuPatch() needs it, and `editor`
// usually has a row by then, so it is tried first.
let cachedPropertyRowClass = null;

function getPropertyRowClass(app, editor) {
  if (cachedPropertyRowClass) return cachedPropertyRowClass;
  if (editor?.rendered?.[0]) {
    cachedPropertyRowClass = editor.rendered[0].constructor;
    return cachedPropertyRowClass;
  }
  const active = app.workspace.getActiveViewOfType(MarkdownView);
  if (active?.metadataEditor?.rendered?.[0]) {
    cachedPropertyRowClass = active.metadataEditor.rendered[0].constructor;
    return cachedPropertyRowClass;
  }
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    if (leaf.view?.metadataEditor?.rendered?.[0]) {
      cachedPropertyRowClass = leaf.view.metadataEditor.rendered[0].constructor;
      return cachedPropertyRowClass;
    }
  }
  return null;
}

// Adds a "Floating" toggle at the very top of a property row's context menu -
// only for rows of the plugin's own TYP-Pane (recognized by owner.typStore),
// never in real notes. Unlike the extra "+" button (typPendingFloatingAdd),
// which only affects a NEW property, this works on any existing one, both ways.
//
// The property menu is no official extension point: on desktop it builds a
// NATIVE Electron menu from an internal Menu and shows it within
// showPropertyMenu() in one synchronous call - no workspace event, no DOM
// popup to amend afterwards. So the private row class is patched, as narrowly
// as possible: for our rows, right before Obsidian shows its finished menu,
// one addItem() is slipped in through a patch on Menu.prototype.showAtMouseEvent
// that resets itself after this one call (safe, JS is single-threaded). The
// rest of the native menu stays untouched.
let undoPropertyMenuPatch = null;

function ensurePropertyMenuPatch(app, editor) {
  const RowClass = getPropertyRowClass(app, editor);
  if (!RowClass || RowClass._typSystemMenuPatched) return;
  RowClass._typSystemMenuPatched = true;

  const originalShowPropertyMenu = RowClass.prototype.showPropertyMenu;
  undoPropertyMenuPatch = () => {
    RowClass.prototype.showPropertyMenu = originalShowPropertyMenu;
    delete RowClass._typSystemMenuPatched;
  };
  RowClass.prototype.showPropertyMenu = function (event) {
    const owner = this.metadataEditor?.owner;
    if (!owner?.typStore) return originalShowPropertyMenu.call(this, event);

    const row = this;
    const originalShowAtMouseEvent = Menu.prototype.showAtMouseEvent;
    Menu.prototype.showAtMouseEvent = function (mouseEvent) {
      Menu.prototype.showAtMouseEvent = originalShowAtMouseEvent;
      const isFloating = owner.typStore.getFloating().includes(row.entry.key);
      // "title" is the first section showPropertyMenu registers and is empty
      // on desktop, so this lands reliably on top. "pin-off" = not pinned =
      // floating.
      this.addItem((item) =>
        item
          .setTitle("Floating")
          .setIcon("pin-off")
          .setChecked(isFloating)
          .setSection("title")
          .onClick(() => toggleFloatingProperty(owner.typPane, owner.typStore, row.entry.key))
      );
      return originalShowAtMouseEvent.call(this, mouseEvent);
    };

    return originalShowPropertyMenu.call(this, event);
  };
}

// On unload; otherwise the patch would outlive a hot reload with the old
// module's closures.
function removePropertyMenuPatch() {
  undoPropertyMenuPatch?.();
  undoPropertyMenuPatch = null;
}

function toggleFloatingProperty(view, store, key) {
  const floating = store.getFloating();
  store.setFloating(floating.includes(key) ? floating.filter((k) => k !== key) : [...floating, key]);
  view.plugin.saveSettings();
  // Updates the bold/italic marks at once, here (refreshFrontmatterHighlight
  // covers the TYP-Pane's own editors) and in open notes - without
  // re-rendering this TYP-Pane, see refreshTypColorsExcept in main.js.
  view.plugin.refreshTypColorsExcept?.(view);
}

// Keyboard navigation beyond one editor instance (see frontmatter-blocks.js):
// Obsidian moves focus only within its own row list, and at either end onto
// the editor's heading or "Add property" button - both hidden here by CSS, so
// the chain stopped at the block edge.
//
// owner.shiftFocusBefore/After are only reached through exactly those hidden
// elements, so instead a capture-phase handler runs BEFORE the row's own. It
// only acts while the row ITSELF has focus (event.target is the row's
// container) - the same condition under which Obsidian allows j/k, so never
// while typing in a field.
function registerFocusChain(editor, onShiftFocus) {
  editor.containerEl.addEventListener(
    "keydown",
    (event) => {
      if (event.isComposing || event.defaultPrevented) return;
      // Multi-selection: Obsidian extends the selection instead of moving.
      if (editor.selectedLines?.size > 1) return;
      if (event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) return;

      const index = editor.rendered.findIndex((row) => row.containerEl === event.target);
      if (index === -1) return;

      const up = event.key === "ArrowUp" || event.key === "k" || (event.key === "Tab" && event.shiftKey);
      const down = event.key === "ArrowDown" || event.key === "j" || (event.key === "Tab" && !event.shiftKey);
      let step = 0;
      if (up && index === 0) step = -1;
      else if (down && index === editor.rendered.length - 1) step = 1;
      if (step === 0 || !onShiftFocus(step)) return;

      event.preventDefault();
      event.stopPropagation();
    },
    true
  );
}

// The widget takes an "owner" as second constructor argument - the only thing
// binding it to a file. Here it is bound to a plain object in the settings:
// saveFrontmatter(obj) gets the full property set on every change.
// shiftFocusBefore/After may be no-ops. getFile() is called by every row while
// rendering (for sourcePath); there is no real file, but the method must exist
// or the widget crashes.
//
// One editor per block (TYP or Subtyp), bound to `store`. Standard and
// floating properties share one list and order; getTypDefaults() just leaves
// the floating ones out. editor.typPendingFloatingAdd, set before
// addBlankProperty(), marks the next added (or renamed) property as floating -
// see saveFrontmatter.
function mountFrontmatterEditor(view, containerEl, store, { onShiftFocus } = {}) {
  const app = view.app;
  const EditorClass = getMetadataEditorClass(app);
  if (!EditorClass) {
    containerEl.createEl("p", {
      cls: "typ-frontmatter-unavailable",
      text: "Open a note once to initialize the editor.",
    });
    return null;
  }

  const owner = {
    app,
    // Lets ensurePropertyMenuPatch() recognize rows of this editor and gives
    // the global menu patch the store and view per row (the patch itself is
    // installed only once).
    typStore: store,
    typPane: view,
    getFile() {
      return null;
    },
    // Only for Obsidian's hover preview of internal links in a value; any
    // string will do.
    getHoverSource() {
      return "typ-frontmatter";
    },
    shiftFocusBefore() {},
    shiftFocusAfter() {},
    // Called once per completed change (a rename only on blur of the key
    // input), so each call adds and/or removes at most one non-empty property,
    // except a multi-delete. That keeps the floating flag easy to track
    // without following intermediate typing states.
    saveFrontmatter(frontmatter) {
      // A row just named "TYP"/"SUBTYP" isn't saved. It stays visible until
      // the next mount (no synchronize() here, see stripTypProperty).
      stripTypProperty(frontmatter);

      const previous = store.getFrontmatter();
      const previousKeys = Object.keys(previous).filter((key) => key !== "");
      const currentKeys = Object.keys(frontmatter).filter((key) => key !== "");
      const removedKeys = previousKeys.filter((key) => !currentKeys.includes(key));
      const addedKeys = currentKeys.filter((key) => !previousKeys.includes(key));
      // Deleting rows loses value, shortcut and floating flag at once - the
      // one change here that gets an undo (see undo.js). Snapshot before any
      // store write, and only for a deletion - no full copy on every edit.
      const removedOnly = removedKeys.length > 0 && addedKeys.length === 0;
      const undoSnapshot = removedOnly ? snapshotSettings(view.plugin) : null;

      let floating = store.getFloating();
      if (removedKeys.length === 1 && addedKeys.length === 1) {
        // A rename: the floating flag moves along.
        floating = floating.map((key) => (key === removedKeys[0] ? addedKeys[0] : key));
      } else {
        if (removedKeys.length > 0) floating = floating.filter((key) => !removedKeys.includes(key));
        if (editor.typPendingFloatingAdd && addedKeys.length === 1) {
          floating = [...floating, addedKeys[0]];
          editor.typPendingFloatingAdd = false;
        }
      }
      // Shortcuts belong to the key too: they move on rename and go on delete.
      const shortcuts = { ...store.getShortcuts() };
      if (removedKeys.length === 1 && addedKeys.length === 1) {
        if (shortcuts[removedKeys[0]]) {
          shortcuts[addedKeys[0]] = shortcuts[removedKeys[0]];
          delete shortcuts[removedKeys[0]];
        }
      } else {
        for (const key of removedKeys) delete shortcuts[key];
      }

      store.setFrontmatter(frontmatter);
      store.setFloating(floating);
      store.setShortcuts(shortcuts);
      view.plugin.saveSettings();
      if (undoSnapshot) {
        const blockName = store.subtyp ?? store.typ;
        offerUndo(
          view.plugin,
          removedKeys.length === 1
            ? `Property "${removedKeys[0]}" removed from ${blockName}.`
            : `${removedKeys.length} properties removed from ${blockName}.`,
          undoSnapshot
        );
      }
      // A newly named row gets its button, a deleted one takes it along.
      renderShortcutControls(view, editor, store);
      // Bold/italic marks in open notes follow the changed list at once. Not
      // the full refreshTypColors(): it would re-render this TYP-Pane, and
      // the edit that called saveFrontmatter would lose its focus (Tab to the
      // next row went nowhere) - the editor already shows the change.
      view.plugin.refreshTypColorsExcept?.(view);
    },
  };

  const editor = new EditorClass(app, owner);
  editor.typPendingFloatingAdd = false;
  if (onShiftFocus) registerFocusChain(editor, onShiftFocus);
  editor.containerEl.addClass(EDITOR_CLASS);
  containerEl.appendChild(editor.containerEl);
  view.addChild(editor);

  editor.synchronize(store.getFrontmatter());
  renderShortcutControls(view, editor, store);
  // Only after the first synchronize() (see getPropertyRowClass). A no-op for
  // a still empty TYP; the next non-empty one (or an open note) supplies the
  // class.
  ensurePropertyMenuPatch(app, editor);
  return editor;
}

const CHIP_CLASS = "typ-shortcut-chip";
const CHIP_TEXT_CLASS = "typ-shortcut-chip-text";
const BUTTON_CLASS = "typ-shortcut-button";
const ROW_CLASS = "typ-has-shortcut";
const WARNING_CLASS = "typ-shortcut-blocked";
const MISSING_CLASS = "typ-shortcut-missing";

// The button's three looks. "missing": a "tp." shortcut whose Templater
// script is gone (deleted, renamed, marker removed) - TYP.js would write the
// fallback value. Same triangle as Obsidian's type warning, and a click
// removes the shortcut like the "x" (the chip still changes it).
const BUTTON_STATES = {
  none: { icon: "square-function", label: "Set shortcut" },
  set: { icon: "x", label: "Remove shortcut" },
  missing: { icon: "alert-triangle", label: "Script not found – the fallback value will be used. Click to remove the shortcut." },
};

// Button and chip per property row. Both hang on the row's containerEl, NOT its
// valueEl: renderProperty() only ever empties valueEl, so anything attached to
// containerEl survives every type or value change without touching
// Obsidian's render pipeline.
//
// The button toggles: without a shortcut it opens the picker ("square-function"),
// with one it removes it ("x", or the warning triangle if the script is
// missing - see BUTTON_STATES). The chip itself is for CHANGING it. CSS shows
// the button only on row hover/focus (and permanently while a shortcut is
// set) - otherwise every row would carry a control most never need.
//
// Called again whenever the script list changes (see refreshShortcutControls
// in typ-pane.js), so the warning follows a script being renamed or restored.
//
// Hiding the value field while a shortcut is set is pure CSS (ROW_CLASS in
// styles.css); the native widget keeps rendering underneath. Setting and
// removing is just a class toggle, no renderProperty()/synchronize() - which
// would be risky here anyway (see stripTypProperty).
function renderShortcutControls(view, editor, store) {
  const shortcuts = store.getShortcuts();
  // Before the script folder was read once, nothing counts as missing -
  // otherwise every "tp." shortcut would flash the warning on startup.
  const getScripts = view.plugin.getShortcutScripts;
  const scriptNames = getScripts?.isLoaded?.() ? new Set(getScripts().map((script) => script.name)) : null;
  for (const row of editor.rendered ?? []) {
    const containerEl = row.containerEl;
    const key = row.entry?.key ?? "";
    // An unnamed row can't carry a shortcut - there is no key to store it
    // under. The button appears once it has a name (every change passes
    // through saveFrontmatter and so through here).
    const record = key === "" ? null : shortcuts[key] ?? null;
    containerEl.toggleClass(ROW_CLASS, !!record);

    // Obsidian's warning triangle sits absolutely at the row's right edge -
    // exactly where the shortcut button goes. If the row shows a type warning
    // and has NO shortcut, the button gives way. With a shortcut set, the
    // button stays (it is the only way to remove the shortcut) and the
    // triangle gives way instead (styles.css): it would then refer to the
    // hidden fallback value, which can't be fixed there anyway.
    const mismatch = !!row.typeInfo && row.typeInfo.expected !== row.typeInfo.inferred;
    containerEl.toggleClass(WARNING_CLASS, mismatch && !record);

    let buttonEl = containerEl.querySelector(`:scope > .${BUTTON_CLASS}`);
    if (key === "") {
      buttonEl?.remove();
      containerEl.querySelector(`:scope > .${CHIP_CLASS}`)?.remove();
      continue;
    }
    if (!buttonEl) {
      // Icon and label follow below, per state.
      buttonEl = containerEl.createDiv({ cls: `clickable-icon ${BUTTON_CLASS}` });
      // Read the key on click, not here: a rename changes row.entry.key
      // without recreating the row.
      buttonEl.addEventListener("click", () => {
        if (store.getShortcuts()[row.entry?.key ?? ""]) removeShortcut(view, editor, store, row);
        else openShortcutPicker(view, editor, store, row);
      });
    }
    const scriptName = record ? scriptNameOf(record.name) : null;
    const missing = scriptName !== null && scriptNames !== null && !scriptNames.has(scriptName);
    const state = !record ? "none" : missing ? "missing" : "set";
    // Only on a change: setIcon would replace the SVG on every call.
    if (buttonEl.dataset.typState !== state) {
      buttonEl.dataset.typState = state;
      setIcon(buttonEl, BUTTON_STATES[state].icon);
      buttonEl.setAttr("aria-label", BUTTON_STATES[state].label);
      buttonEl.toggleClass(MISSING_CLASS, state === "missing");
    }

    let chipEl = containerEl.querySelector(`:scope > .${CHIP_CLASS}`);
    if (!record) {
      chipEl?.remove();
      continue;
    }
    if (!chipEl) {
      chipEl = createEl("code", { cls: CHIP_CLASS });
      // Text in its own span: the chip is a flex container (vertical
      // centering like the real value field), and text-overflow: ellipsis
      // only works on a block element.
      chipEl.createSpan({ cls: CHIP_TEXT_CLASS });
      chipEl.setAttr("aria-label", "Change shortcut");
      chipEl.addEventListener("click", () => openShortcutPicker(view, editor, store, row));
      // Before the button, so the row always reads "name | chip | button".
      containerEl.insertBefore(chipEl, buttonEl);
    }
    chipEl.firstElementChild.setText(shortcutLabel(record));
  }
}

async function openShortcutPicker(view, editor, store, row) {
  const key = row.entry?.key ?? "";
  if (key === "") return;
  // Passing the current record prefills the argument dialog when the same
  // script is picked again - that is how single arguments get corrected.
  const record = await pickShortcut(view.app, key, view.plugin.getShortcutScripts, store.getShortcuts()[key] ?? null);
  if (!record) return;
  // The property may have vanished while the dialog was open (view rebuilt).
  // Without this check the shortcut would be an invisible orphan in the
  // settings that nothing ever cleans up.
  if (!Object.hasOwn(store.getFrontmatter(), key)) return;
  store.setShortcuts({ ...store.getShortcuts(), [key]: record });
  saveShortcuts(view, editor, store);
}

function removeShortcut(view, editor, store, row) {
  const key = row.entry?.key ?? "";
  const shortcuts = { ...store.getShortcuts() };
  if (!(key in shortcuts)) return;
  const snapshot = snapshotSettings(view.plugin);
  delete shortcuts[key];
  store.setShortcuts(shortcuts);
  saveShortcuts(view, editor, store);
  offerUndo(view.plugin, `Shortcut removed from "${key}".`, snapshot);
}

function saveShortcuts(view, editor, store) {
  view.plugin.saveSettings();
  renderShortcutControls(view, editor, store);
}

// A simple "add property" instead of the internal editor.addProperty(): adds
// an empty key with value null and lets the widget render it normally (same
// look as in a note, since synchronize() runs Obsidian's own pipeline), then
// focuses the new key field.
function addBlankProperty(editor) {
  if (!editor) return;
  const current = editor.serialize();
  if (!current.hasOwnProperty("")) {
    current[""] = null;
    editor.synchronize(current);
    // Existing rows keep their button (it sits on containerEl), the new one
    // needs one.
    renderShortcutControls(editor.owner.typPane, editor, editor.owner.typStore);
  }
  editor.focusKey("");
  // Covers the case where mountFrontmatterEditor() found no row class to patch
  // (empty TYP, no open note) - now there is at least one row.
  ensurePropertyMenuPatch(editor.owner.app, editor);
}

module.exports = {
  mountFrontmatterEditor,
  addBlankProperty,
  renderShortcutControls,
  ensurePropertyMenuPatch,
  removePropertyMenuPatch,
  typStore,
  subtypStore,
};
