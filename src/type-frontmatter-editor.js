const { MarkdownView, Menu } = require("obsidian");
const { isPlaceholderToken } = require("./frontmatter-placeholders");
const { EDITOR_CLASS: PLACEHOLDER_SUGGEST_EDITOR_CLASS } = require("./placeholder-suggest");
const { getSubtype, ensureSubtype } = require("./subtypes");

const TYP_PROPERTY = "TYP";
const SUBTYP_PROPERTY = "SUBTYP";
const SYSTEM_PROPERTIES = [TYP_PROPERTY.toLowerCase(), SUBTYP_PROPERTY.toLowerCase()];

// Der Wert der TYP- bzw. SUBTYP-Property ist per Definition immer der Name des
// TYPs/Subtyps selbst - als "Standard"-Property wäre sie also redundant und
// könnte bei einer Umbenennung (unbemerkt) vom tatsächlichen Namen abweichen.
// Sie darf deshalb in diesem Editor gar nicht erst als eigene Zeile auftauchen.
// Mutiert "frontmatter" in-place (statt eine Kopie zurückzugeben) - Obsidians
// Property-Editor scheint beim synchronize() auf eine stabile Objektreferenz
// angewiesen zu sein; eine neu erzeugte Kopie hat beim allerersten Rendern zu
// einem Stack Overflow in Obsidians eigener renderProperty()-Pipeline geführt.
function stripTypProperty(frontmatter) {
  for (const key of Object.keys(frontmatter)) {
    if (SYSTEM_PROPERTIES.includes(key.trim().toLowerCase())) delete frontmatter[key];
  }
  return frontmatter;
}

// Speicherort eines Frontmatter-Blocks in den Plugin-Settings - entweder das
// TYP-Frontmatter eines TYPs (typeDefaultFrontmatter/typeFloatingKeys)
// oder der Block eines seiner Subtypen (typeSubtypes, siehe subtypes.js).
// Editor, Floating-Menü und Property-Umbenennung arbeiten ausschließlich über
// diese Schnittstelle und müssen den Unterschied nicht kennen.
function typeStore(plugin, type) {
  return {
    type,
    subtype: null,
    getFrontmatter: () => plugin.settings.typeDefaultFrontmatter[type] ?? {},
    setFrontmatter: (frontmatter) => {
      plugin.settings.typeDefaultFrontmatter[type] = frontmatter;
    },
    getFloating: () => plugin.settings.typeFloatingKeys[type] ?? [],
    setFloating: (keys) => {
      if (keys.length > 0) plugin.settings.typeFloatingKeys[type] = keys;
      else delete plugin.settings.typeFloatingKeys[type];
    },
  };
}

function subtypeStore(plugin, type, subtype) {
  return {
    type,
    subtype,
    getFrontmatter: () => getSubtype(plugin.settings, type, subtype)?.frontmatter ?? {},
    setFrontmatter: (frontmatter) => {
      ensureSubtype(plugin.settings, type, subtype).frontmatter = frontmatter;
    },
    getFloating: () => getSubtype(plugin.settings, type, subtype)?.floatingKeys ?? [],
    setFloating: (keys) => {
      ensureSubtype(plugin.settings, type, subtype).floatingKeys = keys;
    },
  };
}

// Obsidians eigenes Frontmatter-Widget ("Properties") ist keine offizielle
// Plugin-API. Intern ist es eine Component-Klasse (im gebauten app.js zu
// "MetadataEditor" minifiziert), die sowohl von jeder MarkdownView als auch von
// der eingebauten "File Properties"-Pane verwendet wird - beide legen sich beim
// Erzeugen unconditional eine Instanz unter view.metadataEditor an. Die Klasse
// selbst wird nirgends unter einem Namen exportiert, ist aber über eine
// beliebige bereits vorhandene Instanz erreichbar (instance.constructor) und
// bleibt für die Dauer der Obsidian-Session stabil - einmaliges Abgreifen und
// Zwischenspeichern reicht deshalb aus.
let cachedEditorClass = null;

