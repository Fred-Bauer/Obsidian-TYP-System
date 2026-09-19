const { Notice, setIcon } = require("obsidian");
const { normalizeTypeName, compareTypes } = require("./type-utils");

const SUBTYP_PROPERTY = "SUBTYP";
const TYP_PROPERTY = "TYP";
// SUBTYPen haben (anders als TYPen) keine eigene Farbe - sortiert wird daher
// immer nach Häufigkeit, ohne Auswahlmenü wie bei der TYP-Liste.
const SORT_MODE = "count-desc";

// getXxx() lesen nur (kein Schreibzugriff auf plugin.settings) - für Render-
// Pfade, die bei jedem Öffnen/Wechseln eines TYPs laufen. ensureXxx() legen bei
// Bedarf fehlende Container an und geben eine mutierbare Referenz zurück - nur
// für tatsächliche Schreibvorgänge (Anlegen/Registrieren eines Subtyps, Ändern
// einer Beschreibung). Wichtig, dass beide getrennt bleiben: ensureSubtypeList()
// aus einem Render-Pfad heraus aufgerufen legte bislang für JEDEN geöffneten TYP
// beim bloßen Ansehen ein leeres Array in den Settings an (dauerhaft persistiert,
// sobald irgendeine andere Einstellung als Nächstes speichert) - reines Betrachten
// darf aber nie Daten schreiben.
function getSubtypeList(plugin, typ) {
  return plugin.settings.subtypesByType?.[typ] ?? [];
}

function getSubtypeDescription(plugin, typ, subtyp) {
  return plugin.settings.subtypeDescriptions?.[typ]?.[subtyp] ?? "";
}

function ensureSubtypesByType(plugin) {
  if (!plugin.settings.subtypesByType) plugin.settings.subtypesByType = {};
  return plugin.settings.subtypesByType;
}

function ensureSubtypeList(plugin, typ) {
  const byType = ensureSubtypesByType(plugin);
  if (!byType[typ]) byType[typ] = [];
  return byType[typ];
}

function ensureSubtypeDescriptions(plugin, typ) {
  if (!plugin.settings.subtypeDescriptions) plugin.settings.subtypeDescriptions = {};
  if (!plugin.settings.subtypeDescriptions[typ]) plugin.settings.subtypeDescriptions[typ] = {};
  return plugin.settings.subtypeDescriptions[typ];
}

// Scannt das gesamte Vault nach SUBTYP-Werten, gruppiert je TYP - eine Notiz
// ohne TYP hat konzeptionell auch keinen SUBTYP-Kontext und wird ignoriert,
// SUBTYP setzt immer einen TYP voraus (siehe addSubtypCommand in typ-view.js).
// Mehrfach-TYP bzw. Mehrfach-SUBTYP (Array-Werte) werden wie bei scanTypes()
// (typ-view.js) als Kreuzprodukt gezählt: eine Notiz mit zwei TYPen und einem
// SUBTYP zählt für beide TYP-Buckets.
function scanSubtypes(app, { includeIgnored = false } = {}) {
  const byType = new Map();
  const ensureBucket = (typ) => {
    let bucket = byType.get(typ);
    if (!bucket) {
      bucket = { counts: new Map(), noSubtype: 0 };
      byType.set(typ, bucket);
    }
    return bucket;
  };

  for (const file of app.vault.getMarkdownFiles()) {
    if (!includeIgnored && app.metadataCache.isUserIgnored(file.path)) continue;

    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    const typValue = frontmatter?.[TYP_PROPERTY];
    if (!typValue || (Array.isArray(typValue) && typValue.length === 0)) continue;

    const subValue = frontmatter?.[SUBTYP_PROPERTY];
    const subList =
      subValue == null || (Array.isArray(subValue) && subValue.length === 0)
        ? []
        : (Array.isArray(subValue) ? subValue : [subValue]).map((v) => String(v).trim()).filter(Boolean);

    for (const rawTyp of Array.isArray(typValue) ? typValue : [typValue]) {
      const typ = String(rawTyp).trim();
      if (!typ) continue;
      const bucket = ensureBucket(typ);
      if (subList.length === 0) bucket.noSubtype++;
      else for (const sub of subList) bucket.counts.set(sub, (bucket.counts.get(sub) ?? 0) + 1);
    }
  }
  return byType;
}

