const { mountFrontmatterEditor, ensurePropertyMenuPatch } = require("./type-frontmatter-editor");
const { getSubtypeNames, getSubtype, ensureSubtype } = require("./subtypes");

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

  const sections = () => [null, ...getSubtypeNames(plugin.settings, type)];

  // Kommt ein Key (aus älteren Daten) in mehreren Blöcken vor, gewinnt der
  // erste - siehe auch enforceUniqueKeys in subtypes.js.
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
    add(plugin.settings.typeDefaultFrontmatter[type], null);
    for (const subtype of getSubtypeNames(plugin.settings, type)) add(getSubtype(plugin.settings, type, subtype)?.frontmatter, subtype);
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
// füllen Überschrift bzw. Abschluss eines Blocks.
function mountUnifiedFrontmatterEditor(view, containerEl, type, { renderHeader, renderFooter }) {
  const store = unifiedStore(view.plugin, type);
  const wrapper = containerEl.createDiv({ cls: "fred-typ-unified" });
  const cardLayer = wrapper.createDiv({ cls: "fred-typ-unified-cards" });

  // Vor dem Mounten: mountFrontmatterEditor() ruft synchronize() schon selbst
  // auf - der Prototyp wird deshalb erst danach je Instanz umhüllt, und das
  // erste Einsetzen der Blöcke unten explizit nachgeholt.
  const editor = mountFrontmatterEditor(view, wrapper, store);
  if (!editor) return null;
  const listEl = editor.propertyListEl;

  const layoutCards = () => {
    cardLayer.empty();
    const base = wrapper.getBoundingClientRect();
    for (const header of listEl.querySelectorAll(":scope > .fred-typ-section-header.fred-typ-section-sub")) {
      const footer = header.fredFooter;
      if (!footer?.isConnected) continue;
      const top = header.getBoundingClientRect().top - base.top;
      const bottom = footer.getBoundingClientRect().bottom - base.top;
      const card = cardLayer.createDiv({ cls: "fred-typ-unified-card" });
      card.style.top = `${top}px`;
      card.style.height = `${bottom - top}px`;
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
