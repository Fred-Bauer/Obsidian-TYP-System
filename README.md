# TYP-System

TYP system for this vault: a **TYP-Pane** docked on the left (command "Open TYP-Pane"), a native **TYP-Picker**, TYP-Frontmatter per TYP, frontmatter sorting, **Bases** generated from a TYP, and coloring of note names by their `TYP` property across many views. Split off from the **Fred** plugin.

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

- Header: name (click searches), count, **Rename and update notes** (accent color, rewrites every affected note after confirmation), **Rename** (settings only), **Manually creatable** toggle, **Delete** (with confirmation)
- **Confirmations** (delete, rename and update notes, merge – for TYPs and Subtyps alike) are Obsidian's own confirmation dialogs (`ConfirmationModal`, Obsidian 1.13+): [Cancel] [Action], a bottom sheet on phones. As in Obsidian's own "Merge property …?" dialog, the question is the title ("Delete TERMIN?", "Rename TERMIN to TERMINE?", "Merge Arzt into Praxis?"), with TYP and Subtyp names colored like in the TYP-List (or with a color dot when "TYP-Pane" coloring is off); the text below only adds what the title doesn't say (how many notes are updated, which properties are lost, what a merge does) and is left out otherwise. With a keyboard, the rename dialogs focus the action button (Enter confirms), delete and merge dialogs focus **Cancel**. Escape or a click outside cancels
- **Merge:** renaming onto an existing TYP offers to merge. Notes move to the target; color, description and TYP-Frontmatter of the source are dropped; every Subtyp moves along, same-named blocks are combined (the target wins per key). If the target isn't manually creatable, every moved Subtyp is switched off too
- **Manually creatable** (on by default) decides whether a TYP appears in the TYP-Picker. Switching a TYP off or on does the same for every Subtyp of it; switching one Subtyp on also switches its TYP on. A Subtyp is never creatable without its TYP
- Options row: color (native picker, reset) and the description
- **TYP-Frontmatter:** Obsidian's own property widget. Properties every new note of this TYP gets, empty or with a fixed value. Command **"Add TYP-Frontmatter property"** adds one (in the open detail view, else for the active note's TYP)
- **Floating properties:** italic rows within the same list (accent "+" button or right-click → *Floating*). They count for sorting but aren't created for new notes; Templater only gets them with `includeFloating: true`
- **Subtyp blocks:** one block per Subtyp below the TYP-Frontmatter, same features. A Subtyp block adds to the TYP-Frontmatter for notes with that SUBTYP. A key may appear in several blocks; with the TYP-Frontmatter, the Subtyp overrides value, floating flag and shortcut, the row keeps the TYP-Frontmatter position. Rows can be dragged between blocks (an existing name merges), blocks can be reordered by dragging
  - **Add Subtyp** creates a block, named inline
  - Footer: **Subtyp color** (dot with sliders *Hue* and *Lightness*, stored as an offset from the TYP color in OKLCH, so every Subtyp follows its TYP; limits under Settings → *Subtyp colors*), plus the same actions as the TYP header. Deleting only asks if properties would be lost; notes keep their SUBTYP
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

## TYP-Picker

Native replacement for `tp.system.suggester` (built on `FuzzySuggestModal`): color, description and count per row. A TYP or Subtyp that isn't manually creatable is hidden unless requested.

- Default: each Subtyp indented below its TYP; search works per group
- Setting **"Separate Subtyp-Picker"**: TYP-Picker first (with the Subtyp list in each row), then a Subtyp-Picker with "TYP (no Subtyp)" first. ESC goes back. The Subtyp-Picker is pre-sorted by what was typed before ("Lehr" → ORGA → *Lehrveranstaltung* on top)

## Bases

Written only through Obsidian's Bases API and serialization, never self-parsed YAML.

- **"Create Base for TYP"**: pick a TYP or Subtyp, choose options (*Floating properties*, *All Subtyp properties*, *tags*, with a live column preview). Creates `<name>.base` in the vault root: root filter `TYP == "…"`, a main view grouped by SUBTYP and one view per registered Subtyp. A Subtyp target filters by SUBTYP only (grouped by TYP if several TYP entries share the name). An existing file only gets the missing views
- **"Update columns of Base view"** (only with a Base open): reads the TYP from the filter (AND only), otherwise asks and stores it as a filter. Adds and reorders silently; columns that don't belong are offered for removal. Only the column list is touched
- Column order: `file.name`, then the global property order; `TYP`/`SUBTYP` are never columns

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
- **Confirmation dialog** (`src/confirm-modal.js`): one `ConfirmModal` on top of Obsidian's public `ConfirmationModal` (since 1.13.0) for every confirmation; title and body take text and nodes, so names can be colored. Both callbacks run once the dialog has closed
- The TYP-Pane (view type `typ-system-pane`) reconnects itself after hot reload
- The global property order uses its own plain list instead of Obsidian's widget: re-running `synchronize()` from `saveFrontmatter` can cause a stack overflow