// Analog zu renameTypeInNotes() (typ-view.js), aber zusätzlich auf Notizen mit
// passendem TYP eingegrenzt - derselbe SUBTYP-Text unter einem anderen TYP
// bleibt unangetastet.
async function renameSubtypeInNotes(app, typ, oldValue, newValue, { includeIgnored = false } = {}) {
  let changed = 0;
  for (const file of app.vault.getMarkdownFiles()) {
    if (!includeIgnored && app.metadataCache.isUserIgnored(file.path)) continue;

    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    const typValue = frontmatter?.[TYP_PROPERTY];
    const typMatches = Array.isArray(typValue) ? typValue.includes(typ) : typValue === typ;
    if (!typMatches) continue;

    const subValue = frontmatter?.[SUBTYP_PROPERTY];
    const subMatches = Array.isArray(subValue) ? subValue.includes(oldValue) : subValue === oldValue;
    if (!subMatches) continue;

    await app.fileManager.processFrontMatter(file, (fm) => {
      const current = fm[SUBTYP_PROPERTY];
      if (Array.isArray(current)) {
        fm[SUBTYP_PROPERTY] = [...new Set(current.map((v) => (v === oldValue ? newValue : v)))];
      } else if (current === oldValue) {
        fm[SUBTYP_PROPERTY] = newValue;
      }
    });
    changed++;
  }
  return changed;
}

function openSubtypSearch(app, typ, subtyp) {
  const globalSearch = app.internalPlugins.getPluginById("global-search");
  if (!globalSearch) return;
  const typClause = `["${TYP_PROPERTY}":"${typ}"]`;
  const query = subtyp === null ? `${typClause} -["${SUBTYP_PROPERTY}"] file:.md` : `${typClause} ["${SUBTYP_PROPERTY}":"${subtyp}"]`;
  globalSearch.instance.openGlobalSearch(query);
}

// Eigenständige Teilkomponente statt eigener ItemView: wird von TypView
// (typ-view.js, siehe buildSplitPanes) in die untere Hälfte des geteilten
// View-Contents gemountet und bleibt dort unabhängig davon sichtbar, ob
// TypView selbst gerade die TYP-Liste oder eine TYP-Detailansicht zeigt.
// render(activeType) wird deshalb von TypView.render() bei jedem eigenen
// Neu-Rendern erneut aufgerufen, mit dessen aktuellem selectedType als
// activeType: null → TYP-Liste offen, SUBTYPen ungefiltert über alle TYPen
// hinweg (je Zeile mit TYP-Badge); ein TYP-Name → dessen Detailansicht offen,
// SUBTYPen auf genau diesen TYP gefiltert.
//
// Bewusst (noch) ohne eigene Detailansicht - SUBTYPen unterstützen aktuell
// nur Anlegen und (durch Anklicken) Registrieren, kein Umbenennen/Löschen/
// Standard-Frontmatter. Farbe gibt es für SUBTYPen grundsätzlich nicht.
class SubtypPane {
  constructor(typView, containerEl) {
    this.typView = typView;
    this.plugin = typView.plugin;
    this.app = typView.app;
    this.containerEl = containerEl;
    this.activeType = null;
    this.isEditing = false;
  }

  render(activeType) {
    this.activeType = activeType;
    this.isEditing = false;

    const { containerEl } = this;
    containerEl.empty();

    const header = containerEl.createDiv({ cls: "nav-header" });
    header.createDiv({ cls: "fred-typ-subtyp-title", text: "SUBTYP" });
    const buttonsContainer = header.createDiv({ cls: "nav-buttons-container" });

    const addBtn = buttonsContainer.createDiv({
      cls: "clickable-icon nav-action-button",
      attr: {
        "aria-label": activeType ? "Neuen Subtyp hinzufügen" : "Erst einen TYP öffnen, um Subtypen anzulegen",
      },
    });
    setIcon(addBtn, "plus");
    if (activeType) addBtn.addEventListener("click", () => this.startAdd());
    else addBtn.addClass("is-disabled");

    this.listEl = containerEl.createDiv({ cls: "fred-typ-list nav-files-container" });
    this.separatorEl = null;

    const byType = scanSubtypes(this.app, { includeIgnored: this.plugin.settings.includeIgnoredFiles });

    if (activeType) this.renderFilteredList(activeType, byType.get(activeType) ?? { counts: new Map(), noSubtype: 0 });
    else this.renderUnfilteredList(byType);
  }

