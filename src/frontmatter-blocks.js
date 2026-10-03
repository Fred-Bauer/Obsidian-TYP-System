const { mountFrontmatterEditor, addBlankProperty, typStore, subtypStore } = require("./typ-frontmatter-editor");
const { getSectionOrder, isEmptyValue } = require("./subtyps");

/* ============================================================
 * The frontmatter blocks of a TYP in the TYP-Pane detail (see
 * renderTypSettings in typ-pane.js): the TYP-Frontmatter on top,
 * below it one block per registered Subtyp.
 *
 * Each block has its own instance of Obsidian's property editor,
 * bound to typStore or subtypStore (see typ-frontmatter-editor.js).
 * That is what lets the same key appear in several blocks - one
 * shared editor would hold everything in a single flat object.
 *
 * Obsidian's row drag only works within one instance, so
 * registerPropertyDrag() below builds on that drag to move a
 * property between blocks. Keyboard navigation across blocks is
 * registerFocusChain() in typ-frontmatter-editor.js.
 *
 * Section: null = TYP-Frontmatter, otherwise the Subtyp name.
 * ============================================================ */

// A whole block can be grabbed anywhere outside its property rows - heading,
// footer, side margins. Controls and a title being edited are excluded.
function isGrabTarget(target) {
  if (target.closest(".clickable-icon, .typ-subtyp-color-dot, [contenteditable='true'], input, textarea")) return false;
  return !target.closest(".metadata-property");
}

