const { Events, TFile, debounce } = require("obsidian");

const TYP_PROPERTY = "TYP";
const SUBTYP_PROPERTY = "SUBTYP";
const EMPTY_ENTRY = Object.freeze({ typeKey: null, rawType: null, subtypes: Object.freeze([]) });

// Sammelt Änderungen mehrerer Dateien (z. B. Umbenennen eines TYPs in vielen
// Notizen, Vault-Sync) zu einem einzigen "change"-Event. Ohne resetTimer, damit
// ein Dauerstrom an Änderungen trotzdem regelmäßig durchgereicht wird.
const FLUSH_DELAY_MS = 100;

function rawItem(value) {
  if (value == null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

// Einheitliche Auslegung eines TYP-Werts für das ganze Plugin: der Wert wird
// bewusst NICHT geglättet, sondern in seiner Rohform zum Schlüssel - ein TYP ist
// genau ein einzelner, sauberer Wert. Alles andere (Leerzeichen am Rand, klein
// geschrieben, Liste - auch eine einelementige) ergibt einen eigenen Schlüssel,
// der in keinem registrierten TYP aufgeht: er bekommt keine Farbe, zählt nicht
// beim "richtigen" TYP mit und steht in der TYP-View als eigener,
// unregistrierter Eintrag, von wo aus er sich per Klick bereinigen lässt
// (siehe registerType in typ-view.js). Listen erscheinen dabei als
// "[A, B]" und können so nie mit einem Einzelwert "A, B" zusammenfallen.
// null = kein TYP (fehlend, leer, nur Leerzeichen, leere Liste).
function typeKeyOf(value) {
  if (Array.isArray(value)) {
    const items = value.map(rawItem);
    if (items.every((item) => item.trim() === "")) return null;
    return `[${items.join(", ")}]`;
  }
  const text = rawItem(value);
  return text.trim() === "" ? null : text;
}

// SUBTYP bleibt (anders als TYP) Einzelwert oder Liste, getrimmt.
function subtypeList(value) {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).map((v) => rawItem(v).trim()).filter(Boolean);
}

function sameEntry(a, b) {
  return (
    !!a &&
    !!b &&
    a.typeKey === b.typeKey &&
    a.subtypes.length === b.subtypes.length &&
    a.subtypes.every((v, i) => v === b.subtypes[i])
  );
}

// Zentraler TYP-/SUBTYP-Index über alle Markdown-Dateien (Pfad -> Werte).
//
// Zweck: die Farb-Module hingen bisher alle direkt an metadataCache "changed"
// und "resolved" - beide feuern bei JEDER Änderung an irgendeiner Notiz (beim
// Tippen etwa alle zwei Sekunden), und jedes Modul färbte daraufhin seine
// komplette Ansicht neu, doppelt. Der Index vergleicht stattdessen je Datei, ob
// sich TYP oder SUBTYP tatsächlich geändert hat (bzw. eine Notiz hinzukam/
// wegfiel), und feuert nur dann sein eigenes "change"-Event (Argument: Set der
// betroffenen Pfade). Normales Schreiben löst damit gar kein Neu-Einfärben mehr aus.
//
// Zusätzlich hält er die vault-weiten Zählungen (TYP-Liste, SUBTYP-Liste,
// Picker, getTypes() für Templater) zwischengespeichert, statt sie bei jedem
// Aufruf per Scan über alle Notizen neu zu berechnen.
class TypIndex extends Events {
  constructor(plugin) {
    super();
    this.plugin = plugin;
    this.app = plugin.app;
    this.entries = new Map();
    this.built = false;
    this.aggregates = null;
    this.pendingPaths = new Set();
    this.flush = debounce(() => {
      const paths = this.pendingPaths;
      this.pendingPaths = new Set();
      this.trigger("change", paths);
    }, FLUSH_DELAY_MS);
  }

  register() {
    const { plugin, app } = this;
    plugin.registerEvent(app.metadataCache.on("changed", (file) => this.update(file)));
    plugin.registerEvent(app.metadataCache.on("deleted", (file) => this.remove(file.path)));
    plugin.registerEvent(app.vault.on("rename", (file, oldPath) => this.rename(file, oldPath)));
    // "Excluded files"-Liste geändert (siehe registerTypView) - die Einträge
    // selbst bleiben gültig, nur die daraus gefilterten Zählungen nicht.
    plugin.registerEvent(app.vault.on("config-changed", () => (this.aggregates = null)));

    // Beim App-Start kann der erste Zugriff (lazy, siehe ensureBuilt) noch vor
    // dem vollständig geladenen MetadataCache liegen. Einmalig nach dessen
    // erstem kompletten Auflösungsdurchlauf neu aufbauen; Abweichungen landen
    // dabei wie jede andere Änderung im "change"-Event.
    const resolvedRef = app.metadataCache.on("resolved", () => {
      app.metadataCache.offref(resolvedRef);
      this.rebuild();
    });
    plugin.registerEvent(resolvedRef);

    plugin.register(() => this.flush.cancel());
  }

  read(file) {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const rawType = frontmatter?.[TYP_PROPERTY] ?? null;
    return { typeKey: typeKeyOf(rawType), rawType, subtypes: subtypeList(frontmatter?.[SUBTYP_PROPERTY]) };
  }

  ensureBuilt() {
    if (!this.built) this.rebuild();
  }

  rebuild() {
    const previous = this.entries;
    const wasBuilt = this.built;
    this.entries = new Map();
    for (const file of this.app.vault.getMarkdownFiles()) this.entries.set(file.path, this.read(file));
    this.built = true;
    this.aggregates = null;
    if (!wasBuilt) return;

    for (const [path, entry] of this.entries) {
      if (!sameEntry(previous.get(path), entry)) this.pendingPaths.add(path);
    }
    for (const path of previous.keys()) {
      if (!this.entries.has(path)) this.pendingPaths.add(path);
    }
    if (this.pendingPaths.size > 0) this.flush();
  }

  markChanged(path) {
    this.aggregates = null;
    this.pendingPaths.add(path);
    this.flush();
  }

  update(file) {
    // Vor dem ersten Zugriff gibt es noch keinen veralteten Stand - der
    // spätere lazy Aufbau liest ohnehin frisch aus dem MetadataCache.
    if (!this.built || !(file instanceof TFile) || file.extension !== "md") return;
    const next = this.read(file);
    if (sameEntry(this.entries.get(file.path), next)) return;
    this.entries.set(file.path, next);
    this.markChanged(file.path);
  }

  remove(path) {
    if (!this.built || !this.entries.delete(path)) return;
    this.markChanged(path);
  }

  rename(file, oldPath) {
    if (!this.built) return;
    const entry = this.entries.get(oldPath);
    if (entry) {
      this.entries.delete(oldPath);
      this.markChanged(oldPath);
    }
    if (file instanceof TFile && file.extension === "md") {
      this.entries.set(file.path, entry ?? this.read(file));
      this.markChanged(file.path);
    }
  }

  entryFor(file) {
    if (!file) return EMPTY_ENTRY;
    this.ensureBuilt();
    return this.entries.get(file.path) ?? EMPTY_ENTRY;
  }

  // TYP-Schlüssel (siehe typeKeyOf) oder null. Für einen sauberen Wert ist das
  // schlicht der TYP-Name selbst.
  typeOf(file) {
    return this.entryFor(file).typeKey;
  }

  // Ein tatsächlicher Frontmatter-Wert zu einem Schlüssel - für Anzeige, Suche
  // und Normalisierung unregistrierter Einträge (alle Notizen eines Schlüssels
  // haben per Definition dieselbe Rohform).
  rawValueOf(typeKey) {
    return this.aggregate().rawByKey.get(typeKey);
  }

  // Sauberer Wert = Einzelwert ohne Leerzeichen am Rand. Klein geschriebene
  // Werte zählen hier als sauber (sie sind ein gültiger, nur noch nicht
  // registrierter TYP-Name), Listen und Randleerzeichen nicht.
  isCleanKey(typeKey) {
    const raw = this.rawValueOf(typeKey);
    return raw !== undefined && !Array.isArray(raw) && typeKey === typeKey.trim();
  }

  // Dateien mit genau diesem TYP-Schlüssel, unter Beachtung der
  // "Ignorierte Notizen berücksichtigen"-Einstellung.
  filesWithType(typeKey) {
    this.ensureBuilt();
    const includeIgnored = !!this.plugin.settings.includeIgnoredFiles;
    const files = [];
    for (const [path, entry] of this.entries) {
      if (entry.typeKey !== typeKey) continue;
      if (!includeIgnored && this.app.metadataCache.isUserIgnored(path)) continue;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) files.push(file);
    }
    return files;
  }

  // Respektiert standardmäßig Obsidians eigene "Excluded files"-Liste - dort
  // tragen auch Plugins wie Hide Folders ausgeblendete Ordner ein. Über die
  // Einstellung "Ignorierte Notizen berücksichtigen" abschaltbar.
  //
  // Mehrfach-SUBTYP (Array-Wert) zählt für jeden seiner SUBTYP-Buckets. Eine
  // Notiz ohne TYP hat keinen SUBTYP-Kontext.
  aggregate() {
    this.ensureBuilt();
    const includeIgnored = !!this.plugin.settings.includeIgnoredFiles;
    if (this.aggregates?.includeIgnored === includeIgnored) return this.aggregates;

    const counts = new Map();
    const rawByKey = new Map();
    const subtypesByType = new Map();
    let noType = 0;
    for (const [path, { typeKey, rawType, subtypes }] of this.entries) {
      if (!includeIgnored && this.app.metadataCache.isUserIgnored(path)) continue;
      if (typeKey === null) {
        noType++;
        continue;
      }
      counts.set(typeKey, (counts.get(typeKey) ?? 0) + 1);
      if (!rawByKey.has(typeKey)) rawByKey.set(typeKey, rawType);
      let bucket = subtypesByType.get(typeKey);
      if (!bucket) {
        bucket = { counts: new Map(), noSubtype: 0 };
        subtypesByType.set(typeKey, bucket);
      }
      if (subtypes.length === 0) bucket.noSubtype++;
      else for (const sub of subtypes) bucket.counts.set(sub, (bucket.counts.get(sub) ?? 0) + 1);
    }
    this.aggregates = { includeIgnored, counts, noType, rawByKey, subtypesByType };
    return this.aggregates;
  }

  // Zwischengespeichert - die gelieferten Maps nicht verändern.
  typeCounts() {
    const { counts, noType } = this.aggregate();
    return { counts, noType };
  }

  // TYP -> { counts: Map(SUBTYP -> Anzahl), noSubtype }. Zwischengespeichert -
  // nicht verändern.
  subtypeCounts() {
    return this.aggregate().subtypesByType;
  }
}

module.exports = { TypIndex, typeKeyOf, TYP_PROPERTY };