  renderFilteredList(typ, bucket) {
    const registered = getSubtypeList(this.plugin, typ);
    const byCurrentOrder = (a, b) => compareTypes(SORT_MODE, a, b, bucket.counts, {});

    for (const subtyp of [...registered].sort(byCurrentOrder)) {
      this.renderRegisteredRow(typ, subtyp, bucket.counts.get(subtyp) ?? 0);
    }

    const unregistered = [...bucket.counts.keys()].filter((s) => !registered.includes(s)).sort(byCurrentOrder);
    const hasNoSubtype = bucket.noSubtype > 0;

    if (unregistered.length > 0 || hasNoSubtype) {
      this.separatorEl = this.listEl.createDiv({ cls: "fred-typ-separator" });
      for (const subtyp of unregistered) this.renderUnregisteredRow(typ, subtyp, bucket.counts.get(subtyp) ?? 0);
      if (hasNoSubtype) this.renderNoSubtypeRow(typ, bucket.noSubtype);
    }
  }

  // Ungefiltert (TYP-Liste offen, kein activeType): flache Übersicht aller
  // registrierten bzw. in Notizen vorkommenden (TYP, SUBTYP)-Paare, jede Zeile
  // zusätzlich mit einem TYP-Badge - anders als in renderFilteredList lässt
  // sich der zugehörige TYP hier nicht aus dem Kontext erschließen.
  renderUnfilteredList(byType) {
    const rows = [];
    const allTypes = new Set([...Object.keys(this.plugin.settings.subtypesByType ?? {}), ...byType.keys()]);
    for (const typ of allTypes) {
      const bucket = byType.get(typ) ?? { counts: new Map(), noSubtype: 0 };
      const registered = getSubtypeList(this.plugin, typ);
      for (const subtyp of registered) rows.push({ typ, subtyp, count: bucket.counts.get(subtyp) ?? 0, registered: true });
      for (const subtyp of bucket.counts.keys()) {
        if (!registered.includes(subtyp)) rows.push({ typ, subtyp, count: bucket.counts.get(subtyp) ?? 0, registered: false });
      }
    }

    rows.sort((a, b) => b.count - a.count || a.subtyp.localeCompare(b.subtyp) || a.typ.localeCompare(b.typ));

    for (const row of rows) {
      if (row.registered) this.renderRegisteredRow(row.typ, row.subtyp, row.count, { showType: true });
      else this.renderUnregisteredRow(row.typ, row.subtyp, row.count, { showType: true });
    }
  }