function getMetadataEditorClass(app) {
  if (cachedEditorClass) return cachedEditorClass;

  const active = app.workspace.getActiveViewOfType(MarkdownView);
  if (active?.metadataEditor) {
    cachedEditorClass = active.metadataEditor.constructor;
    return cachedEditorClass;
  }
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    if (leaf.view?.metadataEditor) {
      cachedEditorClass = leaf.view.metadataEditor.constructor;
      return cachedEditorClass;
    }
  }
  return null;
}

// Analog zu getMetadataEditorClass oben: Referenz auf die private Property-
// Zeilen-Klasse (im gebauten app.js minifiziert), über eine bereits
// gerenderte Zeile abgegriffen (deren .constructor) - stabil für die Dauer
// der Session. "editor" (falls schon vorhanden) wird zuerst probiert, da
// diese Klasse ausschließlich für ensurePropertyMenuPatch() gebraucht wird
// und in aller Regel schon dort verfügbar ist, sobald der Typ mindestens
// eine Property hat.
let cachedPropertyRowClass = null;

function getPropertyRowClass(app, editor) {
  if (cachedPropertyRowClass) return cachedPropertyRowClass;
  if (editor?.rendered?.[0]) {
    cachedPropertyRowClass = editor.rendered[0].constructor;
    return cachedPropertyRowClass;
  }
  const active = app.workspace.getActiveViewOfType(MarkdownView);
  if (active?.metadataEditor?.rendered?.[0]) {
    cachedPropertyRowClass = active.metadataEditor.rendered[0].constructor;
    return cachedPropertyRowClass;
  }
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    if (leaf.view?.metadataEditor?.rendered?.[0]) {
      cachedPropertyRowClass = leaf.view.metadataEditor.rendered[0].constructor;
      return cachedPropertyRowClass;
    }
  }
  return null;
}

// Ergänzt das Rechtsklick-Kontextmenü einer Property-Zeile um einen Toggle
// "Floating" GANZ OBEN - aber exklusiv für Zeilen dieses Plugins
// eigener TYP-Detailansicht (erkannt an owner.fredStore, siehe unten), nie in
// echten Notizen. Unabhängig vom "+"-Button links neben dem normalen
// (fredPendingFloatingAdd), der nur beim NEUEN Anlegen greift - dieser Toggle
// wirkt auf JEDE bereits vorhandene Property, in beide Richtungen.
//
// Obsidians Property-Kontextmenü ist keine offizielle Erweiterungsstelle: Es
// baut auf dem Desktop einen NATIVEN Electron-Menü aus einer intern
// erzeugten Menu-Instanz und zeigt sie innerhalb von showPropertyMenu() in
// einem einzigen synchronen Aufruf an (kein Workspace-Event, kein DOM-Popup,
// das sich nachträglich per DOM-Manipulation erweitern ließe - anders als
// z. B. bei "file-menu"). Deshalb hier ein Monkey-Patch auf die private
// Zeilen-Klasse selbst (wie schon beim Graph-Renderer, siehe
// graph-colors.js), aber so eng wie möglich gehalten: für Zeilen dieses
// Plugins wird lediglich, unmittelbar bevor Obsidian seine bereits fertig
// aufgebaute Menu-Instanz anzeigt, ein einziger zusätzlicher addItem()-Aufruf
// dazwischengeschoben (über einen nur für diesen einen synchronen Aufruf
// aktiven, sich danach selbst wieder zurücksetzenden Patch auf
// Menu.prototype.showAtMouseEvent - sicher, da JS single-threaded ist und
// währenddessen kein zweites Menü aufgebaut werden kann). Die gesamte übrige
// native Menü-Logik (Typ ändern, Ausschneiden/Kopieren/Einfügen, Entfernen)
// bleibt dabei komplett unangetastet.
function ensurePropertyMenuPatch(app, editor) {
  const RowClass = getPropertyRowClass(app, editor);
  if (!RowClass || RowClass._fredMenuPatched) return;
  RowClass._fredMenuPatched = true;

  const originalShowPropertyMenu = RowClass.prototype.showPropertyMenu;
  RowClass.prototype.showPropertyMenu = function (event) {
    const owner = this.metadataEditor?.owner;
    if (!owner?.fredStore) return originalShowPropertyMenu.call(this, event);

    const row = this;
    const originalShowAtMouseEvent = Menu.prototype.showAtMouseEvent;
    Menu.prototype.showAtMouseEvent = function (mouseEvent) {
      Menu.prototype.showAtMouseEvent = originalShowAtMouseEvent;
      const isFloating = owner.fredStore.getFloating().includes(row.entry.key);
      // "title" ist die erste der von showPropertyMenu registrierten
      // Sections (addSections([...])) und auf dem Desktop sonst leer (nur
      // auf Mobile mit einem reinen Label-Eintrag belegt) - landet also
      // zuverlässig ganz oben. "pin-off" (durchgestrichener Pin) passt
      // inhaltlich zu "nicht fest verankert" = floating, in Analogie zu
      // "pin" für "fixiert" in anderen Apps.
      this.addItem((item) =>
        item
          .setTitle("Floating")
          .setIcon("pin-off")
          .setChecked(isFloating)
          .setSection("title")
          .onClick(() => toggleFloatingProperty(owner.fredView, owner.fredStore, row.entry.key))
      );
      return originalShowAtMouseEvent.call(this, mouseEvent);
    };

    return originalShowPropertyMenu.call(this, event);
  };
}