// renderHeader(section, el, blocks) / renderFooter(section, el, blocks) fill a
// block's heading and footer. onMoveSection(order) reports the new block order
// after a block drag (shaped like getSectionOrder, leading null included).
function mountFrontmatterBlocks(view, containerEl, typ, { renderHeader, renderFooter, onMoveSection }) {
  const wrapper = containerEl.createDiv({ cls: "typ-blocks" });
  const sections = getSectionOrder(view.plugin.settings, typ);
  const editors = new Map();
  const blockEls = new Map();
  const stores = new Map();

  const api = {
    // All editor instances in block order; typ-pane.js adds them as component
    // children and unloads them before each rebuild.
    editors: [],
    // Adds a blank row at the end of the block with focus in the key field
    // (see addBlankProperty). floating marks the next named property as
    // floating.
    addBlank(section, floating = false) {
      const editor = editors.get(section);
      if (!editor) return;
      editor.typPendingFloatingAdd = floating;
      addBlankProperty(editor);
    },
  };

  // Next block in direction step that has a row to jump to; empty blocks are
  // skipped.
  const focusNeighbor = (section, step) => {
    for (let i = sections.indexOf(section) + step; i >= 0 && i < sections.length; i += step) {
      const editor = editors.get(sections[i]);
      if (!editor || editor.rendered.length === 0) continue;
      editor.focusPropertyAtIndex(step > 0 ? 0 : -1);
      return true;
    }
    return false;
  };

  for (const section of sections) {
    const isSub = section !== null;
    const blockEl = wrapper.createDiv({
      cls: "typ-block" + (isSub ? " typ-frontmatter-block typ-subtyp-block" : ""),
    });
    blockEls.set(section, blockEl);
    blockEl.typSection = section;

    const header = blockEl.createDiv({ cls: "typ-frontmatter-header typ-section-header" });
    header.toggleClass("typ-section-sub", isSub);

    const store = section === null ? typStore(view.plugin, typ) : subtypStore(view.plugin, typ, section);
    stores.set(section, store);
    const editor = mountFrontmatterEditor(view, blockEl, store, {
      onShiftFocus: (step) => focusNeighbor(section, step),
    });
    if (editor) {
      editors.set(section, editor);
      api.editors.push(editor);
    }

    const footer = blockEl.createDiv({ cls: "typ-section-footer" });
    footer.toggleClass("typ-section-sub", isSub);
    renderHeader(section, header, api);
    renderFooter?.(section, footer, api);

    if (!isSub) continue;
    blockEl.addEventListener("mousedown", (event) => startBlockDrag(event, section));
  }

  // Mouse drag instead of HTML5 draggable: a draggable ancestor broke text
  // selection in the row inputs. Starts after a few pixels; an accent line
  // shows the target gap, Escape cancels. The TYP-Frontmatter is fixed on top
  // (see getSectionOrder), so target 0 doesn't exist.
  function startBlockDrag(event, section) {
    if (event.button !== 0 || !isGrabTarget(event.target)) return;
    const win = wrapper.win;
    const startY = event.clientY;
    let dragging = false;
    let indicator = null;
    let boxes = [];
    let targetIndex = null;

    const measure = () => {
      const base = wrapper.getBoundingClientRect();
      boxes = sections.map((name) => {
        const rect = blockEls.get(name).getBoundingClientRect();
        return { section: name, top: rect.top - base.top, bottom: rect.bottom - base.top };
      });
    };

    const onMove = (moveEvent) => {
      if (!dragging) {
        if (Math.abs(moveEvent.clientY - startY) < 4) return;
        dragging = true;
        wrapper.doc.body.addClass("typ-block-dragging");
        win.getSelection()?.removeAllRanges();
        blockEls.get(section).addClass("is-dragging");
        measure();
        indicator = wrapper.createDiv({ cls: "typ-block-drop-indicator" });
      }
      moveEvent.preventDefault();
      const y = moveEvent.clientY - wrapper.getBoundingClientRect().top;
      targetIndex = Math.max(1, boxes.filter((box) => (box.top + box.bottom) / 2 < y).length);
      const from = boxes.findIndex((box) => box.section === section);
      indicator.toggle(targetIndex !== from && targetIndex !== from + 1);
      // Middle of the gap between two blocks (see .typ-block + .typ-block in
      // styles.css).
      const halfGap = 6;
      const gapY =
        targetIndex === boxes.length
          ? boxes[boxes.length - 1].bottom + halfGap
          : (boxes[targetIndex - 1].bottom + boxes[targetIndex].top) / 2;
      indicator.style.top = `${gapY - 1}px`;
    };

    const end = (commit) => {
      win.removeEventListener("mousemove", onMove);
      win.removeEventListener("mouseup", onUp);
      win.removeEventListener("keydown", onKey, true);
      if (!dragging) return;
      wrapper.doc.body.removeClass("typ-block-dragging");
      blockEls.get(section).removeClass("is-dragging");
      indicator?.remove();

      const order = boxes.map((box) => box.section);
      const from = order.indexOf(section);
      if (!commit || targetIndex === null || targetIndex === from || targetIndex === from + 1) return;
      order.splice(from, 1);
      order.splice(from < targetIndex ? targetIndex - 1 : targetIndex, 0, section);
      onMoveSection?.(order);
    };
    const onUp = () => end(true);
    const onKey = (keyEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      end(false);
    };
    win.addEventListener("mousemove", onMove);
    win.addEventListener("mouseup", onUp);
    win.addEventListener("keydown", onKey, true);
  }

  registerPropertyDrag();
  return api;

  /* --- Dragging a property into another block ----------------------------
   * Built on Obsidian's own row drag rather than a second one next to it:
   * it starts at the row's type icon, puts a .drag-reorder-ghost on the
   * body (so it follows the cursor across blocks anyway) and marks the
   * source row with .drag-ghost-hidden, the accent box showing the drop
   * spot. Within one block Obsidian does everything as usual. Added here:
   *
   *  - an empty extra child in the list while dragging: otherwise Obsidian
   *    doesn't start the drag in a block with a single row (its mousedown
   *    checks n.firstChild !== n.lastChild);
   *  - a placeholder with the same .drag-ghost-hidden class in the target
   *    block once the cursor reaches another block; the source row is
   *    hidden meanwhile so there aren't two boxes;
   *  - a reorderKey per instance that moves the property to the other
   *    block on drop instead of sorting within its own.
   *
   * Our handlers run in the capture phase on the window, before Obsidian's
   * (which it adds to window in its mousedown handler).
   * -------------------------------------------------------------------- */
  function registerPropertyDrag() {
    // Without a second block there is no target; Obsidian's drag stays as is.
    const anchor = api.editors[0];
    if (!anchor || sections.length < 2) return;

    // State of a running drag; drop keeps the target for the reorderKey call
    // that follows the mouseup.
    let drag = null;
    let drop = null;

    const sectionAt = (clientY) =>
      sections.find((section) => {
        const rect = blockEls.get(section).getBoundingClientRect();
        return clientY >= rect.top && clientY <= rect.bottom;
      });

    const clearPlaceholder = () => {
      drag.placeholder?.remove();
      drag.placeholder = null;
      drag.rowEl.style.removeProperty("display");
      drag.target = null;
    };

    wrapper.addEventListener(
      "mousedown",
      (event) => {
        if (event.button !== 0) return;
        const rowEl = event.target.closest(".metadata-property-icon")?.closest(".metadata-property");
        const section = rowEl?.closest(".typ-block")?.typSection;
        const editor = section === undefined ? null : editors.get(section);
        const key = editor?.rendered.find((row) => row.containerEl === rowEl)?.entry.key;
        // An unnamed row has no business in another block; Obsidian sorts it.
        if (!key) return;
        drag = {
          section,
          key,
          rowEl,
          // Measured now: once hidden for the placeholder, offsetHeight is 0.
          height: rowEl.offsetHeight,
          spacer: editor.propertyListEl.createDiv({ cls: "typ-drag-spacer" }),
          placeholder: null,
          target: null,
        };
        drop = null;
      },
      true
    );

    // On the window so a drag is tracked outside the blocks too; removed with
    // the first editor, which unloads on the next rebuild of the detail view.
    const onWinMove = (event) => {
      if (!drag) return;
      const target = sectionAt(event.clientY);
      if (target === undefined || target === drag.section) {
        if (drag.placeholder) clearPlaceholder();
        return;
      }

      const list = editors.get(target).propertyListEl;
      if (!drag.placeholder) {
        drag.rowEl.style.display = "none";
        drag.placeholder = createDiv({ cls: "metadata-property drag-ghost-hidden typ-drag-placeholder" });
        drag.placeholder.style.height = `${drag.height}px`;
      }
      // Drop spot as Obsidian does it: before the first row whose middle is
      // below the cursor.
      const rows = [...list.children].filter((el) => el !== drag.placeholder && el !== drag.spacer);
      const before = rows.find((el) => {
        const rect = el.getBoundingClientRect();
        return event.clientY < rect.top + rect.height / 2;
      });
      drag.target = { section: target, index: before ? rows.indexOf(before) : rows.length };
      list.insertBefore(drag.placeholder, before ?? null);
    };

    const onWinUp = () => {
      if (!drag) return;
      const { spacer, placeholder, rowEl, target } = drag;
      drag = null;
      drop = target;
      placeholder?.remove();
      rowEl.style.removeProperty("display");
      // Only after Obsidian finishes its drag: it still reads the drop spot
      // in the source block from the child list, where the spacer marks the
      // last position.
      wrapper.win.setTimeout(() => spacer.remove(), 0);
    };

    wrapper.win.addEventListener("mousemove", onWinMove, true);
    wrapper.win.addEventListener("mouseup", onWinUp, true);
    anchor.register(() => {
      wrapper.win.removeEventListener("mousemove", onWinMove, true);
      wrapper.win.removeEventListener("mouseup", onWinUp, true);
    });

    for (const [section, editor] of editors) {
      const originalReorderKey = editor.reorderKey;
      editor.reorderKey = function (entry, index) {
        const target = drop;
        drop = null;
        if (!target) return originalReorderKey.call(this, entry, index);
        moveProperty(section, target.section, entry.key, target.index);
      };
    }
  }

  // Moves key from block `from` to block `to` at position index. If the target
  // already has the name (unique within a block), the two merge: the existing
  // entry keeps position, value, floating flag and shortcut; only an empty
  // value is filled from the dragged one - same rule as mergeSubtyps
  // (subtyps.js) and renameInStore (property-rename-sync.js).
  async function moveProperty(from, to, key, index) {
    const source = stores.get(from);
    const target = stores.get(to);
    if (!source || !target || from === to) return;

    const sourceFrontmatter = { ...source.getFrontmatter() };
    const value = sourceFrontmatter[key];
    const wasFloating = source.getFloating().includes(key);
    // The shortcut belongs to the key and moves with it.
    const sourceShortcuts = { ...source.getShortcuts() };
    const shortcut = sourceShortcuts[key] ?? null;
    delete sourceShortcuts[key];
    delete sourceFrontmatter[key];
    source.setFrontmatter(sourceFrontmatter);
    source.setFloating(source.getFloating().filter((k) => k !== key));
    source.setShortcuts(sourceShortcuts);

    const targetFrontmatter = target.getFrontmatter();
    const existing = Object.keys(targetFrontmatter).find((k) => k.toLowerCase() === key.toLowerCase());
    if (existing !== undefined) {
      if (isEmptyValue(targetFrontmatter[existing])) target.setFrontmatter({ ...targetFrontmatter, [existing]: value });
    } else {
      const keys = Object.keys(targetFrontmatter);
      const at = Math.max(0, Math.min(index, keys.length));
      const next = {};
      for (const k of keys.slice(0, at)) next[k] = targetFrontmatter[k];
      next[key] = value;
      for (const k of keys.slice(at)) next[k] = targetFrontmatter[k];
      target.setFrontmatter(next);
      if (wasFloating) target.setFloating([...target.getFloating(), key]);
      if (shortcut) target.setShortcuts({ ...target.getShortcuts(), [key]: shortcut });
    }

    await view.plugin.saveSettings();
    // Re-renders this detail view among others; blocks and editors are rebuilt
    // from the settings.
    view.plugin.refreshTypColors?.();
  }
}

module.exports = { mountFrontmatterBlocks };