  renderRegisteredRow(typ, subtyp, count, { showType = false } = {}) {
    const treeItem = this.listEl.createDiv({ cls: "tree-item" });
    const self = treeItem.createDiv({ cls: "tree-item-self is-clickable" });
    self.createDiv({ cls: "tree-item-inner", text: subtyp });

    if (showType) {
      self.createSpan({ cls: "fred-typ-subtyp-type-badge", text: typ });
    } else {
      const descInput = self.createEl("input", { type: "text", cls: "fred-typ-list-description-input" });
      descInput.value = getSubtypeDescription(this.plugin, typ, subtyp);
      descInput.addEventListener("click", (event) => event.stopPropagation());
      descInput.addEventListener("change", async () => {
        const value = descInput.value.trim();
        // Container erst hier anlegen (statt schon beim Rendern) - reines
        // Anzeigen der Zeile darf die Settings nicht verändern.
        const descriptions = ensureSubtypeDescriptions(this.plugin, typ);
        if (value) descriptions[subtyp] = value;
        else delete descriptions[subtyp];
        await this.plugin.saveSettings();
      });
    }

    this.renderCountFlair(self, count);
    self.addEventListener("click", () => openSubtypSearch(this.app, typ, subtyp));
    self.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSubtypSearch(this.app, typ, subtyp);
    });
  }

  renderUnregisteredRow(typ, subtyp, count, { showType = false } = {}) {
    const treeItem = this.listEl.createDiv({ cls: "tree-item" });
    const self = treeItem.createDiv({ cls: "tree-item-self is-clickable fred-typ-unregistered" });
    self.createDiv({ cls: "tree-item-inner", text: subtyp });
    if (showType) self.createSpan({ cls: "fred-typ-subtyp-type-badge", text: typ });
    this.renderCountFlair(self, count);

    self.addEventListener("click", () => this.registerSubtype(typ, subtyp));
    self.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSubtypSearch(this.app, typ, subtyp);
    });
  }

  renderNoSubtypeRow(typ, count) {
    const treeItem = this.listEl.createDiv({ cls: "tree-item" });
    const self = treeItem.createDiv({ cls: "tree-item-self is-clickable fred-typ-unregistered" });
    self.createDiv({ cls: "tree-item-inner", text: "[KEIN SUBTYP]" });
    this.renderCountFlair(self, count);

    self.addEventListener("click", () => openSubtypSearch(this.app, typ, null));
    self.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSubtypSearch(this.app, typ, null);
    });
  }

  renderCountFlair(self, count) {
    const flairOuter = self.createDiv({ cls: "tree-item-flair-outer" });
    flairOuter.createSpan({ cls: "tree-item-flair", text: String(count) });
  }

  // subtyp kommt 1:1 aus einem tatsächlichen Frontmatter-Wert (siehe
  // renderUnregisteredRow) - könnte also klein geschrieben sein. SUBTYPen
  // werden aber immer groß geschrieben (siehe normalizeTypeName) - registriert
  // wird deshalb die normalisierte Form, und die betroffenen Notizen (mit
  // passendem TYP) werden gleich mit umgeschrieben.
  async registerSubtype(typ, rawValue) {
    const normalized = normalizeTypeName(rawValue);
    const list = ensureSubtypeList(this.plugin, typ);
    if (!list.includes(normalized)) list.push(normalized);

    let renamed = 0;
    if (normalized !== rawValue) {
      renamed = await renameSubtypeInNotes(this.app, typ, rawValue, normalized, {
        includeIgnored: this.plugin.settings.includeIgnoredFiles,
      });
    }

    await this.plugin.saveSettings();
    this.render(this.activeType);
    if (renamed > 0) new Notice(`SUBTYP ${normalized} registriert, ${renamed} Notiz(en) angepasst.`);
  }

  // Neues, leeres Tree-Item anlegen und sofort in den Editier-Modus versetzen -
  // wie startAdd() in typ-view.js. Nur verfügbar, während oben ein TYP
  // geöffnet ist (siehe render()) - ein neuer Subtyp braucht immer einen TYP.
  startAdd() {
    if (this.isEditing || !this.activeType) return;

    const treeItem = this.listEl.createDiv({ cls: "tree-item" });
    if (this.separatorEl) this.listEl.insertBefore(treeItem, this.separatorEl);
    const self = treeItem.createDiv({ cls: "tree-item-self is-clickable" });
    const inner = self.createDiv({ cls: "tree-item-inner" });
    this.startEditing(self, inner);
  }

  startEditing(self, inner) {
    if (this.isEditing) return;
    this.isEditing = true;
    const typ = this.activeType;

    self.addClass("is-being-renamed");
    inner.setAttribute("contenteditable", "true");
    inner.setAttribute("spellcheck", "false");
    inner.focus();

    const range = inner.doc.createRange();
    range.selectNodeContents(inner);
    const selection = inner.win.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      this.isEditing = false;

      const value = normalizeTypeName(inner.textContent);
      if (commit && value) {
        const list = ensureSubtypeList(this.plugin, typ);
        if (!list.some((s) => s.toLowerCase() === value.toLowerCase())) {
          list.push(value);
          await this.plugin.saveSettings();
        }
      }
      this.render(typ);
    };

    inner.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    inner.addEventListener("blur", () => finish(true));
  }
}

module.exports = { SubtypPane, scanSubtypes, SUBTYP_PROPERTY };