function toggleFloatingProperty(view, store, key) {
  const floating = store.getFloating();
  store.setFloating(floating.includes(key) ? floating.filter((k) => k !== key) : [...floating, key]);
  view.plugin.saveSettings();
  // Aktualisiert die Fett-/Kursiv-Markierung sofort - sowohl in dieser
  // Detailansicht als auch in bereits offenen Notizen dieses Typs.
  view.plugin.refreshTypColors?.();
}

// Das Widget erwartet als zweiten Konstruktor-Parameter ein "owner"-Objekt -
// das ist die einzige Schnittstelle, über die es an eine Datei gebunden wird.
// Statt einer echten Notiz hängen wir es hier an ein Plain-Object in den
// Plugin-Settings: saveFrontmatter(obj) bekommt bei jeder Änderung (Property
// hinzugefügt/umbenannt/gelöscht, Wert geändert, Reihenfolge geändert) das
// vollständige, aktuelle Property-Set übergeben. shiftFocusBefore/After steuern
// nur, wohin der Fokus beim Verlassen des Widgets per Pfeiltaste/Tab springt,
// und dürfen No-Ops sein. getFile() wird von jeder einzelnen Property-Zeile
// beim Rendern aufgerufen (für sourcePath, z. B. bei Link-Werten) - ohne
// echte Datei gibt es hier nichts Sinnvolles zurückzugeben, aber die Methode
// muss existieren, sonst crasht das Widget beim Rendern jeder Property.
//
// Eine Editor-Instanz je Block (TYP bzw. Subtyp), gebunden an den Speicherort
// aus store (siehe typeStore/subtypeStore) - Standard- und Floating Properties
// (siehe typeFloatingKeys in settings.js) teilen sich dieselbe Liste und
// Reihenfolge, nur Floating-markierte Keys werden von getTypeDefaults()
// (main.js) nicht automatisch ausgeliefert. editor.fredPendingFloatingAdd wird
// von typ-view.js vor addBlankProperty() gesetzt, um die als nächstes
// hinzugefügte (bzw. umbenannte) Property als Floating zu markieren - siehe
// saveFrontmatter unten.
// Tastatur-Navigation über die Grenzen einer Editor-Instanz hinaus (siehe
// frontmatter-blocks.js): Obsidian bewegt den Fokus nur innerhalb seiner
// eigenen Zeilenliste - am oberen Ende springt er auf die Überschrift des
// Editors, am unteren auf dessen "Add property"-Button. Beide sind hier per
// CSS ausgeblendet, die Kette endete also am Blockrand.
//
// Statt owner.shiftFocusBefore/shiftFocusAfter (die Obsidian nur über genau
// diese beiden ausgeblendeten Elemente erreicht) daher ein eigener Handler in
// der Capture-Phase, der VOR dem Handler der Zeile läuft. Er greift nur, wenn
// die Zeile SELBST den Fokus hat (event.target === containerEl der Zeile) -
// genau die Bedingung, unter der auch Obsidian seine j/k-Navigation zulässt,
// beim Tippen in einem Key-/Wert-Feld also nie.
function registerFocusChain(editor, onShiftFocus) {
  editor.containerEl.addEventListener(
    "keydown",
    (event) => {
      if (event.isComposing || event.defaultPrevented) return;
      // Mehrfach-Auswahl: Obsidian erweitert damit die Auswahl, statt den
      // Fokus zu bewegen.
      if (editor.selectedLines?.size > 1) return;
      if (event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) return;

      const index = editor.rendered.findIndex((row) => row.containerEl === event.target);
      if (index === -1) return;

      const up = event.key === "ArrowUp" || event.key === "k" || (event.key === "Tab" && event.shiftKey);
      const down = event.key === "ArrowDown" || event.key === "j" || (event.key === "Tab" && !event.shiftKey);
      let step = 0;
      if (up && index === 0) step = -1;
      else if (down && index === editor.rendered.length - 1) step = 1;
      if (step === 0 || !onShiftFocus(step)) return;

      event.preventDefault();
      event.stopPropagation();
    },
    true
  );
}

