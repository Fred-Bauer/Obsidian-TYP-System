const { Plugin } = require("obsidian");
const { DEFAULT_SETTINGS, TypSystemSettingTab } = require("./settings");
const { registerCommands } = require("./commands");
const { registerTypView, sortTypesByMode, DEFAULT_SORT_ORDER } = require("./typ-view");
const { TypIndex, setCanonicalProperty, deleteProperty, TYP_PROPERTY, SUBTYP_PROPERTY } = require("./typ-index");
const {
  getSubtype,
  getSubtypeNames,
  isSubtypeManual,
  migrateAboveStandard,
  migrateSubtypeColorScale,
  migrateSubtypeManual,
} = require("./subtypes");
const { DEFAULT_SUBTYPE_COLOR_RANGES } = require("./type-colors");
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
const { resolveShortcuts, scriptNameOf, resolveCallArgs } = require("./shortcuts");
const {
  pickType: pickTypeModal,
  pickSubtype: pickSubtypeModal,
  pickTypeAndSubtype: pickTypeAndSubtypeModal,
} = require("./type-picker");
const { registerShortcutScripts } = require("./shortcut-scripts");

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

// Aus dem frueheren Schalter "Beschreibungs-Textfeld anzeigen" (Boolean) ist
// der dreistufige Modus der zweiten Spalte geworden, umgeschaltet ueber den
// Knopf im Listen-Header (siehe SECONDARY_MODES in typ-view.js). Der alte Wert
// kennt nur zwei der drei Zustaende - true wird zur Beschreibung, false zu
// "nichts"; "subtypes" gab es damals noch nicht. Liefert true bei einer
// Aenderung, damit der Aufrufer sie gleich schreibt und der alte Schluessel
// nicht in data.json liegen bleibt.
//
// Geprueft wird gegen stored (die rohen geladenen Daten), NICHT gegen settings:
// dort hat Object.assign den neuen Schluessel laengst aus DEFAULT_SETTINGS
// gefuellt, "noch nicht gesetzt" waere daran also nie zu erkennen und der alte
// Wert bliebe stillschweigend liegen.
function migrateTypListSecondary(settings, stored) {
  if (stored?.typListDescriptionEnabled === undefined) return false;
  if (stored.typListSecondary === undefined) {
    settings.typListSecondary = stored.typListDescriptionEnabled ? "description" : "none";
  }
  delete settings.typListDescriptionEnabled;
  return true;
}

