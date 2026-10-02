const { Notice, TFile, stringifyYaml } = require("obsidian");
const { getSubtypeNames } = require("./subtypes");
const { normalizeGlobalOrder, TYP_PROPERTY, SUBTYP_PROPERTY } = require("./frontmatter-sort");
const { askColumnOptions, askRemovals } = require("./base-dialogs");

/* ============================================================
 * Bases aus einem TYP erzeugen
 * Legt für einen TYP (bzw. einen Subtyp-Namen) eine .base im
 * Vault-Root an: Filter auf TYP, eine Table-View je Subtyp, und
 * Spalten, die sich aus dem TYP-Frontmatter plus der globalen
 * Property-Reihenfolge ergeben. Der zweite Befehl bringt die
 * Spalten einer bereits vorhandenen View auf denselben Stand.
 *
 * Geschrieben wird ausschließlich über Obsidians eigene
 * Bases-Schnittstelle bzw. deren eigene Serialisierung (siehe
 * writeViews) - nie über selbst geparstes YAML, sonst überlebten
 * Formelblöcke und Sonderschlüssel den Round-Trip nicht sicher.
 * ============================================================ */

// Property-IDs einer View: im Speicher voll qualifiziert ("note.Titel",
// "file.name", "formula.X"), in der Datei dagegen ohne das "note."-Präfix
// ("Titel"). cfg.setOrder() erwartet die qualifizierte Form, ein selbst
// gebautes View-Objekt für die Datei die verkürzte - serializeId() macht aus
// der einen die andere.
const FILE_NAME_ID = "file.name";
const NOTE_PREFIX = "note.";
const TAGS_PROPERTY = "tags";
const BASE_EXTENSION = "base";

function noteId(key) {
  return NOTE_PREFIX + key;
}

function serializeId(id) {
  return id.startsWith(NOTE_PREFIX) ? id.slice(NOTE_PREFIX.length) : id;
}

