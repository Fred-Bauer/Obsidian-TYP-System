const { Plugin } = require("obsidian");
const { DEFAULT_SETTINGS, TypSystemSettingTab } = require("./settings");
const { registerCommands } = require("./commands");
const { registerTypView, sortTypesByMode, DEFAULT_SORT_ORDER } = require("./typ-view");
const { TypIndex, setCanonicalProperty, deleteProperty, TYP_PROPERTY, SUBTYP_PROPERTY } = require("./typ-index");
const { getSubtype, getSubtypeNames, migrateAboveStandard } = require("./subtypes");
const { registerFileExplorerColors } = require("./file-explorer-colors");
const { registerGraphColors } = require("./graph-colors");
const { registerSearchColors } = require("./search-colors");
const { registerRecentFilesColors } = require("./recent-files-colors");
const { registerBacklinkColors } = require("./backlink-colors");
const { registerBookmarksColors } = require("./bookmark-colors");
const { registerActiveTitleColors } = require("./active-title-colors");
const { registerLinkColors } = require("./link-colors");
const { registerFrontmatterDefaultHighlight } = require("./frontmatter-default-highlight");
const { registerPropertyRenameSync } = require("./property-rename-sync");
const { normalizeGlobalOrder, sortFrontmatterFor, placePropertyFor } = require("./frontmatter-sort");
const { resolveFrontmatterPlaceholders, DYNAMIC_PLACEHOLDER_PATTERN } = require("./frontmatter-placeholders");
const {
  pickType: pickTypeModal,
  pickSubtype: pickSubtypeModal,
  pickTypeAndSubtype: pickTypeAndSubtypeModal,
} = require("./type-picker");
const { registerPlaceholderSuggest } = require("./placeholder-suggest");

// Migriert Bestandsinstallationen von der alten, separaten
// typeFloatingFrontmatter-Liste (eigenes Dict je Typ, immer hinter der
// Standardliste sortiert) auf die neue typeFloatingKeys-Markierung innerhalb
// derselben typeDefaultFrontmatter-Liste (siehe Kommentar an typeFloatingKeys
// in settings.js) - die Floating Properties landen dabei unverändert direkt
// im Anschluss an die bisherige Standardliste, genau wie zuvor.
function migrateFloatingFrontmatter(settings) {
  if (!settings.typeFloatingFrontmatter) return;
  for (const [type, floating] of Object.entries(settings.typeFloatingFrontmatter)) {
    const keys = Object.keys(floating).filter((key) => key !== "");
    if (keys.length === 0) continue;
    settings.typeDefaultFrontmatter[type] = { ...(settings.typeDefaultFrontmatter[type] ?? {}), ...floating };
    settings.typeFloatingKeys[type] = [...new Set([...(settings.typeFloatingKeys[type] ?? []), ...keys])];
  }
  delete settings.typeFloatingFrontmatter;
}