function mountFrontmatterEditor(view, containerEl, store, { onShiftFocus } = {}) {
  const app = view.app;
  const EditorClass = getMetadataEditorClass(app);
  if (!EditorClass) {
    containerEl.createEl("p", {
      cls: "fred-typ-frontmatter-unavailable",
      text: "Zum Initialisieren des Editors bitte zuerst einmal eine Notiz öffnen.",
    });
    return null;
  }

  const owner = {
    app,
    // Marker für ensurePropertyMenuPatch() oben: identifiziert Property-
    // Zeilen dieses Plugin-eigenen Editors (nie einer echten Notiz) und
    // liefert Speicherort/View, die der globale Menü-Patch pro Zeile
    // dynamisch braucht (die Patch-Installation selbst passiert nur einmal,
    // unabhängig davon, welcher Block dabei gerade offen war).
    fredStore: store,
    fredView: view,
    getFile() {
      return null;
    },
    // Nur für Obsidians Hover-Preview bei internen Links innerhalb eines
    // Property-Werts (Event "hover-link") - beliebiger String reicht.
    getHoverSource() {
      return "fred-typ-frontmatter";
    },
    shiftFocusBefore() {},
    shiftFocusAfter() {},
    // Obsidians Editor ruft dies genau einmal pro abgeschlossener Änderung auf
    // (Rename erst beim Blur des Key-Inputs, siehe handleUpdateKey im
    // gebauten app.js) - jeder Aufruf trägt hier also maximal eine
    // hinzugefügte und/oder entfernte (nicht-leere) Property, nie mehrere
    // gleichzeitig außer bei einem Mehrfach-Löschen. Das macht die
    // Floating-Markierung unten robust nachführbar, ohne Zwischenzustände
    // während des Tippens verfolgen zu müssen.
    saveFrontmatter(frontmatter) {
      // Falls hier gerade eine Zeile "TYP"/"SUBTYP" eingegeben wurde: nicht übernehmen.
      // Sie bleibt bis zum nächsten Neu-Mounten sichtbar (kein erneuter
      // synchronize()-Aufruf hier, siehe Kommentar an stripTypProperty).
      stripTypProperty(frontmatter);

      const previous = store.getFrontmatter();
      const previousKeys = Object.keys(previous).filter((key) => key !== "");
      const currentKeys = Object.keys(frontmatter).filter((key) => key !== "");
      const removedKeys = previousKeys.filter((key) => !currentKeys.includes(key));
      const addedKeys = currentKeys.filter((key) => !previousKeys.includes(key));

      let floating = store.getFloating();
      if (removedKeys.length === 1 && addedKeys.length === 1) {
        // Umbenennung einer bestehenden Property - Floating-Markierung wandert mit um.
        floating = floating.map((key) => (key === removedKeys[0] ? addedKeys[0] : key));
      } else {
        if (removedKeys.length > 0) floating = floating.filter((key) => !removedKeys.includes(key));
        if (editor.fredPendingFloatingAdd && addedKeys.length === 1) {
          floating = [...floating, addedKeys[0]];
          editor.fredPendingFloatingAdd = false;
        }
      }
      store.setFrontmatter(frontmatter);
      store.setFloating(floating);
      view.plugin.saveSettings();
      // Damit die Fett-/Kursiv-Markierung in bereits offenen Notizen dieses
      // Typs sofort mitzieht, wenn sich hier die Property-Liste ändert.
      view.plugin.refreshTypColors?.();
    },
  };

  const editor = new EditorClass(app, owner);
  editor.fredPendingFloatingAdd = false;
  if (onShiftFocus) registerFocusChain(editor, onShiftFocus);
  // Grenzt die Platzhalter-Vorschläge (placeholder-suggest.js) auf diesen Editor ein.
  editor.containerEl.addClass(PLACEHOLDER_SUGGEST_EDITOR_CLASS);
  containerEl.appendChild(editor.containerEl);
  view.addChild(editor);

  const defaults = store.getFrontmatter();
  const hadTyp = Object.keys(defaults).some((key) => SYSTEM_PROPERTIES.includes(key.trim().toLowerCase()));
  stripTypProperty(defaults);
  // Ein beim Laden noch vorhandenes TYP (z. B. aus einer älteren Plugin-Version)
  // dauerhaft entfernen, statt es nur für diese Session zu verstecken.
  if (hadTyp) view.plugin.saveSettings();
  editor.synchronize(defaults);
  markPlaceholderRows(editor.containerEl, defaults);
  // Erst nach dem ersten synchronize() versucht (siehe getPropertyRowClass) -
  // bei einem noch ganz leeren Typ hier ein No-Op, holt sich aber spätestens
  // beim nächsten Mounten eines nicht-leeren Typs (oder aus einer offenen
  // Notiz) die benötigte Klassenreferenz automatisch nach.
  ensurePropertyMenuPatch(app, editor);
  return editor;
}

