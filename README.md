# TYP-System

TYP system for this vault: a **TYP-Pane** docked on the left (command "Open TYP-Pane"; on the very first start it opens there by itself, once), a native **TYP-Picker**, TYP-Frontmatter per TYP, frontmatter sorting, **Bases** generated from a TYP, and coloring of note names by their `TYP` property across many views. Split off from the **Fred** plugin.

Requires Obsidian 1.13.0 or later (the confirmations use Obsidian's `ConfirmationModal`). Works on desktop and mobile; drag & drop works with mouse and touch (see *Drag & drop on touch* under [Technical notes](#technical-notes)).

Every note has at most one `TYP` and one `SUBTYP`, each a single clean value. TYP names are uppercase, Subtyp names title case per word ("Kurz Geschichte"). The property names `TYP` and `SUBTYP` are fixed – they can't be changed in the settings (other spellings such as `typ` are read as well and rewritten to the canonical one when the plugin sets the value).

## TYP-List

- Lists every registered TYP with color dot and note count. Sort button in the header: manual (drag & drop – with a mouse anywhere on the row; on touch long press, then drag), by count, by name or by color
- A second header button cycles what stands next to the name: the **Subtyp list** `(Subtyp 1, Subtyp 2)` in their colors (default), the **description** as an editable field, or **nothing**
  - Style Setting *Right-align Subtyp list* (Style Settings → TYP-System): the lists end right before the counts. The plugin triggers `parse-style-settings` on load so the section shows up reliably
- **Registered TYP:** click opens the detail view. Right-click (on touch: long press) opens a menu:
  - **Search notes** – searches `["TYP":"…"]`
  - **Rename** / **Rename and update notes** – the name in the row becomes editable, right in the list; otherwise exactly as in the detail view (confirmation before notes are rewritten, an existing name offers a merge). The list stays open, also after a merge
  - **Delete** – same confirmation and undo as in the detail view
  - **Create Base** – the column dialog of "Create Base for TYP", for this TYP without the picker. Only while the Bases core plugin is on
  - **Sort frontmatter for this TYP** – like the command, without the picker, with the same notice (and the same question before a large run, see Frontmatter sorting)
- Below a separator:
  - **Unregistered values** found in notes, muted. Click registers them: trimmed, uppercased, and the notes are rewritten. Padded values show in quotes (`" BUCH"`), lists in brackets (`[PERSON, BUCH]` → registered as `PERSON, BUCH`, then mergeable by renaming)
  - **Unregistered Subtyp:** every Subtyp value of the vault that isn't registered, as `TYP / Subtyp`, sorted by count. A registered TYP part keeps its color, toned down by the Style Setting *Color in unregistered Subtyp rows*. Click registers the Subtyp (and its TYP if needed), right-click (long press) searches. A SUBTYP without a TYP is ignored
  - **`[NO TYP]`:** notes without a TYP; click searches
- "+" in the header adds a TYP, named inline; an existing name (in any case) only shows a notice *TYP … already exists.*
- Counts stay current: the list follows the TYP index and Obsidian's "Excluded files" list

## TYP-Pane detail

- Header: name (click searches), count, **Rename and update notes** (accent color, rewrites every affected note after confirmation), **Rename** (settings only), **Manually creatable** toggle, **Delete** (with confirmation unless switched off, then undoable – see [Undo](#undo))
- **Confirmations** (delete, rename and update notes, merge – for TYPs and Subtyps alike) are Obsidian's own confirmation dialogs (`ConfirmationModal`, Obsidian 1.13+): [Cancel] [Action], a bottom sheet on phones. As in Obsidian's own "Merge property …?" dialog, the question is the title ("Delete TERMIN?", "Rename TERMIN to TERMINE?", "Merge Arzt into Praxis?"), with TYP and Subtyp names colored like in the TYP-List (or with a color dot when "TYP-Pane" coloring is off); the text below only adds what the title doesn't say (how many notes are updated, which properties are lost, what a merge does) and is left out otherwise. With a keyboard, the rename dialogs focus the action button (Enter confirms), delete and merge dialogs focus **Cancel**. Escape or a click outside cancels. The delete dialogs also offer **Don't ask again** on desktop (see [Undo](#undo))
- **Merge:** renaming onto an existing TYP offers to merge. Notes move to the target; color, description and TYP-Frontmatter of the source are dropped; every Subtyp moves along, same-named blocks are combined (the target wins per key – its value, floating flag and shortcut stay; only an empty target value is filled from the source, as when merging two Subtyps or dragging a row onto an existing name). If the target isn't manually creatable, every moved Subtyp is switched off too
- **Rewriting notes** (rename and update notes, merge, registering an unregistered value – for TYPs and Subtyps alike) changes only the line(s) of the `TYP` or `SUBTYP` property; comments and the rest of the frontmatter stay exactly as they were (see [Comments and formatting are kept](#comments-and-formatting-are-kept)). A differently spelled property name (`typ`, `Subtyp`) becomes `TYP`/`SUBTYP`. The closing notice counts the updated notes and, if any, the ones skipped because the change would have lost a comment, e.g. *"TYP TERMINE: 12 notes updated. 1 note skipped (frontmatter can't be updated without losing comments)."* A skipped note keeps its old value and so shows up under the unregistered values
- **Manually creatable** (on by default) decides whether a TYP appears in the TYP-Picker. Switching a TYP off or on does the same for every Subtyp of it; switching one Subtyp on also switches its TYP on. A Subtyp is never creatable without its TYP
- Options row: color (native picker, reset) and the description. While the native picker is open, the color previews live but `data.json` is only written once the pointer rests for a moment and when the picker closes, not for every intermediate color
- **TYP-Frontmatter:** Obsidian's own property widget. Properties every new note of this TYP gets, empty or with a fixed value. Command **"Add TYP-Frontmatter property"** adds one (in the open detail view, else for the active note's TYP)
- **Floating properties:** italic rows within the same list (accent "+" button or right-click → *Floating*). They count for sorting but aren't created for new notes; Templater only gets them with `includeFloating: true`
- **Subtyp blocks:** one block per Subtyp below the TYP-Frontmatter, same features. A Subtyp block adds to the TYP-Frontmatter for notes with that SUBTYP. A key may appear in several blocks; with the TYP-Frontmatter, the Subtyp overrides value, floating flag and shortcut, the row keeps the TYP-Frontmatter position. Rows can be dragged between blocks by their type icon, as within a block (an existing name merges: the existing row keeps its value, floating flag and shortcut, only an empty value is filled from the dragged one); blocks can be reordered by dragging their heading, footer or margin. On touch both start with a long press, then drag
  - **Add Subtyp** creates a block, named inline
  - Footer: **Subtyp color** (dot with sliders *Hue* and *Lightness*, stored as an offset from the TYP color in OKLCH, so every Subtyp follows its TYP; limits under Settings → *Subtyp colors*). Saved when the popover closes, and only if the color changed. While the TYP itself has no color there is nothing to offset from: the dot stays a hollow ring, the popover says *Set a color for TERMIN first.* and the sliders are locked. Next to it the same actions as the TYP header. Deleting only asks if properties would be lost (and only while *Confirm deletion* is on), and can be undone either way (see [Undo](#undo)); notes keep their SUBTYP
  - Every **unregistered Subtyp** of this TYP appears as an empty block: click registers, click on the name searches
- Clickable names (title, block headings) search their notes and light up in accent color on hover
- **Inline names** (new TYP or Subtyp, every rename in the list, the detail title or a block heading): Enter or leaving the field commits, Escape cancels. A field that disappears without the user leaving it (the pane closed, say) commits nothing
- **Typing is never interrupted:** while the focus is in a field of the pane – an inline name, a description (list or detail view), a property name or value, or a property row of the editor's keyboard navigation – the pane doesn't rebuild. Changes arriving meanwhile (an edited note, Sync, a refresh from the settings, Undo) are shown as soon as the focus leaves the pane's fields; moving from field to field (Tab) keeps waiting. The native color picker doesn't hold anything back. The pane's own actions (back, delete, moving a block …) take effect at once
- **No jumps:** editing a property keeps the focus where it is (Tab moves on to the next row), and every rebuild of the pane keeps the scroll position; only switching between list and detail view starts at the top

### Shortcuts

Instead of a fixed value, a property can get a value computed when a note is created. Set via the button at the end of a property row:

- `today` (YYYY-MM-DD), `now` (YYYY-MM-DD HH:mm), `created` (the file's creation date)
- `tp.<script>` – runs Templater script `tp.user.<script>` and uses its return value (when a note gets its TYP, see [Setting a note's TYP](#setting-a-notes-typ)). Offered are scripts in Templater's script folder whose comment starts with the marker `@typ-shortcut`; the text after it is the description

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

**In the property row** a shortcut shows as a chip in place of the value field:

- The button at the row's end shows **ƒ** (`square-function`, "Set shortcut") without a shortcut – only on hover/focus – and **×** ("Remove shortcut") while one is set. Removing can be undone (see Undo)
- Clicking the **chip** opens the picker to change the shortcut (picking the same script again prefills its arguments)
- **Script not found:** if the Templater script of a `tp.` shortcut no longer exists (deleted, renamed, marker removed), the × turns into the same orange warning triangle as Obsidian's type warning: *"Script not found – the fallback value will be used. Click to remove the shortcut."* A click removes the shortcut like the ×. The warning follows the script folder live – rename the script back and the × returns. It only appears once the folder has been read after startup, so nothing flashes. Without Templater (or without a script folder) every `tp.` shortcut shows it, which is accurate: only the fallback value would be written
- A row with Obsidian's type warning and **no** shortcut keeps the triangle and hides the button; with a shortcut set, the button wins (the triangle would refer to the hidden fallback value)

**Shortcut picker:** searches name and description (*"creation"* finds `created`), with the matched characters in bold; placeholder *Choose shortcut for "key"…* and the usual key hints (↑↓ to navigate, ↵ to choose, esc to cancel). A script with declared parameters then asks for its arguments (**Arguments for tp.…**, **Apply**; Enter applies, ESC keeps the current shortcut).

### Undo

These actions change only plugin settings and show a notice with an **Undo** button for 8 seconds afterwards:

- **Delete a TYP** (detail header or the list's context menu) – notes keep their TYP, which then shows as unregistered
- **Delete a Subtyp** – notes keep their SUBTYP
- **Delete properties** from the TYP-Frontmatter or a Subtyp block (value, shortcut and floating flag go with them): *Property "key" removed from TERMIN.*
- **Remove a shortcut**
- **Change a color** – a TYP color with the native picker (one undo per picker session, offered once the color is confirmed), a Subtyp color with the sliders (offered when the popover closes, only if the color changed)
- **Reset a color** – of a TYP (detail header) or of a Subtyp (block footer)

Not undoable on purpose: toggling *Floating* (just toggle it back), renaming in the settings only, removing an entry from the global property order.

**Confirm deletion** (Settings → General, on by default): deleting a TYP, or a Subtyp with properties, asks first. As these deletions can be undone, the question can be switched off – with the setting or with **Don't ask again** in the dialog (desktop only, as in Obsidian's "Delete file"). Without it, the deletion happens at once and only the undo notice follows. Everything that rewrites notes or files (rename and update notes, merges) always asks.

Undo restores the plugin settings as they were right before the action, saves them and refreshes every view (the TYP-Pane is rebuilt). Notes are never touched. Only the **last** action can be undone, there is no history and no command. Any later change of the settings – another action, any edit in the TYP-Pane or the settings tab, or `data.json` arriving through Sync – voids it: Undo then only says *"Can't undo – the settings have changed since."* instead of silently reverting that change too.

## TYP-Picker

Native replacement for `tp.system.suggester` (built on `FuzzySuggestModal`): color, description and count per row. A TYP or Subtyp that isn't manually creatable is hidden unless requested.

- Default (placeholder *Choose TYP or Subtyp…*): each Subtyp indented below its TYP; search works per group
- Setting **"Separate Subtyp-Picker"** (Settings → General): TYP-Picker first (*Choose TYP…*, with the Subtyp list in each row), then a Subtyp-Picker (*Choose Subtyp for ORGA…*) with "TYP (no Subtyp)" first. ESC goes back. The Subtyp-Picker is pre-sorted by what was typed before ("Lehr" → ORGA → *Lehrveranstaltung* on top)
- Key hints at the bottom like Obsidian's own pickers: ↑↓ to navigate, ↵ to choose, esc to cancel (in the Subtyp-Picker: esc to go back)
- **Matches are bold** wherever they are found: in the TYP name, in a Subtyp name of the row (each Subtyp separately), in the description, and in "(no Subtyp)". In names (TYP and Subtyp rows), which are semibold already, matches are also underlined in the name's own color. The search text of a TYP row is name, Subtyp names and description joined by spaces (`textParts` in `typ-picker.js` is the one definition); the match ranges are split back onto these parts for rendering

## Setting a note's TYP

Two commands give a note its TYP without any script of your own:

- **"Set TYP of active note"** (only with a Markdown note open): TYP-Picker (TYP or Subtyp, see above), then the note gets its TYP-Frontmatter. Notice *"TYP of "X" set to TERMIN / Arzt."*
- **"New note with TYP"**: TYP-Picker first, then a new note like Obsidian's "New note" – in the folder of *Settings → Files and links → Default location for new notes*, named *Untitled* (*Untitled 1*, … if taken; in Obsidian's language), opened in a new tab with the title selected for renaming. ESC in the picker creates nothing. The note is created with `TYP`/`SUBTYP` already in it, so a Templater "trigger on new file creation" that runs TYP.js with `skipIfNotEmpty` leaves it alone

What happens to the note (the same in both, and what a [Templater script](#templater-setup-optional) should do as well):

1. `TYP` and `SUBTYP` are written in canonical spelling (a variant like `typ` is renamed in place); without a Subtyp an existing `SUBTYP` is removed
2. The TYP-Frontmatter (plus the Subtyp block, without floating properties) is added for every property the note doesn't have yet or has empty. Values already in the note always stay. Fixed shortcuts (`today`, `now`, `created`) are resolved; script shortcuts see below
3. **Changing the TYP** of a note: empty properties left over from the previous TYP are removed – exactly those of the previous TYP's and Subtyp's blocks (floating ones included) that the new TYP doesn't have, not even as a floating property. Properties with a value always stay, and so does every other empty property: it may be empty on purpose
4. The frontmatter is sorted (global order, TYP-Frontmatter with the Subtyp block)

The write keeps comments and formatting (see [Comments and formatting are kept](#comments-and-formatting-are-kept)). If that isn't possible for the note, nothing is written: *"TYP of "X" couldn't be set without losing comments in its frontmatter."*

**Script shortcuts** (`tp.<script>`) run through Templater, with the same rules as in TYP.js (see [Script shortcut convention](#script-shortcut-convention)): a property that already has a value doesn't run its script, a missing or failing script shows a notice and the fallback value is used, `ctx.after(fn)` runs after the write. The plugin builds Templater's `tp` object itself, the way Templater's own dynamic commands do – an undocumented part of Templater (tested with 2.25.1). **Without Templater** (not installed or disabled, or if that part of Templater has changed) every script shortcut gets its fallback value, with one notice: *"Script shortcuts need Templater – fallback values used for: Familie, Freunde."* `tp.hooks.on_all_templates_executed` works: the command runs as a Templater task for the note, so such a callback fires right after the frontmatter is written (after the `ctx.after` actions); `ctx.after` stays the clearer way.

## Bases

Written only through Obsidian's Bases API and serialization, never self-parsed YAML. Both commands need the **Bases core plugin**: while it is off they don't appear in the command palette (a `.base` file couldn't be opened anyway).

- **"Create Base for TYP"**: pick a TYP or Subtyp, choose options (*Floating properties*, *All Subtyp properties*, *tags*, with a live column preview; all off when creating). Creates `<name>.base` in the vault root: root filter `TYP == "…"`, a main view grouped by SUBTYP and one view per registered Subtyp. A Subtyp target filters by SUBTYP only (grouped by TYP if several TYP entries share the name). An existing file only gets the missing views
  - **File name of a Subtyp Base**: `<Subtyp>.base`, but `<Subtyp> (Subtyp).base` when that name would clash with a TYP ignoring case – a TYP `BUCH` and a Subtyp `Buch` would share one file on Windows and macOS. A clash is a registered TYP of that name (whether or not its Base exists yet) or a root `.base` file whose name differs only in case. With a clash only the new name counts; an existing `Buch.base` belongs to the TYP and is never filled from the Subtyp
  - **Only a file in a different case exists** (e.g. an old Subtyp Base `Buch.base` when creating the TYP Base `BUCH.base`): the command stops before the column dialog with a notice naming the file (`"Buch.base" already exists in a different case – rename or delete it first.`) instead of writing into someone else's Base
- **"Update columns of Base view"** (only with a Base open): reads the TYP from the filter (AND only), otherwise asks with the TYP-Picker. Adds and reorders silently; columns that don't belong are offered for removal. Only the column list (and, after the picker, the view filter) is touched
  - **Column dialog preset from the view**: *tags* is on when the view has a `tags` column, *Floating properties* when a floating property of the target is a column, *All Subtyp properties* (TYP target only) when a property of another Subtyp block is a column. So the columns chosen when the Base was created aren't offered for removal. A heuristic – the view doesn't record its options
  - **Filter only after confirmation**: the TYP picked for a view without an unambiguous filter is stored as the view's filter (`TYP == "…"`, plus `SUBTYP == "…"` for a Subtyp) only once every dialog is confirmed – also when the columns turn out to be up to date already (notice "filter set, …"), so the next run reads it. Cancelling any dialog leaves the view exactly as it was
  - **Removal dialog** "Remove columns from "View"?": one row per column that doesn't belong to the target, each with a **Remove** checkbox, all checked at first. The button counts along: "Remove 3 columns" (red) or, with nothing checked, "Keep all columns". Unchecked columns stay, right after `file.name`. The dialog says that **Cancel** discards the whole update, including adding and reordering. Keyboard focus starts on **Cancel** (as in the delete dialogs), so Enter only drops the run. Like every dialog that rewrites a file, it can't be switched off
- Column order: `file.name`, then the global property order; `TYP`/`SUBTYP` are never columns
- "Update columns" looks for the Base in the most recently active tab of the main area (or a pop-out window), so it also works while a sidebar (the TYP-Pane, say) has focus. New views are appended to an existing file with `vault.process`

## Frontmatter sorting

Puts the properties a note has into a fixed order; never adds or changes values. Only whole properties move, with the comments above them – every line keeps its text (see [Comments and formatting are kept](#comments-and-formatting-are-kept)).

- **Global property order** (settings, drag & drop – with a mouse the whole row, on touch the grip at its left, without a long press): pinned properties plus the placeholders TYP, SUBTYP, TYP-Frontmatter (the TYP's list followed by its Subtyp block) and Other properties. A pinned property always wins over its place in a TYP list. Hovering a placeholder row shows what it stands for (tooltip on its label; the description below the list only covers the rest)
- Commands **"Sort frontmatter in all notes"**, **"Sort frontmatter for one TYP"**, **"Sort frontmatter of active note"**; the **play button** ("Apply to all notes") next to the order runs the first, the TYP-Pane's context menu (*Sort frontmatter for this TYP*) the second without its picker. Each run reports a notice; already sorted notes are skipped via the metadata cache. Notes that can't be re-sorted without losing a comment are left alone and counted: *"Frontmatter sorting: checked 812 notes, sorted 37. 2 notes skipped (frontmatter can't be re-sorted without losing comments)."* – for the active note: *"Frontmatter of "X" couldn't be sorted without losing comments."*
- **Large runs ask first.** Before a run over many notes (all notes or one TYP, from a command, the play button or the context menu), the plugin counts from the metadata cache, without opening a note, how many notes would be re-sorted. From **50** on it asks, e.g. *"Re-sort 60 of 812 notes?"* or *"Re-sort 60 of 80 TERMIN notes?"* (TYP name colored), with [Cancel] [Sort] – Enter sorts. Below 50 it sorts right away. The question can't be switched off: the run rewrites notes and has no undo. The count is a forecast: the run counts again when it starts, and the closing notice gives the real number. "Sort frontmatter of active note" never asks
- **Progress:** the same large runs (50 or more notes to re-sort) show a notice *"Frontmatter sorting: 120 of 300 notes…"* (counting the notes to re-sort, not all checked ones), updated every 10 notes, that disappears when the run is done. One threshold for both (`LARGE_SORT_THRESHOLD` in `src/frontmatter-sort.js`): a run that asked also shows its progress, a small one does neither
- **Renaming a property** in "All properties" or Bases is carried into every TYP-Frontmatter, floating flags, shortcuts and the global order (case-insensitive; an existing name merges)
- Optional: TYP-Frontmatter property names in bold in notes, floating ones in italics

### Comments and formatting are kept

Obsidian's own way to change frontmatter (`processFrontMatter`) re-serializes the whole block: YAML comments vanish and quotes or list style may change, even when nothing else changes. The plugin's own writes – sorting and rewriting `TYP`/`SUBTYP` when renaming, merging or registering – work on the text instead (`src/frontmatter-text.js`) and leave every line they don't have to touch byte for byte as it was: quotes, list style, block scalars, empty values, line endings (LF or CRLF, per line) and a UTF-8 BOM.

- **Unit = one top-level property:** its key line plus everything that belongs to it – indented lines (nested values, list items, `|`/`>` block scalars, indented comments), `- ` items in column 0 (a list on the key's level), and blank lines followed by such a line
- **Comments go with the property below them:** comment and blank lines between two properties belong to the next one and move with it. An inline comment (`key: value # note`) is part of its line and stays when the value is rewritten
- **Exceptions:** a header comment before the first property stays on top if a blank line separates it from that property (without the blank line it belongs to the property); comments after the last property stay at the bottom
- **Safety check:** the cut is only used if it provably means the same as the whole block – every unit must parse on its own to exactly one property, and all units together must equal the parsed block. After the change, the new block is parsed again and must give exactly the expected properties, otherwise nothing is written. New lines get the line ending of the block
- **Blocks that can't be cut that way** – an alias (`*x`) pointing to an anchor in another property, a flow mapping (`{a: 1}`) or complex key (`? key`) at the top level, duplicate keys, invalid YAML – and changes that can't be made without dropping a comment (a multi-line `TYP` value with a comment inside, say): **without any comment** in the block the plugin falls back to Obsidian's way (parse, change, serialize – there is nothing to lose); **with comments** the note is skipped and counted in the notice. The comment check is generous (a `#` in a quoted string or block scalar counts too), so in doubt a note is skipped rather than reformatted
- An edit that changes nothing writes nothing (`processFrontMatter` rewrites the block even then)
- Not affected: the Templater API (`applyTypProperties`, `sortFrontmatter`, `placeProperty`) works inside the caller's own `processFrontMatter` and therefore follows Obsidian's behavior there

## Excluded files

TYP counts, pickers and sorting skip Obsidian's "Excluded files" (Hide Folders writes there too) unless **"Include excluded files"** (Settings → General) is on.

## Coloring

TYP colors apply to: file explorer (folder notes included), graph (color groups take precedence), search, Recent Files, backlinks (pane and embedded), bookmarks, the TYP-Pane itself, links in notes (reading view, Live Preview, source mode, hover – wikilinks and Markdown links alike), All Properties (one TYP → its color, several → bold, floating everywhere → italic), and the note title (text color; marker as dot or badge with label [TYP], [TYP/Subtyp] or [Subtyp]). Each view has its own toggle plus a **Subtyp** sub-toggle for the Subtyp color.

**Links in notes:** a link is colored when it points to an existing note whose TYP has a color – `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]` as well as Markdown links such as `[text](Note.md)`, `[text](My%20Note.md#Heading)`, `[text](<My Note.md>)`, `[text](./Note.md "title")` or `[text](Note)`. Reading view and Live Preview color the same links. Not colored: external links (anything with a scheme such as `https:`, `obsidian:` or `mailto:`), links to notes that don't exist, embeds (`![[…]]`, `![…](…)`) and anything in code blocks or inline code. In Live Preview a colored Markdown link looks like a wikilink, hover color included (Obsidian itself paints Markdown links there in the external link color); in source mode the link text is colored and the target keeps Obsidian's own styling.

Own tag/attachment colors in the graph are disabled since 2026-09-30 (`src/graph-colors.js`): the Minimal theme's Style Settings cover them.

## Templater integration

Templater is optional. Without it the commands in [Setting a note's TYP](#setting-a-notes-typ) cover TYP, Subtyp and TYP-Frontmatter; script shortcuts then get their fallback values. With Templater the same commands run script shortcuts, and a Templater script can do the whole job inside your own templates.

### Templater setup (optional)

A Templater user script `TYP.js` (not included) can do what "Set TYP of active note" does, as part of a template, built on the [API](#api) below:

1. Put `TYP.js` into Templater's script folder (*Settings → Templater → Script files folder location*); Templater then offers it as `tp.user.TYP`
2. Create a template that calls it:
   ```
   <%* await tp.user.TYP(tp, tp.config.target_file) -%>
   ```
   Insert it into a note ("Templater: Insert template") to set that note's TYP. Options as third argument: `{ includeManualOff: true }` also offers TYPs and Subtyps whose *Manually creatable* switch is off
3. Optional, for every new note: a second template with `<%* await tp.user.TYP(tp, tp.config.target_file, { skipIfNotEmpty: true }) -%>` as Templater's template for new files (*Trigger Templater on new file creation* plus a folder or file-regex template) – a note that already has content (dropped in, imported, or made by "New note with TYP") is left alone. ESC in the picker deletes the still-empty new note
4. Script shortcuts: put scripts with the `@typ-shortcut` marker into the same folder (see [Shortcuts](#shortcuts) and [Script shortcut convention](#script-shortcut-convention))

Without this script, script shortcuts still run when the TYP is set by the plugin's commands (as long as Templater is enabled), and only get their fallback value without Templater.

### API

The script uses this API on `app.plugins.plugins["typ-system"]`:

- `getTyps({ includeManualOff })` → `[{ typ, description, count }]` in TYP-List order
- `getTypDefaults(typ, { includeFloating, file, subtyp })` – resolved TYP-Frontmatter (plus the Subtyp block). Fixed shortcuts are resolved, script shortcuts are `null`. Pass `file` for `created`
- `getTypShortcuts(typ, { includeFloating, subtyp })` → `{ [property]: { name, params, args, fallback } }` for script shortcuts, in TYP-Frontmatter order
- `resolveShortcutArgs(params, args, { newFile, ctx, key })` – the arguments for `tp.user.<name>(tp, ...)`
- `pickTyp({ includeManualOff, includeUnregistered, showSubtyps })` → TYP or `null`
- `getSubtyps(typ, { includeManualOff })` → `[{ subtyp, count }]`
- `pickSubtyp(typ, query, { includeManualOff })` → Subtyp, `""` for "no Subtyp", or `null` on ESC
- `pickTypAndSubtyp({ includeManualOff, includeUnregistered })` → `{ typ, subtyp }` or `null`
- Inside `processFrontMatter`: `applyTypProperties(frontmatter, typ, subtyp)` (canonical spelling, removes SUBTYP if none), `sortFrontmatter(frontmatter, typ, subtyp)`, `placeProperty(frontmatter, key)` (used by Fred's property backlinking). They work on `processFrontMatter`'s object, so comments in that note's frontmatter are lost as with any `processFrontMatter` call (see [Comments and formatting are kept](#comments-and-formatting-are-kept))

### Script shortcut convention

Applies to script shortcuts run by the plugin's commands and by TYP.js alike.

- `ctx = { typ, subtyp, key, values, after, args }`: `values` are the defaults resolved so far (scripts run in order), `args` the typed arguments
- `after(fn)` queues an action that runs after the frontmatter is written, in order - for side effects like renaming the file (`quelleEditName`)
- A single return value becomes the property's value; a plain object can also fill other empty properties of the TYP
- A script isn't run if the property already has a value; a missing or failing script shows a notice and the fallback is used

## Technical notes

- `src/` is the source, `main.js` the esbuild bundle (`npm run dev` watches, `npm run build` builds once)
- In the code TYP and Subtyp are fixed terms too (`typ`, `subtyp`, plural `typs`/`subtyps`)
- **TYP index** (`src/typ-index.js`): holds TYP and SUBTYP of every note (property names case-insensitive) and fires its own `change` event only on real TYP/SUBTYP changes; all coloring hangs on it, so typing triggers no recoloring. Caches the counts
- **Frontmatter blocks** (`src/frontmatter-blocks.js`): one Obsidian property editor per block - the only way to allow the same key in several blocks. Keyboard navigation across blocks and dragging rows between blocks are added on top of Obsidian's own behavior
- **Drag & drop on touch:** the plugin's own drags (block order, manual TYP-List order, global property order) share `attachPointerDrag` (`src/pointer-drag.js`) on Pointer Events instead of HTML5 `draggable` or mouse events, neither of which work on touch:
  - Mouse: left button, starts after 4 px of movement; Escape cancels. The click after a drop is swallowed, so dropping a TYP row doesn't open its detail view
  - Touch: long press (250 ms, like Obsidian's own sortable lists; a short vibration where supported), then drag. Moving earlier is a swipe and scrolls as usual. Near the top or bottom edge of the scrolling pane the list scrolls along
  - A long press released without moving is no drag: in the TYP-List it opens the row's context menu (a synthetic `contextmenu` event, as Obsidian does in its sortable lists). Any other `contextmenu` during the touch is swallowed – Android fires its native one while the finger is still down, Obsidian's iOS app a synthetic one after 800 ms, and either would open the menu in the middle of a drag. Rows that can't be dragged (unregistered values, `[NO TYP]`, any row outside manual sorting) keep the platform's long press, which opens their menu as before
  - The global property order drags on touch only by its grip, right away (`touch-action: none`), so a swipe over the rows still scrolls the settings. The grip is shown only on mobile or with a coarse pointer (`body.is-mobile`, `@media (pointer: coarse)`); with a mouse the whole row drags, as before
  - Rows between Subtyp blocks build on Obsidian's own row drag, which on touch starts with a long press on the type icon (250 ms), then move. The plugin's handlers for it are Pointer Events: the browser fires them before the mouse and touch events Obsidian listens to, so the spacer for single-row blocks is in place before Obsidian checks the list, and the target block is known before it drops. The target is followed only while Obsidian's drag really runs (`body.is-grabbing`)
- **Shortcuts** (`src/shortcuts.js`, `shortcut-scripts.js`, `shortcut-picker.js`): button and chip hang on the row's `containerEl`, which `renderProperty()` never empties, so no hook into Obsidian's rendering is needed. The script list is read ahead and rescanned (debounced) on file events in Templater's script folder; its accessor `getShortcutScripts()` also offers `isLoaded()` and `onChange(fn)`, through which the TYP-Pane updates only the shortcut buttons (`refreshShortcutControls`) when a script appears or vanishes
- Graph coloring patches `renderer.setData` (like graph-nested-tags); property rename sync wraps `app.fileManager.renameProperty`; the *Floating* menu entry patches `showPropertyMenu` of Obsidian's private property row class. All three are undone on unload
- **Disabling the plugin cleans up at once**, without waiting for each view to re-render:
  - Inline colors in the file explorer, search, Recent Files, backlinks, bookmarks, the note title and "All properties" are set through `setInlineColor` (`src/typ-colors.js`), which marks each element with `data-typ-colored`. On unload exactly the marked elements lose their color, in every window; inline colors from themes or other plugins stay
  - Note title and property block lose dot, badge, their `data-typ` attribute and color variables; property names lose the bold/italic classes (`typ-default-property`, `typ-floating-property`)
  - Open graphs are re-rendered once with the original `setData`, so the TYP colors disappear immediately
  - Link colors: the editor extension goes away with the plugin; the `--link-color` variables on rendered links are removed (in every window, hover previews included)
- **Enabling the plugin (or a reload) colors at once** what is already on screen: Obsidian re-runs post-processors in reading view by itself, but not for blocks Live Preview has already rendered (tables, callouts). Once the layout is ready, `refreshRenderedLinks` recolors every rendered link. The source note each link needs for resolving is kept on the link (`data-typ-src`, also across unload); a link rendered while the plugin was off gets the note of the leaf it is shown in
- **Link colors in Live Preview** are refreshed through a CodeMirror effect, dispatched at most once per animation frame and never synchronously: a refresh can arrive while an editor is in the middle of its own update, which CodeMirror refuses ("Calls to EditorView.update are not allowed while an update is in progress"). An editor still busy is retried a frame later
- **Links in Live Preview/source mode** (`src/link-colors.js`): a ViewPlugin scans only the visible ranges, for wikilinks and for Markdown links (`MD_LINK_PATTERN`; one level of parentheses in the target is allowed, as in `Note%20(draft).md`). A match counts only where Obsidian's parser sees a link – a wikilink must be an `hmd-internal-link` node, a Markdown link target a `string_url` node – which rules out code blocks and inline code. A Markdown target is read with Obsidian's own rules: `<…>` unwrapped, internal only without a `:` (or as an explicit `./`/`../` path), then `decodeURI` (a target that can't be decoded is no link for Obsidian either), then `getLinkpath` and `metadataCache.getFirstLinkpathDest`. Both kinds of matches are collected, sorted and added to the `RangeSetBuilder` in order (overlaps skipped). The mark carries `--link-color`; since Obsidian sets the external link color directly on `.cm-link .cm-underline`, `styles.css` has a more specific rule for colored Markdown links. Reading view needs nothing new: Obsidian renders internal Markdown links as `a.internal-link` with a decoded `data-href`, which the post-processor already colors
- **Coloring the other views stays cheap** (`coalesceFrame` in `src/typ-utils.js`: runs a function at most once per animation frame, using the frames of the focused window; a pending run is cancelled on unload). File explorer, search, Recent Files, backlinks and bookmarks watch their pane with a `MutationObserver`, which reports every DOM change of a virtualized list, often several per frame. None of them recolors synchronously any more:
  - **File explorer:** events that can change existing rows (TYP change, rename, layout change, `refreshTypColors()`) ask for a full round over the rendered rows. DOM changes only collect the inserted elements, and the next frame colors just those rows (the row itself or the rows inside an expanded folder), read anew from `data-path` every time because the list is virtualized. A pending full round makes the collected rows unnecessary
  - **Search, Recent Files, backlinks pane, bookmarks:** observer and events share one full round per frame. Search and the backlinks pane only touch rows that are in the DOM; a row scrolled back into view is colored when the observer sees it inserted
  - The backlinks observer still watches only the sidebar pane, never a markdown view (a subtree observer near the editor once froze this vault); embedded backlinks follow `resolved` and the leaf events
  - A frame requested from a scroll handler, timer or observer still runs before the next paint, so inserted rows are never painted uncolored (checked with a probe right before paint while scrolling the whole explorer and expanding folders)
  - Measured in this vault (about 700 notes, Obsidian 1.13.7): scrolling the fully expanded explorer for 3 s went from 64 full rounds (29.5 ms, 0.46 ms each) to about 50 frames coloring only inserted rows (3–4 ms, 0.07 ms each); expanding every folder from 515 full rounds (130 ms) to about 260 frames (4 ms); typing a search over all notes from 1.0 to 0.26 ms per round, scrolling its results from 2.2 to 0.3 ms per round; 50 `refreshTypColors()` calls in a row now cost one round per view instead of 50
- Settings start from a deep copy (`structuredClone`) of the defaults, so a fresh install without `data.json` never changes the defaults themselves
- **Confirmation dialog** (`src/confirm-modal.js`): one `ConfirmModal` on top of Obsidian's public `ConfirmationModal` (since 1.13.0) for every confirmation; title and body take text and nodes, so names can be colored. Both callbacks run once the dialog has closed; the `dontAskAgain` option adds Obsidian's checkbox (`addCheckbox`, desktop only) and hands its state to `onConfirm`
- **Undo** (`src/undo.js`): a `structuredClone` of the settings before the action, restored in place (the `plugin.settings` object stays the same). `saveSettings()` and `onExternalSettingsChange()` bump `plugin.settingsRevision`; an undo whose recorded revision no longer matches is refused
- The TYP-Pane (view type `typ-system-pane`) reconnects itself after hot reload
- **Refreshing views:** `plugin.refreshTypColors()` refreshes every view, the TYP-Pane included (rebuilt from the settings) – for changes made elsewhere (settings tab, property rename sync, Sync, Undo). The pane's own actions use `plugin.refreshTypColorsExcept(pane)` instead and update the pane themselves, calling `render()` only where it really has to rebuild (blocks moved, a color that Subtyp colors derive from). Above all a property edit no longer rebuilds the pane, which used to take the focus away. `render()` keeps the scroll position and is deferred while an inline name is being typed (`startInlineEdit`, the one implementation of every inline input in the pane). Refreshes from outside go through `requestRender()`, which additionally waits while the focus is in a field of the pane and catches up on `focusout` once the focus has left the fields
- **Per-TYP settings** (`src/typ-settings.js`): one list of the tables keyed by TYP name (`typColors`, `typDescriptions`, `typDefaultFrontmatter`, `typFloatingKeys`, `typShortcuts`, `typManual`), used by renaming (`moveTypSettings`), deleting and merging (`deleteTypSettings`) - a table added later can't be forgotten in one of them. Subtyps follow through `subtyps.js`
- **First start:** when the plugin is loaded without a `data.json` (`loadData()` resolves `null`, i.e. it has never saved settings in this vault), the TYP-Pane is created in the left sidebar and revealed. This happens once: afterwards a closed pane stays closed and only "Open TYP-Pane" brings it back. "Already created" is a marker in this device's `localStorage` for the vault (`app.saveLocalStorage("typ-system-pane-created")`), so a hot reload before the first save doesn't open the pane again. `data.json` is deliberately not written for this: with Obsidian Sync, a `data.json` full of defaults written on a second device before the real one arrives could replace the real settings. On another device (or after clearing the app's local data) the pane may therefore open once more if `data.json` hasn't arrived yet
- **Frontmatter sorting runs in two phases** (`src/frontmatter-sort.js`): `sortCandidates()` goes through the notes using only the metadata cache and returns the number checked plus the notes whose order would change; `sortAllFrontmatter()` then writes just those (each checked once more against the cache; the file itself decides, read and written in one `editFrontmatter` call). `runFrontmatterSort()` is the single entry point of every run over many notes (both commands, play button, context menu): it asks with the first phase's count when the run is large, then runs the second and reports the result, so no caller has its own copy of the question. The progress notice counts the second phase
- **Comment-preserving writes** (`src/frontmatter-text.js`): `editFrontmatter(app, file, mutate)` is the one write path for the plugin's own frontmatter changes. It reads and writes once through `vault.process` (an unchanged result writes nothing) and resolves to `{ status: "changed" | "unchanged" | "skipped" }`. `mutate(doc)` is synchronous and acts only through `doc`: `keys()`, `has(key)`, `get(key)`, `findKey(name)` (any case, exact spelling first), `toObject()`, `set(name, value)` (like `setCanonicalProperty`: renames a differently spelled variant in place, drops further ones, appends a missing property), `delete(name)` (every spelling, with the comments above it), `reorder(keys)`. The same interface exists twice – `TextDoc` on the cut text, `ObjectDoc` on the parsed object for the fallback – so `mutate` may run twice (text model first, object model if the text model gave up). A note without frontmatter gets a new block on `set`. `editFrontmatterText(content, mutate)` is the pure core (content in, `{ status, content }` out). The BOM is handled here because `getFrontMatterInfo` (and so `processFrontMatter`) doesn't find a block behind it, while the metadata cache does – `processFrontMatter` would put a second block in front of the BOM
- **Setting a TYP** (`src/set-typ.js`): `setTypOfFile(plugin, file, { typ, subtyp })` is the shared core of both commands – script shortcuts first (the loop of TYP.js, `tp` built lazily on the first script that has to run), then one `editFrontmatter` call for TYP/SUBTYP, defaults, removing the previous TYP's empty leftovers (previous TYP and Subtyp read from the note's text, not the index, which may lag) and sorting, then the `ctx.after` actions. Templater access is guarded piece by piece (`create_running_config`, `functions_generator.generate_object` with RunMode DynamicProcessor 4 and FunctionsMode USER_INTERNAL 1, `start_templater_task`/`end_templater_task`); anything missing or throwing means "no Templater" and the fallback values
- The global property order uses its own plain list instead of Obsidian's widget: re-running `synchronize()` from `saveFrontmatter` can cause a stack overflow