module.exports = class TypSystemPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    // Vor allen übrigen Modulen: die registrieren sich auf dessen "change"-
    // Event und lesen TYP/SUBTYP ausschließlich darüber (siehe typ-index.js).
    this.typIndex = new TypIndex(this);
    this.typIndex.register();

    registerCommands(this);
    this.addSettingTab(new TypSystemSettingTab(this.app, this));
    // Umbenennungen über "All properties"/Bases auch ins TYP-Frontmatter
    // der Typen übernehmen (siehe property-rename-sync.js).
    registerPropertyRenameSync(this);
    registerPlaceholderSuggest(this);

    // Separat gehalten (nicht nur Teil von refreshFns): die TYP-Detailansicht
    // braucht nach dem Mounten ihres TYP-Frontmatter-Editors gezielt nur
    // diesen einen Refresh (Fett-Markierung der Property-Zeilen) - das ganze
    // refreshTypColors()-Bündel würde dort auch unnötig registerTypView's
    // eigenen Render-Refresh mitanstoßen und sich damit selbst rekursiv
    // erneut rendern (führte zu einem Stack Overflow bei jedem TYP-Öffnen).
    this.refreshFrontmatterHighlight = registerFrontmatterDefaultHighlight(this);

    const refreshFns = [
      registerTypView(this),
      registerFileExplorerColors(this),
      registerGraphColors(this),
      registerSearchColors(this),
      registerRecentFilesColors(this),
      registerBacklinkColors(this),
      registerBookmarksColors(this),
      registerActiveTitleColors(this),
      registerLinkColors(this),
      this.refreshFrontmatterHighlight,
    ];
    this.refreshTypColors = () => refreshFns.forEach((fn) => fn());
  }

  onunload() {}

  // Für _obsidian/templater-scripts/TYP.js: liefert die im TYP-View unter
  // "TYP-Frontmatter" hinterlegten Properties für den gegebenen TYP, damit
  // Templater sie beim Anlegen einer neuen Notiz übernehmen kann, statt sie dort
  // ein zweites Mal zu pflegen. Werte wie "{{today}}" werden dabei erst hier
  // aufgelöst (siehe frontmatter-placeholders.js), nicht schon beim Speichern -
  // liefert also bei jedem Aufruf frisch berechnete Werte. Kopie statt direkter
  // Referenz, damit ein Aufrufer die zurückgegebenen Werte gefahrlos mutieren
  // kann, ohne die Plugin-Settings zu verändern.
  //
  // includeFloating (Standard: false) lässt die als "Floating Property"
  // markierten Keys (typeFloatingKeys) in der Liste - anders als die übrigen
  // Standard-Properties werden diese NICHT automatisch bei jeder neuen Notiz
  // angelegt (sie zählen zwar für die Frontmatter-Sortierung mit, siehe
  // orderedDefaultKeys in frontmatter-sort.js, sollen aber nur bei Bedarf
  // explizit von einem Templater-Skript abgegriffen werden).
  //
  // file (optional) wird an resolveFrontmatterPlaceholders() durchgereicht -
  // nur für den "{{created}}"-Platzhalter relevant, der das Erstellungsdatum
  // der Ziel-Datei statt des Aufrufzeitpunkts liefert.
  //
  // subtype (optional): ergänzt das TYP-Frontmatter um den Block dieses
  // Subtyps (siehe subtypes.js), dessen Keys folgen dahinter (wichtig für die
  // Reihenfolge der tp.-Platzhalter). Steht ein Key in BEIDEN Blöcken, behält
  // er die Position des TYP-Frontmatters, Wert und Floating-Markierung kommen
  // aber vom Subtyp - eine Zuweisung auf einen bereits vorhandenen
  // Objektschlüssel überschreibt ihn, ohne ihn zu verschieben. Die
  // Frontmatter-Sortierung muss dieselbe Regel verwenden, sonst würde sie
  // eine gerade angelegte Notiz sofort wieder umsortieren (siehe
  // orderedDefaultKeys in frontmatter-sort.js).
  getTypeDefaults(type, { includeFloating = false, file, subtype = null } = {}) {
    const defaults = {};
    const isFloating = new Map();
    const addBlock = (frontmatter, floatingKeys) => {
      const actualKeys = new Map(Object.keys(defaults).map((key) => [key.toLowerCase(), key]));
      for (const [key, value] of Object.entries(frontmatter ?? {})) {
        if (key === "") continue;
        const target = actualKeys.get(key.toLowerCase()) ?? key;
        defaults[target] = value;
        isFloating.set(target, (floatingKeys ?? []).includes(key));
      }
    };
    const subtypeData = subtype ? getSubtype(this.settings, type, subtype) : null;
    addBlock(this.settings.typeDefaultFrontmatter[type], this.settings.typeFloatingKeys[type]);
    if (subtypeData) addBlock(subtypeData.frontmatter, subtypeData.floatingKeys);

    if (!includeFloating) {
      for (const [key, floating] of isFloating) if (floating) delete defaults[key];
    }
    return resolveFrontmatterPlaceholders(defaults, file);
  }

  // Für _obsidian/templater-scripts/TYP.js: registrierte Subtypen eines TYPs in
  // der Reihenfolge ihrer Blöcke, samt Notiz-Anzahl.
  getSubtypes(type) {
    const { counts } = this.typIndex.subtypeBucket(type);
    return getSubtypeNames(this.settings, type).map((subtype) => ({ subtype, count: counts.get(subtype) ?? 0 }));
  }

  // Für _obsidian/templater-scripts/TYP.js: Subtyp-Picker (siehe
  // type-picker.js). Löst mit dem gewählten Subtyp auf, mit "" für "Kein
  // Subtyp" (bzw. ohne Picker, wenn der TYP keine Subtypen hat), oder mit
  // null bei ESC (TYP.js kehrt dann zur TYP-Auswahl zurück).
  pickSubtype(type) {
    return pickSubtypeModal(this.app, this, type);
  }

  // Für _obsidian/templater-scripts/TYP.js, innerhalb von processFrontMatter:
  // setzt TYP und SUBTYP in einheitlicher Schreibweise - eine abweichend
  // geschriebene Property ("typ", "Subtyp") wird an ihrer Stelle umbenannt
  // statt verdoppelt. subtype null entfernt einen vorhandenen SUBTYP.
  applyTypeProperties(frontmatter, type, subtype) {
    setCanonicalProperty(frontmatter, TYP_PROPERTY, type);
    if (subtype) setCanonicalProperty(frontmatter, SUBTYP_PROPERTY, subtype);
    else deleteProperty(frontmatter, SUBTYP_PROPERTY);
  }

  // Für _obsidian/templater-scripts/TYP.js, innerhalb von processFrontMatter
  // und nach allen übrigen Änderungen: bringt das Frontmatter in die
  // Reihenfolge der Frontmatter-Sortierung (globale Reihenfolge, TYP-
  // Frontmatter samt Subtyp-Block) - sonst landen neu ergänzte Properties
  // (z. B. SUBTYP in einer bestehenden Notiz) am Ende.
  sortFrontmatter(frontmatter, type, subtype = null) {
    return sortFrontmatterFor(this, frontmatter, type, subtype);
  }

  // Innerhalb von processFrontMatter: setzt nur die Property key an ihren
  // Platz laut Frontmatter-Sortierung (TYP/SUBTYP aus dem Objekt selbst),
  // alles Übrige bleibt, wie es ist - z. B. für Freds Property-Backlinking,
  // damit eine neu angelegte Property nicht am Ende landet.
  placeProperty(frontmatter, key) {
    return placePropertyFor(this, frontmatter, key);
  }

  // Für _obsidian/templater-scripts/TYP.js: erkennt einen dynamischen
  // "{{tp.<Skriptname>}}"-Platzhalter (siehe frontmatter-placeholders.js) in
  // einem TYP-Frontmatter-Wert und liefert den referenzierten Skriptnamen,
  // sonst null. Die eigentliche Auflösung (Aufruf von tp.user.<Skriptname>)
  // kann nur Templater selbst übernehmen - das Plugin hat keinen tp-Zugriff,
  // daher hier bewusst nur Erkennung statt Auflösung wie bei getTypeDefaults().
  matchDynamicPlaceholder(value) {
    if (typeof value !== "string") return null;
    const match = value.match(DYNAMIC_PLACEHOLDER_PATTERN);
    return match ? match[1].trim() : null;
  }

  // Für _obsidian/templater-scripts/TYP.js: die im TYP-View registrierten TYPen
  // samt ihrer dort gepflegten Beschreibung, statt sie aus _obsidian/Typen.md zu parsen -
  // in derselben Reihenfolge, in der sie auch in der TYP-Liste selbst erscheinen
  // (aktuelle Sortiereinstellung dort, z. B. Häufigkeit oder Name).
  //
  // TYPen mit deaktiviertem "Manueller TYP"-Schalter (siehe TYP-Detailansicht)
  // sind nicht für die manuelle Auswahl gedacht (z. B. beim Anlegen einer neuen
  // Notiz) und werden deshalb standardmäßig ausgeklammert - Aufrufer, die
  // trotzdem alle TYPen brauchen, übergeben includeManualOff: true.
  getTypes({ includeManualOff = false } = {}) {
    const { counts } = this.typIndex.typeCounts();
    const sortOrder = this.settings.typSortOrder ?? DEFAULT_SORT_ORDER;
    return sortTypesByMode(this.settings.types, sortOrder, counts, this.settings.typeColors)
      .filter((type) => includeManualOff || (this.settings.typeManual ?? {})[type] !== false)
      .map((type) => ({
        type,
        description: this.settings.typeDescriptions[type] ?? "",
        count: counts.get(type) ?? 0,
      }));
  }

  // Für _obsidian/templater-scripts/TYP.js: nativer TYP-Picker (siehe
  // type-picker.js) statt der reinen Text-Liste aus getTypes() +
  // tp.system.suggester - mit TYP-Farbe/-Punkt, Beschreibung und Notiz-Anzahl
  // je Zeile. includeManualOff wie bei getTypes(). Löst mit dem gewählten TYP
  // auf, oder mit null bei Abbruch (ESC).
  pickType(options) {
    return pickTypeModal(this.app, this, options);
  }

  // Für _obsidian/templater-scripts/TYP.js: TYP und Subtyp in einem Zug (siehe
  // type-picker.js) - je nach Einstellung "Subtyp-Picker separat" ein einziger
  // Picker mit eingerückten Subtypen oder beide Picker nacheinander. Optionen
  // wie bei pickType(). Löst mit { type, subtype } auf (subtype null für "ohne
  // Subtyp"), oder mit null bei Abbruch (ESC).
  pickTypeAndSubtype(options) {
    return pickTypeAndSubtypeModal(this.app, this, options);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Object.assign ersetzt verschachtelte Objekte als Ganzes - später
    // hinzugekommene Ansichten (z. B. colorViews.links) fehlten in bereits
    // gespeicherten Einstellungen sonst und wären stillschweigend aus.
    this.settings.colorViews = { ...DEFAULT_SETTINGS.colorViews, ...this.settings.colorViews };
    // Migriert Bestandsinstallationen, deren globalPropertyOrder noch aus der
    // Zeit vor "TYP als Listeneintrag" stammt (siehe frontmatter-sort.js).
    this.settings.globalPropertyOrder = normalizeGlobalOrder(this.settings.globalPropertyOrder);
    migrateFloatingFrontmatter(this.settings);
    // Subtyp-Blöcke lagen früher wahlweise über dem TYP-Frontmatter; das steht
    // jetzt fest ganz oben (siehe getSectionOrder in subtypes.js).
    migrateAboveStandard(this.settings);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
};
