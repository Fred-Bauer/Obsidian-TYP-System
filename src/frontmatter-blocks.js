const { mountFrontmatterEditor, addBlankProperty, typeStore, subtypeStore } = require("./type-frontmatter-editor");
const { getSectionOrder } = require("./subtypes");

/* ============================================================
 * Die Frontmatter-Blöcke eines TYPs in der TYP-Detailansicht (siehe
 * renderTypeSettings in typ-view.js): zuoberst das TYP-Frontmatter, darunter
 * je registriertem Subtyp ein eigener Block.
 *
 * Je Block eine eigene Instanz von Obsidians Property-Editor, gebunden an
 * typeStore bzw. subtypeStore (siehe type-frontmatter-editor.js). Dadurch
 * darf derselbe Key in mehreren Blöcken stehen - innerhalb eines Blocks ist
 * er durch das Frontmatter-Objekt selbst zwangsläufig eindeutig, darüber
 * hinaus nicht (siehe Kommentar an typeSubtypes in subtypes.js).
 *
 * Der Preis dafür: Obsidians eigenes Drag & Drop reicht nur innerhalb einer
 * Instanz, eine Property lässt sich also nicht mehr von Block zu Block
 * ziehen. Was blockübergreifend weiterläuft, ist die Tastatur-Navigation -
 * siehe onShiftFocus unten.
 *
 * Section: null = TYP-Frontmatter, sonst der Subtyp-Name.
 * ============================================================ */

// Anfassbar für das Verschieben eines ganzen Blocks ist alles außerhalb der
// Property-Zeilen - Überschrift, Abschluss und die seitlichen Ränder.
// Bedienelemente und ein gerade bearbeiteter Titel bleiben ausgenommen.
function isGrabTarget(target) {
  if (target.closest(".clickable-icon, .fred-typ-subtype-color-dot, [contenteditable='true'], input, textarea")) return false;
  return !target.closest(".metadata-property");
}

// renderHeader(section, el, blocks) / renderFooter(section, el, blocks) füllen
// Überschrift bzw. Abschluss eines Blocks. onMoveSection(order) meldet die
// neue Block-Reihenfolge nach einem Block-Drag (wie getSectionOrder, samt
// führendem null für das TYP-Frontmatter), onSectionContextMenu(section,
// event) einen Rechtsklick in einem Subtyp-Block.
function mountFrontmatterBlocks(view, containerEl, type, { renderHeader, renderFooter, onMoveSection, onSectionContextMenu }) {
  const wrapper = containerEl.createDiv({ cls: "fred-typ-blocks" });
  const sections = getSectionOrder(view.plugin.settings, type);
  const editors = new Map();
  const blockEls = new Map();

  const api = {
    // Alle Editor-Instanzen in Block-Reihenfolge - typ-view.js hängt sie als
    // Component-Children ein und baut sie vor jedem Neuaufbau wieder ab.
    editors: [],
    // Leerzeile am Ende des gewünschten Blocks anlegen, mit dem Fokus im
    // Key-Feld (siehe addBlankProperty in type-frontmatter-editor.js).
    // floating markiert die als nächstes benannte Property als Floating.
    addBlank(section, floating = false) {
      const editor = editors.get(section);
      if (!editor) return;
      editor.fredPendingFloatingAdd = floating;
      addBlankProperty(editor);
    },
  };

  // Nachbarblock in Richtung step, der überhaupt eine Zeile zum Anspringen
  // hat - leere Blöcke werden übersprungen.
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
      cls: "fred-typ-block" + (isSub ? " fred-typ-frontmatter-block fred-typ-subtype-block" : ""),
    });
    blockEls.set(section, blockEl);

    const header = blockEl.createDiv({ cls: "fred-typ-frontmatter-header fred-typ-section-header" });
    header.toggleClass("fred-typ-section-sub", isSub);

    const store = section === null ? typeStore(view.plugin, type) : subtypeStore(view.plugin, type, section);
    const editor = mountFrontmatterEditor(view, blockEl, store, {
      onShiftFocus: (step) => focusNeighbor(section, step),
    });
    if (editor) {
      editors.set(section, editor);
      api.editors.push(editor);
    }

    const footer = blockEl.createDiv({ cls: "fred-typ-section-footer" });
    footer.toggleClass("fred-typ-section-sub", isSub);
    renderHeader(section, header, api);
    renderFooter?.(section, footer, api);

    if (!isSub) continue;
    // Subtyp-Blöcke reagieren auf ihrer ganzen Fläche; Obsidians eigene Menüs
    // (z. B. das einer Property) und Textfelder haben Vorrang - sie reagieren
    // vorher und setzen defaultPrevented.
    blockEl.addEventListener("contextmenu", (event) => {
      if (event.defaultPrevented || event.target.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      onSectionContextMenu?.(section, event);
    });
    blockEl.addEventListener("mousedown", (event) => startBlockDrag(event, section));
  }

  // Eigenes Maus-Drag statt HTML5-draggable: ein draggable-Vorfahre störte die
  // Textauswahl in den Eingabefeldern der Zeilen. Der Drag beginnt erst nach
  // ein paar Pixeln Bewegung, ein Strich in Akzentfarbe zeigt die
  // Zielposition zwischen den Blöcken, Escape bricht ab. Das TYP-Frontmatter
  // steht fest ganz oben (siehe getSectionOrder in subtypes.js) - Zielposition
  // 0 gibt es deshalb nicht, der oberste mögliche Platz ist direkt darunter.
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
        wrapper.doc.body.addClass("fred-typ-block-dragging");
        win.getSelection()?.removeAllRanges();
        blockEls.get(section).addClass("is-dragging");
        measure();
        indicator = wrapper.createDiv({ cls: "fred-typ-block-drop-indicator" });
      }
      moveEvent.preventDefault();
      const y = moveEvent.clientY - wrapper.getBoundingClientRect().top;
      targetIndex = Math.max(1, boxes.filter((box) => (box.top + box.bottom) / 2 < y).length);
      const from = boxes.findIndex((box) => box.section === section);
      indicator.toggle(targetIndex !== from && targetIndex !== from + 1);
      // Mitte der Lücke zwischen zwei Blöcken (Abstand siehe
      // .fred-typ-block + .fred-typ-block in styles.css).
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
      wrapper.doc.body.removeClass("fred-typ-block-dragging");
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

  return api;
}

module.exports = { mountFrontmatterBlocks };