function sameId(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

// Ein Filter-Ausdruck, wie Bases ihn selbst schreibt: TYP == "MEDIA".
// JSON.stringify liefert dabei die korrekt gequotete Zeichenkette - ein
// Anführungszeichen im Namen (theoretisch möglich) bliebe sonst stehen und
// machte den Ausdruck unlesbar.
function equalsFilter(property, value) {
  return `${property} == ${JSON.stringify(String(value))}`;
}

/* --- TYP/Subtyp aus einem vorhandenen Filter lesen -----------------------
 * Eine generierte View trägt ihren TYP im Root- oder im View-Filter; der
 * Aktualisieren-Befehl liest ihn von dort, statt danach zu fragen. Gelesen
 * wird nur, was eindeutig ist: eine reine und-Verknüpfung mit genau einem
 * TYP- bzw. SUBTYP-Vergleich. Eine oder-Gruppe schränkt nicht zwingend ein
 * und ein zweiter, anderer Wert wäre widersprüchlich - beides führt zu null,
 * der Befehl fragt dann nach (siehe updateActiveView).
 * --------------------------------------------------------------------- */
const EQUALS_PATTERN = new RegExp(`^\\s*(${TYP_PROPERTY}|${SUBTYP_PROPERTY})\\s*==\\s*(.+?)\\s*$`, "i");

function filterLiteral(raw) {
  if (raw.length >= 2 && raw[0] === '"' && raw.endsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (raw.length >= 2 && raw[0] === "'" && raw.endsWith("'")) return raw.slice(1, -1);
  return null;
}

function collectEquals(node, found) {
  if (!node) return;
  if (typeof node === "string") {
    const match = EQUALS_PATTERN.exec(node);
    if (!match) return;
    const value = filterLiteral(match[2]);
    if (value !== null) found[match[1].toUpperCase()].add(value);
    return;
  }
  if (Array.isArray(node)) {
    for (const entry of node) collectEquals(entry, found);
    return;
  }
  // Nur und-Verknüpfungen: was in einer oder-/nicht-Gruppe steht, sagt über
  // den TYP der Treffer nichts Verlässliches aus.
  if (node.and) collectEquals(node.and, found);
}

function readTarget(...filterGroups) {
  const found = { [TYP_PROPERTY]: new Set(), [SUBTYP_PROPERTY]: new Set() };
  for (const group of filterGroups) collectEquals(group, found);
  const types = [...found[TYP_PROPERTY]];
  const subtypes = [...found[SUBTYP_PROPERTY]];
  if (types.length > 1 || subtypes.length > 1) return null;
  if (types.length === 0 && subtypes.length === 0) return null;
  return { type: types[0] ?? null, subtype: subtypes[0] ?? null };
}

/* --- Spalten eines Ziels ------------------------------------------------- */

// TYP und SUBTYP selbst werden nie Spalten (Filter bzw. Gruppierung sagen sie
// ohnehin); die leere Platzhalter-Zeile des Frontmatter-Editors ebenso wenig.
function isSystemKey(key) {
  return key === "" || sameId(key, TYP_PROPERTY) || sameId(key, SUBTYP_PROPERTY);
}

// Die Properties eines Blocks in ihrer gespeicherten Reihenfolge. Läuft über
// collectBlocks() (main.js) und erbt damit dessen Regeln: der Subtyp-Block
// folgt hinter dem TYP-Frontmatter, ein Key aus beiden behält die Position des
// TYP-Frontmatters, und die Floating-Markierung des Subtyps schlägt die des
// TYPs - ein Subtyp kann eine Standard-Property so gezielt abschalten.
function blockKeys(plugin, type, subtype, includeFloating) {
  const { defaults } = plugin.collectBlocks(type, subtype, includeFloating);
  return Object.keys(defaults).filter((key) => !isSystemKey(key));
}

// Alle TYPen, die einen Subtyp dieses Namens führen - in der Reihenfolge der
// TYP-Liste. Derselbe Subtyp-Name darf unter mehreren TYPen vorkommen; eine
// eigenständige Subtyp-Base filtert nur nach SUBTYP und zeigt sie deshalb alle.
function typesForSubtype(plugin, subtype) {
  return plugin.settings.types.filter((type) => getSubtypeNames(plugin.settings, type).includes(subtype));
}

// Ein Ziel ist { type, subtype }:
//   { type, subtype: null }  - der TYP selbst
//   { type, subtype }        - ein Subtyp innerhalb seines TYPs
//   { type: null, subtype }  - ein Subtyp-Name ohne TYP-Bindung (eigenständige
//                              Subtyp-Base, Spalten als Vereinigung aller TYPen)
function targetKeys(plugin, target, options) {
  const seen = new Set();
  const main = [];
  const others = [];
  const add = (list, keys) => {
    for (const key of keys) {
      const lower = key.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      list.push(key);
    }
  };

  if (!target.type) {
    for (const type of typesForSubtype(plugin, target.subtype)) {
      add(main, blockKeys(plugin, type, target.subtype, options.floating));
    }
    return { main, others };
  }

  add(main, blockKeys(plugin, target.type, target.subtype, options.floating));
  // "Alle Subtyp-Properties" gilt nur für die TYP-View: in einer Subtyp-View
  // blieben die Properties der übrigen Subtypen durchweg leer, eine Notiz hat
  // ja höchstens einen SUBTYP. Die Keys des TYP-Frontmatters stehen schon in
  // main und fallen über "seen" hier von selbst weg.
  if (options.allSubtypes && !target.subtype) {
    for (const subtype of getSubtypeNames(plugin.settings, target.type)) {
      add(others, blockKeys(plugin, target.type, subtype, options.floating));
    }
  }
  return { main, others };
}

// Die fertige Spaltenliste: file.name zuerst, danach die globale
// Property-Reihenfolge als Gerüst (siehe globalPropertyOrder in settings.js).
// Deren Platzhalter bedeuten hier:
//   "typ"                     - TYP-Frontmatter samt Subtyp-Block des Ziels
//   "other"                   - die Properties der übrigen Subtyp-Blöcke
//   "typValue"/"subtypValue"  - übersprungen, TYP/SUBTYP werden keine Spalten
// Fest platzierte Einzel-Properties werden nur für tags berücksichtigt (und
// nur, wenn im Dialog angehakt): cssclasses oder aliases sind als Spalte einer
// Übersichtstabelle nicht gemeint.
function columnIds(plugin, target, options) {
  const { main, others } = targetKeys(plugin, target, options);
  const ids = [];
  const seen = new Set();
  const push = (id) => {
    const lower = id.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    ids.push(id);
  };

  push(FILE_NAME_ID);
  let tagsPlaced = false;
  for (const entry of normalizeGlobalOrder(plugin.settings.globalPropertyOrder)) {
    if (entry.kind === "property") {
      if (options.tags && entry.name && sameId(entry.name, TAGS_PROPERTY)) {
        push(noteId(entry.name));
        tagsPlaced = true;
      }
    } else if (entry.kind === "typ") {
      for (const key of main) push(noteId(key));
    } else if (entry.kind === "other") {
      for (const key of others) push(noteId(key));
    }
  }
  // Sicherheitsnetz: steht tags gar nicht in der globalen Reihenfolge, landet
  // es trotzdem am Ende, statt trotz gesetzter Option zu fehlen.
  if (options.tags && !tagsPlaced) push(noteId(TAGS_PROPERTY));
  return ids;
}

/* --- Views eines Ziels --------------------------------------------------- */

// scoped: ob jede View ihren vollen Filter selbst tragen muss. In einer frisch
// angelegten Base steht der TYP im Root-Filter und die Subtyp-Views ergänzen
// nur SUBTYP; werden Views dagegen in eine bestehende, fremde Base ergänzt,
// bleibt deren Root-Filter unangetastet und jede neue View filtert selbst.
function targetViews(plugin, target, options, { scoped }) {
  if (!target.type) {
    const view = {
      type: "table",
      name: target.subtype,
      order: columnIds(plugin, target, options),
    };
    if (scoped) view.filters = { and: [equalsFilter(SUBTYP_PROPERTY, target.subtype)] };
    // Mehrere TYPen mit demselben Subtyp-Namen: die Gruppierung trennt sie,
    // ohne dass die Base je TYP eine eigene View bräuchte.
    if (typesForSubtype(plugin, target.subtype).length > 1) {
      view.groupBy = { property: noteId(TYP_PROPERTY), direction: "ASC" };
    }
    return [view];
  }

  const type = target.type;
  const subtypes = getSubtypeNames(plugin.settings, type);
  const main = {
    type: "table",
    name: type,
    order: columnIds(plugin, { type, subtype: null }, options),
  };
  if (scoped) main.filters = { and: [equalsFilter(TYP_PROPERTY, type)] };
  // Ohne Subtypen wäre die Gruppierung nach einer überall leeren Property nur
  // eine Gruppe "ohne Wert" - dann bleibt sie weg.
  if (subtypes.length > 0) main.groupBy = { property: noteId(SUBTYP_PROPERTY), direction: "ASC" };

  const views = [main];
  for (const subtype of subtypes) {
    views.push({
      type: "table",
      name: subtype,
      // allSubtypes ist in einer Subtyp-View bewusst aus (siehe targetKeys).
      order: columnIds(plugin, { type, subtype }, { ...options, allSubtypes: false }),
      filters: {
        and: scoped
          ? [equalsFilter(TYP_PROPERTY, type), equalsFilter(SUBTYP_PROPERTY, subtype)]
          : [equalsFilter(SUBTYP_PROPERTY, subtype)],
      },
    });
  }
  return views;
}

// View-Objekt in der Form, in der es in der Datei steht: ohne "note."-Präfix
// und in der Schlüsselreihenfolge, die Bases selbst schreibt.
function serializeView(view) {
  const out = { type: view.type, name: view.name };
  if (view.filters) out.filters = view.filters;
  if (view.order) out.order = view.order.map(serializeId);
  if (view.groupBy) {
    out.groupBy = { property: serializeId(view.groupBy.property), direction: view.groupBy.direction };
  }
  return out;
}

/* --- Datei öffnen und schreiben ------------------------------------------ */

function waitFor(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Öffnet die Base und wartet, bis ihre Query geparst ist - erst dann lässt
// sich über sie lesen und schreiben. Ist die Datei bereits in einem Tab offen,
// wird der benutzt, statt einen zweiten danebenzulegen.
async function openBase(app, file) {
  const open = app.workspace.getLeavesOfType("bases").find((leaf) => leaf.view?.file?.path === file.path);
  const leaf = open ?? app.workspace.getLeaf("tab");
  if (open) app.workspace.revealLeaf(leaf);
  else await leaf.openFile(file, { active: true });
  for (let attempt = 0; attempt < 40 && !leaf.view?.query; attempt++) await waitFor(25);
  return leaf.view?.query ? leaf.view : null;
}

// Views in eine bestehende Base ergänzen. getSerializable() liefert genau die
// Struktur, die Bases auch beim eigenen Speichern schreibt (nachgeprüft: der
// Round-Trip gibt Bestandsdateien samt Formelblöcken und Sonderschlüsseln
// byte-identisch zurück) - angefasst wird davon nur die views-Liste.
async function appendViews(app, view, views) {
  const data = view.query.getSerializable();
  data.views = [...(data.views ?? []), ...views.map(serializeView)];
  await app.vault.modify(view.file, stringifyYaml(data));
}

/* --- Befehl: Base für TYP anlegen ---------------------------------------- */

async function createBase(plugin, target, options) {
  const app = plugin.app;
  const name = target.subtype ?? target.type;
  const path = `${name}.${BASE_EXTENSION}`;
  const existing = app.vault.getAbstractFileByPath(path);

  if (existing && !(existing instanceof TFile)) {
    new Notice(`"${path}" ist keine Datei - Base nicht angelegt.`);
    return;
  }

  if (!existing) {
    const views = targetViews(plugin, target, options, { scoped: false });
    const root = target.type
      ? { and: [equalsFilter(TYP_PROPERTY, target.type)] }
      : { and: [equalsFilter(SUBTYP_PROPERTY, target.subtype)] };
    const file = await app.vault.create(path, stringifyYaml({ filters: root, views: views.map(serializeView) }));
    await openBase(app, file);
    new Notice(`${path} angelegt: ${views.length} View(s).`);
    return;
  }

  // Die Datei gibt es schon - ergänzt wird, was fehlt. Eine gleichnamige View
  // bleibt unangetastet: sie könnte von Hand eingerichtet sein, und sie
  // kommentarlos zu überschreiben wäre ein stiller Verlust.
  const view = await openBase(app, existing);
  if (!view) {
    new Notice(`${path} konnte nicht gelesen werden - Base nicht ergänzt.`);
    return;
  }
  const present = new Set(view.query.views.map((cfg) => cfg.name));
  const wanted = targetViews(plugin, target, options, { scoped: true });
  const toAdd = wanted.filter((entry) => !present.has(entry.name));
  const skipped = wanted.filter((entry) => present.has(entry.name)).map((entry) => entry.name);

  if (toAdd.length > 0) await appendViews(app, view, toAdd);

  const parts = [];
  parts.push(toAdd.length > 0 ? `${path}: ${toAdd.length} View(s) ergänzt.` : `${path}: nichts zu ergänzen.`);
  if (skipped.length > 0) parts.push(`Bereits vorhanden und unangetastet: ${skipped.join(", ")}.`);
  new Notice(parts.join(" "));
}

async function createBaseCommand(plugin) {
  // includeManualOff: gerade für die nicht manuell vergebenen TYPen (KONTAKT,
  // MEDIA, EXTERN) ist eine Base interessant. Nicht erfasste TYPen bleiben
  // außen vor - für sie gibt es kein TYP-Frontmatter und damit keine Spalten.
  const choice = await plugin.pickTypeAndSubtype({ includeManualOff: true });
  if (!choice) return;

  // Ein im Picker gewählter Subtyp meint die eigenständige Subtyp-Base: sie
  // filtert nur nach SUBTYP und sammelt die Spalten über alle TYPen, die
  // diesen Subtyp-Namen führen.
  const target = choice.subtype ? { type: null, subtype: choice.subtype } : { type: choice.type, subtype: null };
  const options = await askColumnOptions(plugin, target, (current) => columnIds(plugin, target, current));
  if (!options) return;
  await createBase(plugin, target, options);
}

/* --- Befehl: Spalten der Base-View aktualisieren -------------------------- */

function activeBaseView(plugin) {
  const leaf = plugin.app.workspace.activeLeaf ?? plugin.app.workspace.getMostRecentLeaf?.();
  const view = leaf?.view;
  if (!view || typeof view.getViewType !== "function" || view.getViewType() !== "bases") return null;
  return view.query ? view : null;
}

function serializeFilters(filters) {
  return typeof filters?.serialize === "function" ? filters.serialize() : null;
}

async function updateActiveView(plugin, view) {
  const query = view.query;
  const viewName = view.controller?.viewName;
  const cfg = (viewName ? query.getViewConfig(viewName) : null) ?? query.views[0];
  if (!cfg) {
    new Notice("Keine View aktiv.");
    return;
  }

  let target = readTarget(serializeFilters(query.filters), serializeFilters(cfg.filters));
  if (!target) {
    // Kein eindeutiger TYP im Filter (handgeschriebene oder-Gruppe, gar kein
    // Filter): nachfragen - und die Antwort gleich als Filter hinterlegen,
    // damit der nächste Lauf sie selbst liest.
    const choice = await plugin.pickTypeAndSubtype({ includeManualOff: true });
    if (!choice) return;
    target = { type: choice.type, subtype: choice.subtype };
    const and = [equalsFilter(TYP_PROPERTY, choice.type)];
    if (choice.subtype) and.push(equalsFilter(SUBTYP_PROPERTY, choice.subtype));
    query.setViewFilters(cfg.name, { and });
  }

  const options = await askColumnOptions(plugin, target, (current) => columnIds(plugin, target, current));
  if (!options) return;

  const desired = columnIds(plugin, target, options);
  const desiredLower = new Set(desired.map((id) => id.toLowerCase()));
  // Ohne eigene order zeigt eine View alle Properties - dann gibt es nichts zu
  // entfernen, die generierte Liste tritt schlicht an deren Stelle.
  const current = Array.isArray(cfg.order) ? [...cfg.order] : [];
  const extras = current.filter((id) => !desiredLower.has(id.toLowerCase()));

  let kept = [];
  if (extras.length > 0) {
    const removals = await askRemovals(plugin, extras, cfg.name);
    if (!removals) return;
    kept = extras.filter((id) => !removals.has(id));
  }

  // Behaltene Spalten bleiben vorn, direkt hinter file.name: was von Hand
  // ergänzt wurde (Formel-Spalten etwa), soll nicht ans Ende rutschen.
  const newOrder = [
    FILE_NAME_ID,
    ...kept.filter((id) => !sameId(id, FILE_NAME_ID)),
    ...desired.filter((id) => !sameId(id, FILE_NAME_ID)),
  ];

  if (newOrder.length === current.length && newOrder.every((id, index) => id === current[index])) {
    new Notice(`View "${cfg.name}": Spalten sind bereits aktuell.`);
    return;
  }

  const added = desired.filter((id) => !current.some((existing) => sameId(existing, id))).length;
  const removed = extras.length - kept.length;
  cfg.setOrder(newOrder);
  new Notice(`View "${cfg.name}": ${added} Spalte(n) ergänzt, ${removed} entfernt.`);
}

module.exports = {
  createBaseCommand,
  activeBaseView,
  updateActiveView,
  // Für Tests/Entwicklung an einzelnen Bausteinen
  columnIds,
  readTarget,
  targetViews,
};
