const { mountFrontmatterEditor, addBlankProperty, typeStore, subtypeStore } = require("./type-frontmatter-editor");
const { getSectionOrder, isEmptyValue } = require("./subtypes");

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
 * Obsidians eigenes Zeilen-Drag reicht nur innerhalb einer Instanz. Damit
 * eine Property trotzdem von Block zu Block wandern kann, setzt
 * registerPropertyDrag() unten auf genau diesem Drag auf, statt ein eigenes
 * zu bauen. Die Tastatur-Navigation über alle Blöcke steckt in
 * registerFocusChain() (type-frontmatter-editor.js).
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
  const stores = new Map();

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
    blockEl.fredSection = section;

    const header = blockEl.createDiv({ cls: "fred-typ-frontmatter-header fred-typ-section-header" });
    header.toggleClass("fred-typ-section-sub", isSub);

    const store = section === null ? typeStore(view.plugin, type) : subtypeStore(view.plugin, type, section);
    stores.set(section, store);
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

  registerPropertyDrag();
  return api;

  /* --- Eine Property in einen anderen Block ziehen ------------------------
   * Aufgesetzt auf Obsidians eigenes Zeilen-Drag (Gv im gebauten app.js),
   * statt ein zweites danebenzustellen: das hängt am Typ-Icon der Zeile
   * (.metadata-property-icon), legt einen .drag-reorder-ghost an den Body -
   * der folgt dem Cursor also ohnehin über Blockgrenzen hinweg - und
   * markiert die Ursprungszeile mit .drag-ghost-hidden, Obsidians eigenem
   * Akzent-Rechteck, das die Einfügestelle zeigt. Innerhalb eines Blocks
   * macht Obsidian damit unverändert alles selbst. Dazu kommt hier nur:
   *
   *  - ein leeres Zusatzkind in der Liste, solange gezogen wird: Obsidian
   *    startet den Drag sonst gar nicht, wenn ein Block nur eine einzige
   *    Zeile hat (Prüfung n.firstChild !== n.lastChild beim mousedown);
   *  - ein Platzhalter mit derselben Klasse .drag-ghost-hidden im Zielblock,
   *    sobald der Cursor einen fremden Block erreicht - die Ursprungszeile
   *    wird solange ausgeblendet, damit nicht zwei Rechtecke stehen;
   *  - reorderKey je Instanz, das beim Loslassen über einem fremden Block
   *    die Property dorthin umhängt, statt innerhalb des eigenen zu sortieren.
   *
   * Die eigenen Handler laufen in der Capture-Phase am Fenster und damit vor
   * Obsidians eigenen (die es in seinem mousedown-Handler auf window legt).
   * -------------------------------------------------------------------- */
  function registerPropertyDrag() {
    // Ohne einen zweiten Block gibt es kein Ziel - dann bleibt Obsidians
    // eigenes Drag völlig unangetastet.
    const anchor = api.editors[0];
    if (!anchor || sections.length < 2) return;

    // Läuft ein Drag, hält dies dessen Zustand; drop merkt sich beim
    // Loslassen das Ziel für das anschließende reorderKey.
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
        const section = rowEl?.closest(".fred-typ-block")?.fredSection;
        const editor = section === undefined ? null : editors.get(section);
        const key = editor?.rendered.find((row) => row.containerEl === rowEl)?.entry.key;
        // Eine noch unbenannte Zeile hat in einem anderen Block nichts zu
        // suchen - sie bleibt Obsidians eigener Sortierung überlassen.
        if (!key) return;
        drag = {
          section,
          key,
          rowEl,
          // Jetzt schon gemessen: sobald die Zeile für den Platzhalter
          // ausgeblendet ist, liefert offsetHeight 0.
          height: rowEl.offsetHeight,
          spacer: editor.propertyListEl.createDiv({ cls: "fred-typ-drag-spacer" }),
          placeholder: null,
          target: null,
        };
        drop = null;
      },
      true
    );

    // Am Fenster registriert, damit ein Drag auch außerhalb der Blöcke
    // weiterverfolgt wird - abgeräumt mit dem ersten Editor, der beim
    // nächsten Neuaufbau der Detailansicht entladen wird (siehe
    // destroyFrontmatterEditor in typ-view.js).
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
        drag.placeholder = createDiv({ cls: "metadata-property drag-ghost-hidden fred-typ-drag-placeholder" });
        drag.placeholder.style.height = `${drag.height}px`;
      }
      // Einfügestelle wie bei Obsidian selbst: vor der ersten Zeile, deren
      // Mitte unterhalb des Cursors liegt.
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
      // Erst nach Obsidians eigenem Drag-Abschluss: der bestimmt die
      // Einfügestelle innerhalb des Ausgangsblocks noch über die Kinderliste,
      // in der das Zusatzkind die letzte Position markiert.
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

  // Hängt key aus dem Block from in den Block to um, dort an Position index.
  // Führt das Ziel den Namen bereits (innerhalb eines Blocks muss er eindeutig
  // bleiben), werden beide zusammengelegt: der bestehende Eintrag behält
  // Position, Wert und Floating-Markierung, nur ein leerer Wert wird aus der
  // gezogenen Property gefüllt - dieselbe Regel wie bei mergeSubtypes
  // (subtypes.js) und renameInStore (property-rename-sync.js).
  async function moveProperty(from, to, key, index) {
    const source = stores.get(from);
    const target = stores.get(to);
    if (!source || !target || from === to) return;

    const sourceFrontmatter = { ...source.getFrontmatter() };
    const value = sourceFrontmatter[key];
    const wasFloating = source.getFloating().includes(key);
    delete sourceFrontmatter[key];
    source.setFrontmatter(sourceFrontmatter);
    source.setFloating(source.getFloating().filter((k) => k !== key));

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
    }

    await view.plugin.saveSettings();
    // Rendert u. a. diese Detailansicht neu (siehe registerTypView) - die
    // Blöcke entstehen dabei samt Editoren frisch aus den Einstellungen.
    view.plugin.refreshTypColors?.();
  }
}

module.exports = { mountFrontmatterBlocks };