// Obsidians eigenes "Type mismatch, expected ..."-Warnsymbol (oranges Dreieck,
// Klasse "metadata-property-warning-icon", direktes Kind von ".metadata-property
// [data-property-key]") vergleicht den erwarteten mit dem aus dem Wert erkannten
// Typ - bei einem Platzhalter wie "{{today}}" in einer als "date" deklarierten
// Property (siehe .obsidian/types.json) schlägt das zwangsläufig an, obwohl der
// Wert erst über getTypeDefaults() aufgelöst wird. Obsidian blendet das Icon
// über Inline-style.display ein (kein hidden-Attribut) - eine !important-Regel
// in styles.css gewinnt trotzdem dagegen, die betroffene Zeile braucht dafür nur
// diese Marker-Klasse.
function markPlaceholderRows(containerEl, frontmatter) {
  for (const row of containerEl.querySelectorAll(".metadata-property")) {
    // data-property-key liegt bei Obsidian kleingeschrieben vor (z. B. "datum"),
    // unsere frontmatter-Keys aber wie eingetragen (z. B. "Datum") - daher hier
    // case-insensitiv gegen die echten Keys abgleichen statt direkt zu indizieren.
    const rowKey = row.getAttribute("data-property-key");
    const actualKey = Object.keys(frontmatter).find((k) => k.toLowerCase() === rowKey?.toLowerCase());
    row.toggleClass("fred-typ-placeholder-value", isPlaceholderToken(frontmatter[actualKey]));
  }
}

// Eigene, einfache "Property hinzufügen"-Funktion statt des internen
// editor.addProperty(): fügt einen leeren Key mit Wert null an und lässt das
// Widget die Zeile ganz normal rendern (dieselbe Optik wie in einer echten
// Notiz, da synchronize() unverändert Obsidians eigene Render-Pipeline
// durchläuft) - der Fokus springt anschließend ins Key-Feld der neuen Zeile.
function addBlankProperty(editor) {
  if (!editor) return;
  const current = editor.serialize();
  if (!current.hasOwnProperty("")) {
    current[""] = null;
    editor.synchronize(current);
  }
  editor.focusKey("");
  // Deckt den Fall ab, dass mountFrontmatterEditor() bei einem zu diesem
  // Zeitpunkt noch ganz leeren Typ (und ohne offene Notiz) keine Zeilen-Klasse
  // zum Patchen finden konnte - jetzt existiert mit der gerade angelegten
  // Zeile garantiert mindestens eine.
  ensurePropertyMenuPatch(editor.owner.app, editor);
}

module.exports = { mountFrontmatterEditor, addBlankProperty, ensurePropertyMenuPatch, typeStore, subtypeStore };
