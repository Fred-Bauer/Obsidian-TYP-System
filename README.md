# TYP-System

TYP system for this vault: a **TYP-Pane** docked on the left (command "Open TYP-Pane"; on the very first start it opens there by itself, once), a native **TYP-Picker**, TYP-Frontmatter per TYP, frontmatter sorting, **Bases** generated from a TYP, and coloring of note names by their `TYP` property across many views. Split off from the **Fred** plugin.

Every note has at most one `TYP` and one `SUBTYP`, each a single clean value. TYP names are uppercase, Subtyp names title case per word ("Kurz Geschichte").

## TYP-List

- Lists every registered TYP with color dot and note count. Sort button in the header: manual (drag & drop), by count, by name or by color
- A second header button cycles what stands next to the name: the **Subtyp list** `(Subtyp 1, Subtyp 2)` in their colors (default), the **description** as an editable field, or **nothing**
  - Style Setting *Right-align Subtyp list* (Style Settings → TYP-System): the lists end right before the counts. The plugin triggers `parse-style-settings` on load so the section shows up reliably
- **Registered TYP:** click opens the detail view, right-click searches `["TYP":"…"]`
- Below a separator:
  - **Unregistered values** found in notes, muted. Click registers them: trimmed, uppercased, and the notes are rewritten. Padded values show in quotes (`" BUCH"`), lists in brackets (`[PERSON, BUCH]` → registered as `PERSON, BUCH`, then mergeable by renaming)
  - **Unregistered Subtyp:** every Subtyp value of the vault that isn't registered, as `TYP / Subtyp`, sorted by count. A registered TYP part keeps its color, toned down by the Style Setting *Color in unregistered Subtyp rows*. Click registers the Subtyp (and its TYP if needed), right-click searches. A SUBTYP without a TYP is ignored
  - **`[NO TYP]`:** notes without a TYP; click searches
- "+" in the header adds a TYP, named inline
- Counts stay current: the list follows the TYP index and Obsidian's "Excluded files" list

## TYP-Pane detail

