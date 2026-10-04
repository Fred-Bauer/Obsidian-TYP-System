const { setIcon, Notice } = require("obsidian");
const { TYP_PROPERTY, SUBTYP_PROPERTY, runFrontmatterSort } = require("./frontmatter-sort");

// Labels of the four placeholder rows; computeSortedKeys in frontmatter-sort.js
// resolves what each one stands for.
const PLACEHOLDER_LABELS = {
  typValue: "TYP",
  subtypValue: "SUBTYP",
  typ: "TYP-Frontmatter",
  other: "Other properties",
};

// What each placeholder row stands for, as its tooltip - the setting's
// description below the list stays short that way.
const PLACEHOLDER_DESCRIPTIONS = {
  typValue: "The TYP property itself.",
  subtypValue: "The SUBTYP property itself.",
  typ: "The TYP's TYP-Frontmatter list, followed by the note's Subtyp block.",
  other: "Every property not placed by another row.",
};

// Editor for settings.globalPropertyOrder: a plain list of names with drag &
// drop. It holds no values, so unlike typ-frontmatter-editor.js it needs no
// detour through Obsidian's private property widget. The placeholder rows can
// be moved but not removed.
function mountGlobalOrderEditor(containerEl, plugin) {
  const header = containerEl.createDiv({ cls: "typ-frontmatter-header" });

  // Button and title share a group: the header uses space-between, so a third
  // direct child would float in the middle instead of next to the title.
  const titleGroup = header.createDiv({ cls: "typ-frontmatter-title-group" });

  // Same run as the "Sort frontmatter in all notes" command, including its
  // question before a large run (see runFrontmatterSort).
  const applyBtn = titleGroup.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Apply to all notes" } });
  setIcon(applyBtn, "play");
  applyBtn.addEventListener("click", async () => {
    try {
      await runFrontmatterSort(plugin, null);
    } catch (error) {
      console.error("[Frontmatter sorting]", error);
      new Notice(`Frontmatter sorting failed: ${error.message}`);
    }
  });

  titleGroup.createDiv({ cls: "typ-detail-section-title", text: "Global property order" });

  const addBtn = header.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Add property" } });
  setIcon(addBtn, "plus");

  const listEl = containerEl.createDiv({ cls: "typ-order-list" });

  const order = () => plugin.settings.globalPropertyOrder;

  // A new row only joins globalPropertyOrder once it has a valid name. Until
  // then it is a local draft appended on render, so an empty name never ends
  // up in the settings, even if something else saves in between.
  let draftEntry = null;

  const isDuplicateName = (value, ownEntry) => {
    const lower = value.toLowerCase();
    if (lower === TYP_PROPERTY.toLowerCase() || lower === SUBTYP_PROPERTY.toLowerCase()) return true;
    return order().some((other) => other !== ownEntry && other.kind === "property" && other.name.toLowerCase() === lower);
  };

  const render = () => {
    listEl.empty();
    const entries = draftEntry ? [...order(), draftEntry] : order();

    entries.forEach((entry, index) => {
      const isDraft = entry === draftEntry;
      const isPlaceholder = entry.kind !== "property";
      const rowCls =
        "typ-order-row" + (isPlaceholder ? " is-placeholder" : "") + (entry.kind === "typ" ? " is-typ-defaults" : "");
      const row = listEl.createDiv({ cls: rowCls });

      const dragHandle = row.createDiv({ cls: "typ-order-drag", attr: { "aria-label": "Drag to move" } });
      setIcon(dragHandle, "grip-vertical");

      if (isPlaceholder) {
        // On the label, not the row: the drag handle has a tooltip of its own.
        row.createDiv({
          cls: "typ-order-label",
          text: PLACEHOLDER_LABELS[entry.kind],
          attr: { "aria-label": PLACEHOLDER_DESCRIPTIONS[entry.kind] },
        });
      } else {
        const input = row.createEl("input", {
          type: "text",
          cls: "typ-order-name-input",
          attr: { placeholder: "Property name" },
        });
        input.value = entry.name;

        // "blur", not "change": change doesn't fire for a field left empty, so
        // the draft would never be cleaned up.
        input.addEventListener("blur", async () => {
          const value = input.value.trim();

          if (!value) {
            if (isDraft) {
              draftEntry = null;
            } else {
              order().splice(order().indexOf(entry), 1);
              await plugin.saveSettings();
            }
            render();
            return;
          }

          if (isDuplicateName(value, isDraft ? null : entry)) {
            new Notice(`"${value}" is already in the list.`);
            input.value = entry.name;
            return;
          }

          entry.name = value;
          if (isDraft) {
            order().push(entry);
            draftEntry = null;
          }
          await plugin.saveSettings();
          render();
        });

        const removeBtn = row.createDiv({ cls: "typ-order-remove clickable-icon", attr: { "aria-label": "Remove" } });
        setIcon(removeBtn, "x");
        removeBtn.addEventListener("click", async () => {
          if (isDraft) {
            draftEntry = null;
          } else {
            order().splice(order().indexOf(entry), 1);
            await plugin.saveSettings();
          }
          render();
        });
      }

      // A draft has no place in the real list yet, so it can't be moved.
      if (isDraft) return;

      row.draggable = true;
      row.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));
        row.classList.add("is-dragging");
      });
      row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
      row.addEventListener("dragover", (event) => {
        event.preventDefault();
        // Upper or lower half decides before/after - otherwise nothing could
        // be dropped below the last row.
        const rect = row.getBoundingClientRect();
        const isAfter = event.clientY - rect.top > rect.height / 2;
        row.classList.toggle("is-drop-before", !isAfter);
        row.classList.toggle("is-drop-after", isAfter);
      });
      row.addEventListener("dragleave", () => row.classList.remove("is-drop-before", "is-drop-after"));
      row.addEventListener("drop", async (event) => {
        event.preventDefault();
        const isAfter = row.classList.contains("is-drop-after");
        row.classList.remove("is-drop-before", "is-drop-after");

        const fromIndex = Number(event.dataTransfer.getData("text/plain"));
        if (Number.isNaN(fromIndex)) return;

        // Target index counted before fromIndex is removed.
        let insertBefore = isAfter ? index + 1 : index;
        if (fromIndex < insertBefore) insertBefore -= 1;

        const [moved] = order().splice(fromIndex, 1);
        order().splice(insertBefore, 0, moved);
        await plugin.saveSettings();
        render();
      });
    });
  };

  addBtn.addEventListener("click", () => {
    if (!draftEntry) {
      draftEntry = { kind: "property", name: "" };
      render();
    }
    const inputs = listEl.querySelectorAll(".typ-order-name-input");
    inputs[inputs.length - 1]?.focus();
  });

  render();
}

module.exports = { mountGlobalOrderEditor };
