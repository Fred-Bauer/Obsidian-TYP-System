const { mountFrontmatterEditor, ensurePropertyMenuPatch } = require("./type-frontmatter-editor");
const { getSubtypeNames, getSubtype, ensureSubtype, getSectionOrder } = require("./subtypes");

/* ============================================================
 * Ein einziger Property-Editor für das Standard-Frontmatter eines TYPs und
 * alle seine Subtyp-Blöcke (TYP-Detailansicht, siehe renderTypeSettings in
 * typ-view.js).
 *
 * Jeder Key gehört zu genau einem Block (Standard-Frontmatter ODER ein
 * Subtyp) - in einem gemeinsamen Objekt ist das automatisch gewährleistet,
 * und Obsidians eigenes Drag & Drop (samt Auto-Scroll und Tastatur-
 * Navigation) reicht so über alle Blöcke hinweg.
 *
 * Die Blöcke selbst sind nur Optik: Überschrift und Abschluss je Block sind
 * eigene Elemente, die nach jedem synchronize() zwischen Obsidians Zeilen
 * eingesetzt werden (synchronize() räumt fremde Elemente per
 * setChildrenInPlace aus der Liste). Die Kartenfläche der Subtyp-Blöcke liegt
 * als eigene Ebene HINTER der Liste, von der Überschrift bis zum Abschluss -
 * so bleiben die Hover-/Fokus-Hintergründe der Zeilen unangetastet.
 *
 * Section: null = Standard-Frontmatter, sonst der Subtyp-Name.
 * ============================================================ */

// Speicher-Schnittstelle wie typeStore/subtypeStore (type-frontmatter-editor.js),
// aber über alle Blöcke eines TYPs. layout ordnet jedem Key seinen Block zu;
// "" steht für eine gerade angelegte, noch unbenannte Zeile (siehe addBlank).
function unifiedStore(plugin, type) {
  const layout = new Map();
  let current = {};

  const sections = () => getSectionOrder(plugin.settings, type);

  // Kommt ein Key (aus älteren Daten) in mehreren Blöcken vor, gewinnt der
  // erste - siehe auch enforceUniqueKeys in subtypes.js. Das Objekt entsteht
  // in Block-Reihenfolge, damit die Zeilen blockweise stehen (injectSections).
  const load = () => {
    layout.clear();
    current = {};
    const seen = new Set();
    const add = (frontmatter, section) => {
      for (const [key, value] of Object.entries(frontmatter ?? {})) {
        if (key === "" || seen.has(key.toLowerCase())) continue;
        seen.add(key.toLowerCase());
        current[key] = value;
        layout.set(key, section);
      }
    };
    for (const section of sections()) {
      add(section === null ? plugin.settings.typeDefaultFrontmatter[type] : getSubtype(plugin.settings, type, section)?.frontmatter, section);
    }
  };
  load();

  const sectionOf = (key) => (layout.has(key) ? layout.get(key) : null);

  return {
    type,
    subtype: null,
    unified: true,
    layout,
    sections,
    sectionOf,
    getFrontmatter: () => current,

    // Verteilt das vollständige Property-Set wieder auf die Blöcke. Neue Keys
    // landen im Block der zuvor angelegten Leerzeile (layout ""), eine
    // Umbenennung (genau ein Key weg, einer neu) behält den Block, sonst
    // entscheidet der davor stehende Key.
    setFrontmatter(frontmatter) {
      const keys = Object.keys(frontmatter);
      const removed = [...layout.keys()].filter((key) => key !== "" && !Object.hasOwn(frontmatter, key));
      const added = keys.filter((key) => key !== "" && !layout.has(key));
      if (removed.length === 1 && added.length === 1) {
        layout.set(added[0], layout.get(removed[0]));
      } else {
        for (const key of added) {
          if (layout.has("")) {
            layout.set(key, layout.get(""));
          } else {
            const before = keys.slice(0, keys.indexOf(key)).reverse().find((k) => layout.has(k));
            layout.set(key, before === undefined ? null : layout.get(before));
          }
        }
      }
      for (const key of removed) layout.delete(key);
      if (!Object.hasOwn(frontmatter, "")) layout.delete("");

      const blocks = new Map(sections().map((section) => [section, {}]));
      for (const key of keys) {
        if (key === "") continue;
        (blocks.get(sectionOf(key)) ?? blocks.get(null))[key] = frontmatter[key];
      }
      plugin.settings.typeDefaultFrontmatter[type] = blocks.get(null);
      for (const subtype of getSubtypeNames(plugin.settings, type)) {
        ensureSubtype(plugin.settings, type, subtype).frontmatter = blocks.get(subtype);
      }
      current = frontmatter;
    },

    getFloating() {
      return [
        ...(plugin.settings.typeFloatingKeys[type] ?? []),
        ...getSubtypeNames(plugin.settings, type).flatMap((subtype) => getSubtype(plugin.settings, type, subtype)?.floatingKeys ?? []),
      ];
    },

    setFloating(keys) {
      const bySection = new Map(sections().map((section) => [section, []]));
      for (const key of keys) (bySection.get(sectionOf(key)) ?? bySection.get(null)).push(key);
      const typeKeys = bySection.get(null);
      if (typeKeys.length > 0) plugin.settings.typeFloatingKeys[type] = typeKeys;
      else delete plugin.settings.typeFloatingKeys[type];
      for (const subtype of getSubtypeNames(plugin.settings, type)) {
        ensureSubtype(plugin.settings, type, subtype).floatingKeys = bySection.get(subtype);
      }
    },
  };
}

