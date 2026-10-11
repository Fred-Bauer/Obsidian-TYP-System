const { Notice } = require("obsidian");
const { ConfirmModal, typNameNode, subtypNameNode } = require("./confirm-modal");
const { editFrontmatter, skippedText } = require("./frontmatter-text");
const { orderedDefaultKeys } = require("./frontmatter-sort");
const { plural } = require("./typ-utils");

// A property renamed in a TYP-Frontmatter or Subtyp block of the TYP-Pane
// (saveFrontmatter in typ-frontmatter-editor.js) only changes the settings:
// new notes get the new name, existing ones keep the old. A notice offers to
// carry the rename into the notes the block applies to; its button opens the
// confirmation, as for every action that rewrites notes.
//
// The other direction - a rename in "All properties" carried into the blocks
// - is property-rename-sync.js. That one is vault-wide like Obsidian's own
// rename; this one only touches the notes of the block.

const OFFER_NOTICE_DURATION = 15000;

const lower = (key) => key.toLowerCase();

// Whether a note's frontmatter holds oldKey in a spelling the rename changes:
// any spelling, but not newKey's own (a change of case is a rename too).
function holdsOldKey(frontmatter, oldKey, newKey) {
  return Object.keys(frontmatter ?? {}).some((key) => lower(key) === lower(oldKey) && key !== newKey);
}

// Whether notes of typ with this SUBTYP key follow the rename: their blocks
// together (see orderedDefaultKeys - spelling and position from the
// TYP-Frontmatter first) now give newKey in exactly this spelling and no
// longer oldKey. Not so if another of their blocks still has oldKey (renamed
// in the Subtyp block, still in the TYP-Frontmatter, say), nor if the block
// was renamed again since the offer.
function followsRename(plugin, typ, subtyp, oldKey, newKey) {
  const keys = orderedDefaultKeys(plugin, typ, subtyp) ?? [];
  if (!keys.includes(newKey)) return false;
  return lower(oldKey) === lower(newKey) || !keys.some((key) => lower(key) === lower(oldKey));
}

// The notes concerned, from the metadata cache (no note is read):
//   files  - notes of the block that follow the rename and still hold oldKey
//   kept   - notes of the block that hold oldKey but keep it (followsRename)
//   others - notes outside the block holding oldKey; they stay as they are
// Excluded files count as everywhere else in the plugin (includeIgnoredFiles).
function surveyNotes(plugin, { typ, subtyp }, oldKey, newKey) {
  const { app, typIndex } = plugin;
  const holds = (file) => holdsOldKey(app.metadataCache.getFileCache(file)?.frontmatter, oldKey, newKey);
  const blockFiles = subtyp === null ? typIndex.filesWithTyp(typ) : typIndex.filesWithSubtyp(typ, subtyp);

  const follows = new Map();
  const files = [];
  let kept = 0;
  for (const file of blockFiles) {
    if (!holds(file)) continue;
    const noteSubtyp = typIndex.subtypOf(file);
    if (!follows.has(noteSubtyp)) follows.set(noteSubtyp, followsRename(plugin, typ, noteSubtyp, oldKey, newKey));
    if (follows.get(noteSubtyp)) files.push(file);
    else kept++;
  }

  const blockPaths = new Set(blockFiles.map((file) => file.path));
  const includeIgnored = !!plugin.settings.includeIgnoredFiles;
  let others = 0;
  for (const file of app.vault.getMarkdownFiles()) {
    if (blockPaths.has(file.path)) continue;
    if (!includeIgnored && app.metadataCache.isUserIgnored(file.path)) continue;
    if (holds(file)) others++;
  }
  return { files, kept, others };
}

// Called by saveFrontmatter after a rename in the block of `store` (see
// typStore/subtypStore). Says nothing if no note holds the old name.
function offerRenameInNotes(plugin, store, oldKey, newKey) {
  const { files } = surveyNotes(plugin, store, oldKey, newKey);
  if (files.length === 0) return;
  const fragment = createFragment((f) => {
    f.appendText(
      `"${oldKey}" renamed to "${newKey}" in ${store.subtyp ?? store.typ}. ` +
        `${plural(files.length, "note")} still ${files.length === 1 ? "has" : "have"} the old name.`
    );
    // Obsidian hides the notice on any click inside it, the button included.
    const button = f.createEl("button", { cls: "typ-notice-button", text: "Update notes" });
    button.addEventListener("click", () => confirmRenameInNotes(plugin, store, oldKey, newKey));
  });
  new Notice(fragment, OFFER_NOTICE_DURATION);
}

// Counted anew on the click: the notes or the block may have changed since
// the offer.
function confirmRenameInNotes(plugin, store, oldKey, newKey) {
  const { files, kept, others } = surveyNotes(plugin, store, oldKey, newKey);
  if (files.length === 0) {
    new Notice(`No note left to rename "${oldKey}" to "${newKey}" in.`);
    return;
  }

  const { typ, subtyp } = store;
  const typName = typNameNode(plugin, typ, plugin.settings.typColors[typ] ?? null);
  const noun = files.length === 1 ? "note" : "notes";
  const question = `Rename "${oldKey}" to "${newKey}" in ${files.length} `;
  const title =
    subtyp === null
      ? [question, typName, ` ${noun}?`]
      : [question, subtypNameNode(plugin, typ, subtyp), ` ${noun} of `, typName, "?"];

  const body = [];
  if (kept > 0) {
    body.push(`${plural(kept, "note")} ${kept === 1 ? "keeps" : "keep"} "${oldKey}": another block of ${typ} still has it.`);
  }
  if (others > 0) {
    body.push(
      `${plural(others, "other note")} with "${oldKey}" ${others === 1 ? "stays" : "stay"} as ${others === 1 ? "it is" : "they are"}. ` +
        `"All properties" renames it in every note.`
    );
  }

  new ConfirmModal(plugin.app, {
    title,
    body,
    confirmText: "Update notes",
    onConfirm: () => renameInNotes(plugin, files, oldKey, newKey),
  }).open();
}

// Only the key changes in each note (see rename in frontmatter-text.js). A
// note holding both names with different values is left alone and counted.
async function renameInNotes(plugin, files, oldKey, newKey) {
  let changed = 0;
  let skipped = 0;
  let conflicts = 0;
  try {
    for (const file of files) {
      let conflict = false;
      const { status } = await editFrontmatter(plugin.app, file, (doc) => {
        conflict = !doc.rename(oldKey, newKey);
      });
      if (conflict) conflicts++;
      else if (status === "changed") changed++;
      else if (status === "skipped") skipped++;
    }
  } catch (error) {
    console.error("TYP-System: property rename in notes failed", error);
    new Notice(`Renaming "${oldKey}" in notes failed after ${plural(changed, "note")}: ${error.message}`);
    return;
  }
  const conflictText = conflicts
    ? ` ${plural(conflicts, "note")} skipped ("${oldKey}" and "${newKey}" hold different values).`
    : "";
  new Notice(`"${oldKey}" → "${newKey}": ${plural(changed, "note")} updated.${skippedText(skipped, "updated")}${conflictText}`);
}

module.exports = { offerRenameInNotes };