// Die Ausrichtung der Subtyp-Vorschau war kurzzeitig eine eigene Einstellung
// und ist jetzt ein Style Setting (body-Klasse, siehe den @settings-Block in
// styles.css) - das Plugin liest den Schluessel nicht mehr. Ohne dieses
// Aufraeumen bliebe er ueber Object.assign in loadSettings dauerhaft in
// data.json stehen.
function dropTypListSubtypesAlign(settings) {
  if (settings.typListSubtypesRightAligned === undefined) return false;
  delete settings.typListSubtypesRightAligned;
  return true;
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
    // Accessor auf die als "@typ-shortcut" markierten Templater-Skripte, für
    // das Auswahl-Modal der Property-Zeilen (siehe shortcut-picker.js).
    this.getShortcutScripts = registerShortcutScripts(this);

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

    // Der @settings-Block in styles.css (Style Settings, siehe dort) wird sonst
    // je nach Ladereihenfolge uebersehen: Style Settings liest die Stylesheets
    // beim eigenen Laden und danach nur noch bei "css-change" - das feuert aber
    // ausschliesslich fuer Themes und Snippets, nicht fuer das styles.css eines
    // Plugins. Wer spaeter geladen wird als Style Settings (oder per Hot-Reload
    // neu geladen wird), taucht dort also gar nicht auf. "parse-style-settings"
    // ist der dafuer vorgesehene Hook; ohne installiertes Style Settings hoert
    // niemand zu und der Aufruf verpufft folgenlos.
    //
    // Erst im naechsten Tick: Obsidian haengt das styles.css eines Plugins erst
    // NACH dessen onload() in den DOM - synchron hier gerufen fuende Style
    // Settings das Stylesheet noch gar nicht und liesse den Abschnitt aus.
    // onLayoutReady taugt dafuer nicht: beim Hot-Reload ist das Layout laengst
    // fertig, der Rueckruf liefe also sofort und damit genauso zu frueh.
    const parseStyleSettings = window.setTimeout(() => this.app.workspace.trigger("parse-style-settings"), 0);
    this.register(() => window.clearTimeout(parseStyleSettings));
  }

  onunload() {}

  // Für _obsidian/templater-scripts/TYP.js: liefert die im TYP-View unter
  // "TYP-Frontmatter" hinterlegten Properties für den gegebenen TYP, damit
  // Templater sie beim Anlegen einer neuen Notiz übernehmen kann, statt sie dort
  // ein zweites Mal zu pflegen. Kopie statt direkter Referenz, damit ein
  // Aufrufer die zurückgegebenen Werte gefahrlos mutieren kann, ohne die
  // Plugin-Settings zu verändern.
  //
  // Properties mit einem festen Shortcut (today/now/created, siehe
  // shortcuts.js) tragen dessen erst hier aufgelösten Wert - nicht den beim
  // Setzen gültigen, es kommt also bei jedem Aufruf frisch Berechnetes heraus.
  // Properties mit einem Skript-Shortcut tragen null: die kann nur Templater
  // auflösen, TYP.js holt sie sich über getTypeShortcuts() (unten) und setzt
  // sie selbst ein. Key und Position bleiben in beiden Fällen erhalten.
  //
  // includeFloating (Standard: false) lässt die als "Floating Property"
  // markierten Keys (typeFloatingKeys) in der Liste - anders als die übrigen
  // Standard-Properties werden diese NICHT automatisch bei jeder neuen Notiz
  // angelegt (sie zählen zwar für die Frontmatter-Sortierung mit, siehe
  // orderedDefaultKeys in frontmatter-sort.js, sollen aber nur bei Bedarf
  // explizit von einem Templater-Skript abgegriffen werden).
  //
  // file (optional) wird an resolveShortcuts() durchgereicht - nur für den
  // "created"-Shortcut relevant, der das Erstellungsdatum der Ziel-Datei statt
  // des Aufrufzeitpunkts liefert.
  //
  // subtype (optional): ergänzt das TYP-Frontmatter um den Block dieses
  // Subtyps (siehe subtypes.js), dessen Keys folgen dahinter (wichtig für die
  // Reihenfolge der Skript-Shortcuts). Steht ein Key in BEIDEN Blöcken, behält
  // er die Position des TYP-Frontmatters, Wert, Floating-Markierung und
  // Shortcut kommen aber vom Subtyp - eine Zuweisung auf einen bereits vorhandenen
  // Objektschlüssel überschreibt ihn, ohne ihn zu verschieben. Die
  // Frontmatter-Sortierung muss dieselbe Regel verwenden, sonst würde sie
  // eine gerade angelegte Notiz sofort wieder umsortieren (siehe
  // orderedDefaultKeys in frontmatter-sort.js).
  getTypeDefaults(type, { includeFloating = false, file, subtype = null } = {}) {
    const { defaults, shortcuts } = this.collectBlocks(type, subtype, includeFloating);
    return resolveShortcuts(defaults, shortcuts, { file, app: this.app });
  }

  // Gemeinsame Grundlage von getTypeDefaults() und getTypeShortcuts(): das
  // TYP-Frontmatter des Typs, ergänzt um den Block des Subtyps. Ein Key, der in
  // BEIDEN Blöcken steht, behält die Position des TYP-Frontmatters; Wert,
  // Floating-Markierung UND Shortcut kommen dann vom Subtyp - auch "kein
  // Shortcut" gilt dabei als Angabe des Subtyps und hebt den des TYPs auf.
  collectBlocks(type, subtype, includeFloating) {
    const defaults = {};
    const shortcuts = {};
    const isFloating = new Map();
    const addBlock = (frontmatter, floatingKeys, blockShortcuts) => {
      const actualKeys = new Map(Object.keys(defaults).map((key) => [key.toLowerCase(), key]));
      for (const [key, value] of Object.entries(frontmatter ?? {})) {
        if (key === "") continue;
        const target = actualKeys.get(key.toLowerCase()) ?? key;
        defaults[target] = value;
        isFloating.set(target, (floatingKeys ?? []).includes(key));
        const record = (blockShortcuts ?? {})[key];
        if (record) shortcuts[target] = record;
        else delete shortcuts[target];
      }
    };
    const subtypeData = subtype ? getSubtype(this.settings, type, subtype) : null;
    addBlock(
      this.settings.typeDefaultFrontmatter[type],
      this.settings.typeFloatingKeys[type],
      this.settings.typeShortcuts[type]
    );
    if (subtypeData) addBlock(subtypeData.frontmatter, subtypeData.floatingKeys, subtypeData.shortcuts);

    if (!includeFloating) {
      for (const [key, floating] of isFloating) {
        if (!floating) continue;
        delete defaults[key];
        delete shortcuts[key];
      }
    }
    return { defaults, shortcuts };
  }

  // Für _obsidian/templater-scripts/TYP.js: die Properties dieses TYPs, deren
  // Wert beim Anlegen einer Notiz von einem Templater-Skript kommt -
  // { [Property]: { name, args, fallback } }, in der Reihenfolge des
  // TYP-Frontmatters (die Skripte laufen nacheinander und sehen die Ergebnisse
  // der jeweils früheren).
  //
  //   name     Skriptname, also tp.user.<name> - ohne "tp."-Präfix
  //   params   die im @typ-shortcut-Marker deklarierte Parameterliste des
  //            Skripts (siehe shortcut-scripts.js), oder null bei einem Marker
  //            ohne Klammern. Sie stammt aus dem aktuellen Scan, nicht aus dem
  //            gespeicherten Record - eine geänderte Deklaration wirkt also
  //            sofort. TYP.js macht daraus mit resolveShortcutArgs() unten die
  //            Argumentliste des Aufrufs
  //   args     die eingetippten Argumente, benannt nach den nicht reservierten
  //            Parametern. Leeres Objekt, wenn keine gesetzt sind; ein leer
  //            gelassenes Feld fehlt darin ganz, damit "args.x ?? fallback"
  //            im Skript trägt
  //   fallback der in der TYP-Ansicht hinterlegte feste Wert der Property. Nur
  //            als RÜCKFALL gedacht: schlägt das Skript fehl (fehlt oder
  //            wirft), schreibt TYP.js ihn statt eines leeren Werts. Ein
  //            Skript, das bewusst null/"" liefert (z. B. ESC im Picker), ist
  //            kein Fehlschlag - dort bleibt die Property leer.
  //
  // Die festen Shortcuts (today/now/created) tauchen hier NICHT auf: die löst
  // das Plugin selbst auf und liefert sie fertig über getTypeDefaults(). Dessen
  // Rückgabe führt die Skript-Keys mit dem Wert null - Key und Position bleiben
  // also erhalten, nur der Wert kommt von hier.
  //
  // Optionen wie bei getTypeDefaults(); includeFloating standardmäßig false,
  // damit für eine Floating Property nicht ungefragt ein Skript läuft.
  getTypeShortcuts(type, { includeFloating = false, subtype = null } = {}) {
    const { defaults, shortcuts } = this.collectBlocks(type, subtype, includeFloating);
    const skripte = this.getShortcutScripts?.() ?? [];
    const result = {};
    for (const [key, record] of Object.entries(shortcuts)) {
      const name = scriptNameOf(record.name);
      if (name === null) continue;
      const skript = skripte.find((s) => s.name === name);
      result[key] = {
        name,
        params: skript?.params ?? null,
        args: { ...(record.args ?? {}) },
        fallback: defaults[key] ?? null,
      };
    }
    return result;
  }

  // Für _obsidian/templater-scripts/TYP.js: macht aus der Parameterliste eines
  // Shortcuts die Argumente für den Aufruf tp.user.<name>(tp, ...) - siehe
  // resolveCallArgs in shortcuts.js. Die Auflösung lebt hier statt in TYP.js,
  // damit die Regeln (reservierte Namen, Punkt-Namen für Objekt-Argumente) nur
  // an einer Stelle stehen; newFile und ctx kennt allerdings nur TYP.js und
  // reicht sie deshalb herein.
  resolveShortcutArgs(params, args, { newFile = null, ctx = null, key = null } = {}) {
    return resolveCallArgs(params, args, { newFile, ctx, key });
  }

  // Für _obsidian/templater-scripts/TYP.js: registrierte Subtypen eines TYPs in
  // der Reihenfolge ihrer Blöcke, samt Notiz-Anzahl.
  //
  // Subtypen mit abgeschaltetem "Manuell erstellbar" (Icon links neben dem
  // Namen ihres Blocks, siehe renderSubtypeManualToggle in typ-view.js) bleiben
  // wie die so abgeschalteten TYPen in getTypes() außen vor - außer
  // includeManualOff ist gesetzt.
  getSubtypes(type, { includeManualOff = false } = {}) {
    const { counts } = this.typIndex.subtypeBucket(type);
    return getSubtypeNames(this.settings, type)
      .filter((subtype) => includeManualOff || isSubtypeManual(this.settings, type, subtype))
      .map((subtype) => ({ subtype, count: counts.get(subtype) ?? 0 }));
  }

  // Für _obsidian/templater-scripts/TYP.js: Subtyp-Picker (siehe
  // type-picker.js). Löst mit dem gewählten Subtyp auf, mit "" für "Kein
  // Subtyp" (bzw. ohne Picker, wenn der TYP keine Subtypen hat), oder mit
  // null bei ESC (TYP.js kehrt dann zur TYP-Auswahl zurück). query (optional):
  // eine schon getippte Suchanfrage, nach der die Liste vorsortiert steht.
  // options wie bei getSubtypes (includeManualOff).
  pickSubtype(type, query = "", options = {}) {
    return pickSubtypeModal(this.app, this, type, query, options);
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

  // Für _obsidian/templater-scripts/TYP.js: die im TYP-View registrierten TYPen
  // samt ihrer dort gepflegten Beschreibung, statt sie aus _obsidian/Typen.md zu parsen -
  // in derselben Reihenfolge, in der sie auch in der TYP-Liste selbst erscheinen
  // (aktuelle Sortiereinstellung dort, z. B. Häufigkeit oder Name).
  //
  // TYPen mit abgeschaltetem "Manuell erstellbar" (Icon in der TYP-Detailansicht)
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
    const stored = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
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
    // Anders als die übrigen Migrationen gleich schreiben: die eine rechnet
    // gespeicherte Zahlen um und darf das beim nächsten Start nicht erneut tun,
    // die andere entfernt einen Schlüssel, der sonst bei jedem Start wieder
    // gelesen würde - und die letzte ergänzt Schalter, die der Nutzer von da an
    // selbst umstellen kann und die ihm beim nächsten Start nicht erneut
    // überschrieben werden dürfen.
    const migrated = [
      migrateSubtypeColorScale(this.settings, DEFAULT_SUBTYPE_COLOR_RANGES),
      migrateTypListSecondary(this.settings, stored),
      dropTypListSubtypesAlign(this.settings),
      migrateSubtypeManual(this.settings),
    ];
    if (migrated.some(Boolean)) await this.saveSettings();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // Ruft Obsidian auf, wenn data.json von außen geändert wurde - in der Praxis
  // durch Obsidian Sync von einem anderen Gerät. Ohne das behielte dieses Gerät
  // seine alten Settings im Speicher und überschriebe die neuen beim nächsten
  // saveSettings(). Einen offenen Settings-Tab baut Obsidian danach selbst neu
  // auf (settingTab.update()); Einfärbungen und TYP-View hier.
  async onExternalSettingsChange() {
    await this.loadSettings();
    this.refreshTypColors();
  }
};