// renderHeader(section, el, editor) / renderFooter(section, el, editor)
// füllen Überschrift bzw. Abschluss eines Blocks. onMoveSection(order) meldet
// die neue Block-Reihenfolge nach einem Block-Drag (wie getSectionOrder, samt
// null für das Standard-Frontmatter), onSectionContextMenu(section, event)
// einen Rechtsklick in einem Subtyp-Block.
function mountUnifiedFrontmatterEditor(view, containerEl, type, { renderHeader, renderFooter, onMoveSection, onSectionContextMenu }) {
  const store = unifiedStore(view.plugin, type);
  const wrapper = containerEl.createDiv({ cls: "fred-typ-unified" });
  const cardLayer = wrapper.createDiv({ cls: "fred-typ-unified-cards" });

  // Vor dem Mounten: mountFrontmatterEditor() ruft synchronize() schon selbst
  // auf - der Prototyp wird deshalb erst danach je Instanz umhüllt, und das
  // erste Einsetzen der Blöcke unten explizit nachgeholt.
  const editor = mountFrontmatterEditor(view, wrapper, store);
  if (!editor) return null;
  const listEl = editor.propertyListEl;

  // Alle Blöcke in Anzeigereihenfolge, je { section, top, bottom, el } relativ
  // zum wrapper - el ist die Kartenfläche (nur Subtyp-Blöcke, das Standard-
  // Frontmatter bleibt transparent). Zugleich Grundlage für Hover, Rechtsklick
  // und Block-Drag (siehe unten).
  let blocks = [];
  let hoveredSection;
  let dragSection;

  const layoutCards = () => {
    cardLayer.empty();
    blocks = [];
    const base = wrapper.getBoundingClientRect();
    for (const header of listEl.querySelectorAll(":scope > .fred-typ-section-header")) {
      const footer = header.fredFooter;
      if (!footer?.isConnected) continue;
      const section = header.fredSection;
      const top = header.getBoundingClientRect().top - base.top;
      const bottom = footer.getBoundingClientRect().bottom - base.top;
      let el = null;
      if (section !== null) {
        el = cardLayer.createDiv({ cls: "fred-typ-unified-card" });
        el.style.top = `${top}px`;
        el.style.height = `${bottom - top}px`;
        el.toggleClass("is-hovered", section === hoveredSection && dragSection === undefined);
        el.toggleClass("is-dragging", section === dragSection);
      }
      blocks.push({ section, top, bottom, el });
    }
  };

  // Setzt Überschrift und Abschluss je Block zwischen Obsidians Zeilen, OHNE
  // die Zeilen selbst umzuhängen: eine verschobene Zeile mit Fokus verlöre
  // ihn kurz, und Obsidians Blur-Handler (z. B. Entfernen einer leeren Zeile)
  // änderte die Liste mitten im Einfügen. Voraussetzung ist, dass die Zeilen
  // blockweise in Block-Reihenfolge stehen - dafür sorgen die Objekte, die
  // hier ankommen (siehe unifiedStore, reorderKey, fredAddBlank). Nur falls
  // das doch einmal nicht zutrifft, wird die Liste komplett neu geordnet.
  let injected = [];
  let injecting = false;
  const injectSections = () => {
    // Wird die Ansicht gerade abgebaut, löst der Blur einer Zeile noch ein
    // synchronize() aus - dann gibt es nichts mehr einzusetzen.
    if (injecting || !listEl.isConnected) return;
    injecting = true;
    try {
      for (const el of injected) el.detach();
      injected = [];

      const sections = store.sections();
      const rows = [...listEl.children];
      const rowsBySection = new Map(sections.map((section) => [section, []]));
      for (const rowEl of rows) {
        const row = editor.rendered.find((r) => r.containerEl === rowEl);
        const section = store.sectionOf(row?.entry.key);
        (rowsBySection.get(section) ?? rowsBySection.get(null)).push(rowEl);
      }
      const ordered = [...rowsBySection.values()].flat();
      const inOrder = ordered.every((rowEl, i) => rowEl === rows[i]);

      let anchor = listEl.firstChild;
      for (const [section, sectionRows] of rowsBySection) {
        const sub = section !== null;
        const header = createDiv({ cls: "fred-typ-frontmatter-header fred-typ-section-header" });
        const footer = createDiv({ cls: "fred-typ-section-footer" });
        header.toggleClass("fred-typ-section-sub", sub);
        footer.toggleClass("fred-typ-section-sub", sub);
        header.fredSection = section;
        header.fredFooter = footer;
        renderHeader(section, header, editor);
        renderFooter?.(section, footer, editor);
        injected.push(header, footer);
        for (const rowEl of sectionRows) rowEl.toggleClass("fred-typ-section-sub", sub);

        if (!inOrder) continue;
        listEl.insertBefore(header, anchor);
        if (sectionRows.length > 0) anchor = sectionRows[sectionRows.length - 1].nextSibling;
        listEl.insertBefore(footer, anchor);
      }

      if (!inOrder) {
        const children = [];
        for (let i = 0; i < injected.length; i += 2) {
          const header = injected[i];
          children.push(header, ...rowsBySection.get(header.fredSection), injected[i + 1]);
        }
        listEl.setChildrenInPlace(children);
      }
    } finally {
      injecting = false;
    }
    layoutCards();
  };

  const originalSynchronize = editor.synchronize;
  editor.synchronize = function (frontmatter) {
    originalSynchronize.call(this, frontmatter);
    injectSections();
  };

  // Obsidian meldet nach einem Drag die Ziel-Position als Index unter ALLEN
  // Kindern der Liste (Überschriften/Abschlüsse zählen mit) und hat die Zeile
  // zu diesem Zeitpunkt bereits im DOM verschoben. Reihenfolge und Block-
  // Zuordnung werden deshalb direkt aus dem DOM abgelesen: jede Zeile gehört
  // zum Block der letzten Überschrift davor.
  editor.reorderKey = function () {
    const serialized = this.serialize();
    const frontmatter = {};
    let section = null;
    for (const el of listEl.children) {
      if (el.hasClass("fred-typ-section-header")) {
        section = el.fredSection;
        continue;
      }
      const row = this.rendered.find((r) => r.containerEl === el);
      if (!row) continue;
      frontmatter[row.entry.key] = serialized[row.entry.key];
      store.layout.set(row.entry.key, section);
    }
    this.owner.saveFrontmatter(frontmatter);
  };

  // Leerzeile am Ende des gewünschten Blocks anlegen (statt am Ende der Liste
  // wie addBlankProperty) - ihr Key "" merkt sich den Block, bis sie benannt
  // ist. Das Objekt wird dabei blockweise aufgebaut, damit die Zeilen in
  // Block-Reihenfolge stehen (siehe injectSections).
  editor.fredAddBlank = function (section, floating = false) {
    this.fredPendingFloatingAdd = floating;
    store.layout.set("", section);
    const current = this.serialize();
    const next = {};
    for (const s of store.sections()) {
      for (const [key, value] of Object.entries(current)) {
        if (key !== "" && store.sectionOf(key) === s) next[key] = value;
      }
      if (s === section) next[""] = null;
    }
    this.synchronize(next);
    this.focusKey("");
    ensurePropertyMenuPatch(view.app, this);
  };

  // --- Hover, Rechtsklick und Verschieben ganzer Subtyp-Blöcke --------------
  // Alles über die Blockflächen (siehe layoutCards), da ein Block kein eigenes
  // Element ist. Hover und Rechtsklick (Suche nach den Notizen des Subtyps)
  // gelten im ganzen Subtyp-Block. Angefasst wird ein Block überall außerhalb
  // seiner Property-Zeilen: Überschrift, Abschluss und die seitlichen Ränder
  // (dort ist die Liste selbst das Ziel); Buttons und ein gerade bearbeiteter
  // Titel bleiben ausgenommen. Das Standard-Frontmatter selbst ist nicht
  // verschiebbar, Subtypen dürfen aber auch darüber liegen.
  const blockAt = (event) => {
    const y = event.clientY - wrapper.getBoundingClientRect().top;
    return blocks.find((block) => y >= block.top && y <= block.bottom) ?? null;
  };
  const subtypeBlockAt = (event) => {
    const block = blockAt(event);
    return block?.section != null ? block : null;
  };

  const isGrabTarget = (target) => {
    if (target.closest(".clickable-icon, [contenteditable='true'], input, textarea")) return false;
    if (target === listEl) return true;
    return !!target.closest(".fred-typ-section-header.fred-typ-section-sub, .fred-typ-section-footer.fred-typ-section-sub");
  };

  const setHovered = (section) => {
    if (section === hoveredSection) return;
    hoveredSection = section;
    for (const block of blocks) block.el?.toggleClass("is-hovered", block.section === section && dragSection === undefined);
  };

  // Überschrift, Zeilen und Abschluss eines Blocks (für die abgeblendete
  // Darstellung des gerade gezogenen Blocks).
  const markSection = (section) => {
    let current = null;
    for (const el of listEl.children) {
      if (el.hasClass("fred-typ-section-header")) current = el.fredSection;
      el.toggleClass("fred-typ-block-drag-source", section !== undefined && current === section);
    }
  };

  wrapper.addEventListener("mousemove", (event) => {
    if (dragSection === undefined) setHovered(subtypeBlockAt(event)?.section);
  });
  wrapper.addEventListener("mouseleave", () => setHovered(undefined));

  // Obsidians eigene Menüs (z. B. das einer Property) und Textfelder haben
  // Vorrang - sie reagieren vorher und setzen defaultPrevented.
  wrapper.addEventListener("contextmenu", (event) => {
    if (event.defaultPrevented || event.target.closest("input, textarea, [contenteditable='true']")) return;
    const block = subtypeBlockAt(event);
    if (!block) return;
    event.preventDefault();
    onSectionContextMenu?.(block.section, event);
  });

  // Eigenes Maus-Drag statt HTML5-draggable: ein draggable-Vorfahre störte die
  // Textauswahl in den Eingabefeldern der Zeilen. Der Drag beginnt erst nach
  // ein paar Pixeln Bewegung, ein Strich in Akzentfarbe zeigt die Zielposition
  // zwischen den Blöcken, Escape bricht ab.
  wrapper.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || !isGrabTarget(event.target)) return;
    const startBlock = subtypeBlockAt(event);
    if (!startBlock) return;
    const win = wrapper.win;
    const startY = event.clientY;
    let indicator = null;
    let targetIndex = null;

    const onMove = (moveEvent) => {
      if (dragSection === undefined) {
        if (Math.abs(moveEvent.clientY - startY) < 4) return;
        dragSection = startBlock.section;
        setHovered(undefined);
        wrapper.doc.body.addClass("fred-typ-block-dragging");
        win.getSelection()?.removeAllRanges();
        markSection(dragSection);
        layoutCards();
        indicator = wrapper.createDiv({ cls: "fred-typ-unified-drop-indicator" });
      }
      moveEvent.preventDefault();
      if (blocks.length === 0) return;
      const y = moveEvent.clientY - wrapper.getBoundingClientRect().top;
      targetIndex = blocks.filter((block) => (block.top + block.bottom) / 2 < y).length;
      const from = blocks.findIndex((block) => block.section === dragSection);
      indicator.toggle(targetIndex !== from && targetIndex !== from + 1);
      // Mitte der Lücke zwischen zwei Blöcken (Abstand siehe
      // .fred-typ-section-header:not(:first-child) in styles.css).
      const halfGap = 6;
      const gapY =
        targetIndex === 0
          ? blocks[0].top - halfGap
          : targetIndex === blocks.length
            ? blocks[blocks.length - 1].bottom + halfGap
            : (blocks[targetIndex - 1].bottom + blocks[targetIndex].top) / 2;
      indicator.style.top = `${gapY - 1}px`;
    };

    const end = (commit) => {
      win.removeEventListener("mousemove", onMove);
      win.removeEventListener("mouseup", onUp);
      win.removeEventListener("keydown", onKey, true);
      if (dragSection === undefined) return;
      const section = dragSection;
      dragSection = undefined;
      wrapper.doc.body.removeClass("fred-typ-block-dragging");
      indicator?.remove();
      markSection(undefined);
      layoutCards();

      const order = blocks.map((block) => block.section);
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
  });

  // Karten folgen jeder Änderung der Liste - auch live während eines Drags,
  // bei dem Obsidian die Zeile laufend im DOM umhängt.
  const mutationObserver = new MutationObserver(() => layoutCards());
  mutationObserver.observe(listEl, { childList: true });
  const resizeObserver = new ResizeObserver(() => layoutCards());
  resizeObserver.observe(wrapper);
  editor.register(() => {
    mutationObserver.disconnect();
    resizeObserver.disconnect();
  });

  injectSections();
  return editor;
}

module.exports = { mountUnifiedFrontmatterEditor };