- Header: name (click searches), count, **Rename and update notes** (accent color, rewrites every affected note after confirmation), **Rename** (settings only), **Manually creatable** toggle, **Delete** (with confirmation unless switched off, then undoable – see [Undo](#undo))
- **Confirmations** (delete, rename and update notes, merge – for TYPs and Subtyps alike) are Obsidian's own confirmation dialogs (`ConfirmationModal`, Obsidian 1.13+): [Cancel] [Action], a bottom sheet on phones. As in Obsidian's own "Merge property …?" dialog, the question is the title ("Delete TERMIN?", "Rename TERMIN to TERMINE?", "Merge Arzt into Praxis?"), with TYP and Subtyp names colored like in the TYP-List (or with a color dot when "TYP-Pane" coloring is off); the text below only adds what the title doesn't say (how many notes are updated, which properties are lost, what a merge does) and is left out otherwise. With a keyboard, the rename dialogs focus the action button (Enter confirms), delete and merge dialogs focus **Cancel**. Escape or a click outside cancels. The delete dialogs also offer **Don't ask again** on desktop (see [Undo](#undo))
- **Merge:** renaming onto an existing TYP offers to merge. Notes move to the target; color, description and TYP-Frontmatter of the source are dropped; every Subtyp moves along, same-named blocks are combined (the target wins per key). If the target isn't manually creatable, every moved Subtyp is switched off too
- **Manually creatable** (on by default) decides whether a TYP appears in the TYP-Picker. Switching a TYP off or on does the same for every Subtyp of it; switching one Subtyp on also switches its TYP on. A Subtyp is never creatable without its TYP
- Options row: color (native picker, reset) and the description
- **TYP-Frontmatter:** Obsidian's own property widget. Properties every new note of this TYP gets, empty or with a fixed value. Command **"Add TYP-Frontmatter property"** adds one (in the open detail view, else for the active note's TYP)
- **Floating properties:** italic rows within the same list (accent "+" button or right-click → *Floating*). They count for sorting but aren't created for new notes; Templater only gets them with `includeFloating: true`
- **Subtyp blocks:** one block per Subtyp below the TYP-Frontmatter, same features. A Subtyp block adds to the TYP-Frontmatter for notes with that SUBTYP. A key may appear in several blocks; with the TYP-Frontmatter, the Subtyp overrides value, floating flag and shortcut, the row keeps the TYP-Frontmatter position. Rows can be dragged between blocks (an existing name merges), blocks can be reordered by dragging
  - **Add Subtyp** creates a block, named inline
  - Footer: **Subtyp color** (dot with sliders *Hue* and *Lightness*, stored as an offset from the TYP color in OKLCH, so every Subtyp follows its TYP; limits under Settings → *Subtyp colors*), plus the same actions as the TYP header. Deleting only asks if properties would be lost (and only while *Confirm deletion* is on), and can be undone either way (see [Undo](#undo)); notes keep their SUBTYP
  - Every **unregistered Subtyp** of this TYP appears as an empty block: click registers, click on the name searches
- Clickable names (title, block headings) search their notes and light up in accent color on hover

### Shortcuts

Instead of a fixed value, a property can get a value computed when a note is created. Set via the button at the end of a property row:

- `today` (YYYY-MM-DD), `now` (YYYY-MM-DD HH:mm), `created` (the file's creation date)
- `tp.<script>` – runs Templater script `tp.user.<script>` and uses its return value. Offered are scripts in Templater's script folder whose comment starts with the marker `@typ-shortcut`; the text after it is the description

**Parameters:** parentheses after the marker declare the script's full argument list after `tp`:

| Marker | Call |
|---|---|
| `@typ-shortcut` | `f(tp, newFile, ctx)` |
| `@typ-shortcut(folder, year)` | `f(tp, "Literatur", 2024)` |
| `@typ-shortcut(newFile, year)` | `f(tp, newFile, 2024)` |
| `@typ-shortcut(key, opt.typ, opt.tags)` | `f(tp, "Familie", { typ: …, tags: … })` |
| `@typ-shortcut()` | `f(tp)` |

`newFile`, `ctx` and `key` (the property the shortcut sits on) are filled in; every other name becomes an input field, typed on entry (`5` → number, `true`/`false`, `null`, otherwise text; empty = not set). Dotted names collect into one object argument (one level).

The shortcut is stored **next to** the value (`typShortcuts`, or `shortcuts` in a Subtyp block), never in it, so typed property widgets keep working. The fixed value stays as **fallback** when the script is missing or throws. For list properties, a fixed shortcut's value is wrapped in an array.

### Undo

These actions change only plugin settings and show a notice with an **Undo** button for 8 seconds afterwards:

- **Delete a TYP** – notes keep their TYP, which then shows as unregistered
- **Delete a Subtyp** – notes keep their SUBTYP
- **Delete properties** from the TYP-Frontmatter or a Subtyp block (value, shortcut and floating flag go with them): *Property "key" removed from TERMIN.*
- **Remove a shortcut**
- **Change a color** – a TYP color with the native picker (one undo per picker session, offered once the color is confirmed), a Subtyp color with the sliders (offered when the popover closes, only if the color changed)
- **Reset a color** – of a TYP (detail header) or of a Subtyp (block footer)

Not undoable on purpose: toggling *Floating* (just toggle it back), renaming in the settings only, removing an entry from the global property order.

**Confirm deletion** (Settings, on by default): deleting a TYP, or a Subtyp with properties, asks first. As these deletions can be undone, the question can be switched off – with the setting or with **Don't ask again** in the dialog (desktop only, as in Obsidian's "Delete file"). Without it, the deletion happens at once and only the undo notice follows. Everything that rewrites notes or files (rename and update notes, merges) always asks.

Undo restores the plugin settings as they were right before the action, saves them and refreshes every view (the TYP-Pane is rebuilt). Notes are never touched. Only the **last** action can be undone, there is no history and no command. Any later change of the settings – another action, any edit in the TYP-Pane or the settings tab, or `data.json` arriving through Sync – voids it: Undo then only says *"Can't undo – the settings have changed since."* instead of silently reverting that change too.

## TYP-Picker

Native replacement for `tp.system.suggester` (built on `FuzzySuggestModal`): color, description and count per row. A TYP or Subtyp that isn't manually creatable is hidden unless requested.

- Default: each Subtyp indented below its TYP; search works per group
- Setting **"Separate Subtyp-Picker"**: TYP-Picker first (with the Subtyp list in each row), then a Subtyp-Picker with "TYP (no Subtyp)" first. ESC goes back. The Subtyp-Picker is pre-sorted by what was typed before ("Lehr" → ORGA → *Lehrveranstaltung* on top)

## Bases

Written only through Obsidian's Bases API and serialization, never self-parsed YAML. Both commands need the **Bases core plugin**: while it is off they don't appear in the command palette (a `.base` file couldn't be opened anyway).

- **"Create Base for TYP"**: pick a TYP or Subtyp, choose options (*Floating properties*, *All Subtyp properties*, *tags*, with a live column preview). Creates `<name>.base` in the vault root: root filter `TYP == "…"`, a main view grouped by SUBTYP and one view per registered Subtyp. A Subtyp target filters by SUBTYP only (grouped by TYP if several TYP entries share the name). An existing file only gets the missing views
- **"Update columns of Base view"** (only with a Base open): reads the TYP from the filter (AND only), otherwise asks and stores it as a filter. Adds and reorders silently; columns that don't belong are offered for removal. Only the column list is touched
- Column order: `file.name`, then the global property order; `TYP`/`SUBTYP` are never columns
- "Update columns" looks for the Base in the most recently active tab of the main area (or a pop-out window), so it also works while a sidebar (the TYP-Pane, say) has focus. New views are appended to an existing file with `vault.process`

## Frontmatter sorting

Puts the properties a note has into a fixed order; never adds or changes values.

- **Global property order** (settings, drag & drop): pinned properties plus the placeholders TYP, SUBTYP, TYP-Frontmatter (the TYP's list followed by its Subtyp block) and Other properties. A pinned property always wins over its place in a TYP list
- Commands **"Sort frontmatter in all notes"**, **"Sort frontmatter for one TYP"**, **"Sort frontmatter of active note"**; the play button next to the order runs the first. Each run reports a notice; already sorted notes are skipped via the metadata cache
- **Renaming a property** in "All properties" or Bases is carried into every TYP-Frontmatter, floating flags, shortcuts and the global order (case-insensitive; an existing name merges)
- Optional: TYP-Frontmatter property names in bold in notes, floating ones in italics

## Excluded files

TYP counts, pickers and sorting skip Obsidian's "Excluded files" (Hide Folders writes there too) unless **"Include excluded files"** is on.

## Coloring

TYP colors apply to: file explorer (folder notes included), graph (color groups take precedence), search, Recent Files, backlinks (pane and embedded), bookmarks, the TYP-Pane itself, links in notes (reading view, Live Preview, hover), All Properties (one TYP → its color, several → bold, floating everywhere → italic), and the note title (text color; marker as dot or badge with label [TYP], [TYP/Subtyp] or [Subtyp]). Each view has its own toggle plus a **Subtyp** sub-toggle for the Subtyp color.

Own tag/attachment colors in the graph are disabled since 2026-09-30 (`src/graph-colors.js`): the Minimal theme's Style Settings cover them.

## Templater integration

The plugin has no Templater logic of its own but offers an API on `app.plugins.plugins["typ-system"]`, used by `_obsidian/templater-scripts/TYP.js`:

- `getTyps({ includeManualOff })` → `[{ typ, description, count }]` in TYP-List order
- `getTypDefaults(typ, { includeFloating, file, subtyp })` – resolved TYP-Frontmatter (plus the Subtyp block). Fixed shortcuts are resolved, script shortcuts are `null`. Pass `file` for `created`
- `getTypShortcuts(typ, { includeFloating, subtyp })` → `{ [property]: { name, params, args, fallback } }` for script shortcuts, in TYP-Frontmatter order
- `resolveShortcutArgs(params, args, { newFile, ctx, key })` – the arguments for `tp.user.<name>(tp, ...)`
- `pickTyp({ includeManualOff, includeUnregistered, showSubtyps })` → TYP or `null`
- `getSubtyps(typ, { includeManualOff })` → `[{ subtyp, count }]`
- `pickSubtyp(typ, query, { includeManualOff })` → Subtyp, `""` for "no Subtyp", or `null` on ESC
- `pickTypAndSubtyp({ includeManualOff, includeUnregistered })` → `{ typ, subtyp }` or `null`
- Inside `processFrontMatter`: `applyTypProperties(frontmatter, typ, subtyp)` (canonical spelling, removes SUBTYP if none), `sortFrontmatter(frontmatter, typ, subtyp)`, `placeProperty(frontmatter, key)` (used by Fred's property backlinking)

### Script shortcut convention (TYP.js)

- `ctx = { typ, subtyp, key, values, after, args }`: `values` are the defaults resolved so far (scripts run in order), `args` the typed arguments
- `after(fn)` queues an action that runs after the frontmatter is written, in order - for side effects like renaming the file (`quelleEditName`)
- A single return value becomes the property's value; a plain object can also fill other empty properties of the TYP
- A script isn't run if the property already has a value; a missing or failing script shows a notice and the fallback is used

## Technical notes

- `src/` is the source, `main.js` the esbuild bundle (`npm run dev` watches, `npm run build` builds once)
- In the code TYP and Subtyp are fixed terms too (`typ`, `subtyp`, plural `typs`/`subtyps`)
- **TYP index** (`src/typ-index.js`): holds TYP and SUBTYP of every note (property names case-insensitive) and fires its own `change` event only on real TYP/SUBTYP changes; all coloring hangs on it, so typing triggers no recoloring. Caches the counts
- **Frontmatter blocks** (`src/frontmatter-blocks.js`): one Obsidian property editor per block - the only way to allow the same key in several blocks. Keyboard navigation across blocks and dragging rows between blocks are added on top of Obsidian's own behavior
- **Shortcuts** (`src/shortcuts.js`, `shortcut-scripts.js`, `shortcut-picker.js`): button and chip hang on the row's `containerEl`, which `renderProperty()` never empties, so no hook into Obsidian's rendering is needed
- Graph coloring patches `renderer.setData` (like graph-nested-tags); property rename sync wraps `app.fileManager.renameProperty`; the *Floating* menu entry patches `showPropertyMenu` of Obsidian's private property row class. All three are undone on unload
- **Disabling the plugin cleans up at once**, without waiting for each view to re-render:
  - Inline colors in the file explorer, search, Recent Files, backlinks, bookmarks, the note title and "All properties" are set through `setInlineColor` (`src/typ-colors.js`), which marks each element with `data-typ-colored`. On unload exactly the marked elements lose their color, in every window; inline colors from themes or other plugins stay
  - Note title and property block lose dot, badge, their `data-typ` attribute and color variables; property names lose the bold/italic classes (`typ-default-property`, `typ-floating-property`)
  - Open graphs are re-rendered once with the original `setData`, so the TYP colors disappear immediately
  - Link colors: the editor extension goes away with the plugin; the `--link-color` variables on rendered links are removed
- **Link colors in Live Preview** are refreshed through a CodeMirror effect, dispatched at most once per animation frame and never synchronously: a refresh can arrive while an editor is in the middle of its own update, which CodeMirror refuses ("Calls to EditorView.update are not allowed while an update is in progress"). An editor still busy is retried a frame later
- Settings start from a deep copy (`structuredClone`) of the defaults, so a fresh install without `data.json` never changes the defaults themselves
- **Confirmation dialog** (`src/confirm-modal.js`): one `ConfirmModal` on top of Obsidian's public `ConfirmationModal` (since 1.13.0) for every confirmation; title and body take text and nodes, so names can be colored. Both callbacks run once the dialog has closed; the `dontAskAgain` option adds Obsidian's checkbox (`addCheckbox`, desktop only) and hands its state to `onConfirm`
- **Undo** (`src/undo.js`): a `structuredClone` of the settings before the action, restored in place (the `plugin.settings` object stays the same). `saveSettings()` and `onExternalSettingsChange()` bump `plugin.settingsRevision`; an undo whose recorded revision no longer matches is refused
- The TYP-Pane (view type `typ-system-pane`) reconnects itself after hot reload
- **First start:** when the plugin is loaded without a `data.json` (`loadData()` resolves `null`, i.e. it has never saved settings in this vault), the TYP-Pane is created in the left sidebar and revealed. This happens once: afterwards a closed pane stays closed and only "Open TYP-Pane" brings it back. "Already created" is a marker in this device's `localStorage` for the vault (`app.saveLocalStorage("typ-system-pane-created")`), so a hot reload before the first save doesn't open the pane again. `data.json` is deliberately not written for this: with Obsidian Sync, a `data.json` full of defaults written on a second device before the real one arrives could replace the real settings. On another device (or after clearing the app's local data) the pane may therefore open once more if `data.json` hasn't arrived yet
- The global property order uses its own plain list instead of Obsidian's widget: re-running `synchronize()` from `saveFrontmatter` can cause a stack overflow
