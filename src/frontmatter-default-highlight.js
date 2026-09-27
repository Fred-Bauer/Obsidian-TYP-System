const { getSubtypeNames, getSubtype } = require("./subtypes");
const { subtypeColor } = require("./type-colors");

const TYP_PROPERTY = "TYP";
const TYP_VIEW_TYPE = "fred-typ-view";
const ALL_PROPERTIES_VIEW_TYPE = "all-properties";
const HIGHLIGHT_CLASS = "fred-typ-default-property";
// Floating Properties (siehe typeFloatingKeys in settings.js) - dieselbe
// Liste wie die übrigen Standard-Properties des Typs, aber kursiv statt fett
// markiert, analog zu HIGHLIGHT_CLASS.
const FLOATING_CLASS = "fred-typ-floating-property";

// Obsidian schreibt data-property-key intern immer klein (unabhängig von der
// Schreibweise im YAML) - Vergleich deshalb ebenfalls case-insensitive. TYP
// ist keine echte "Standard"-Property (ihr Wert ist immer der TYP-Name
// selbst) - falls doch noch irgendwo ein alter Eintrag herumliegt, hier
// ebenfalls ignorieren statt die TYP-Zeile fett zu markieren.
function rawKeysForType(type, defaults) {
  if (!type || !defaults) return null;
  const keys = Object.keys(defaults).filter((key) => key !== "" && key.toLowerCase() !== TYP_PROPERTY.toLowerCase());
  return keys.length > 0 ? keys.map((key) => key.toLowerCase()) : null;
}

// Frontmatter-Blöcke eines TYPs als Liste von { keys, floating } (jeweils
// lowercase): zuerst das TYP-Frontmatter des TYPs, danach - falls
// gewünscht - der Block eines bestimmten Subtyps (subtype) bzw. aller seiner
// Subtypen (subtype === ALL_SUBTYPES), siehe subtypes.js.
const ALL_SUBTYPES = Symbol("all-subtypes");

function blockOf(defaults, floatingKeys) {
  const keys = rawKeysForType(true, defaults) ?? [];
  return { keys, floating: new Set((floatingKeys ?? []).map((key) => key.toLowerCase())) };
}

function blocksForType(plugin, type, subtype) {
  const { settings } = plugin;
  const blocks = [blockOf(settings.typeDefaultFrontmatter[type], settings.typeFloatingKeys[type])];
  const subtypeNames = subtype === ALL_SUBTYPES ? getSubtypeNames(settings, type) : subtype ? [subtype] : [];
  for (const name of subtypeNames) {
    const data = getSubtype(settings, type, name);
    if (data) blocks.push(blockOf(data.frontmatter, data.floatingKeys));
  }
  return blocks;
}

// Liefert getrennte Sets für fett darzustellende ("standard") und kursiv
// darzustellende ("floating") Property-Namen (jeweils lowercase) aus den
// übergebenen Blöcken - Floating-markierte Keys zählen dabei nur zu
// "floating", nie zusätzlich zu "standard". Kommt ein Key in mehreren Blöcken
// vor (Subtyp überschreibt TYP), gilt die Markierung des späteren Blocks.
function splitKeys(blocks) {
  const isFloating = new Map();
  for (const { keys, floating } of blocks) {
    for (const key of keys) isFloating.set(key, floating.has(key));
  }
  const standard = new Set();
  const floating = new Set();
  for (const [key, flag] of isFloating) (flag ? floating : standard).add(key);
  return { standard: standard.size > 0 ? standard : null, floating: floating.size > 0 ? floating : null };
}

const NO_KEYS = { standard: null, floating: null };

function keysForFile(plugin, file) {
  const { colorViews } = plugin.settings;
  if (!colorViews.frontmatterDefaults) return NO_KEYS;
  const type = plugin.typIndex.typeOf(file);
  if (!type) return NO_KEYS;
  const subtype = colorViews.frontmatterDefaultsSubtyp ? plugin.typIndex.subtypeOf(file) : null;
  return splitKeys(blocksForType(plugin, type, subtype));
}

// Editor der TYP-Detailansicht: der gemeinsame Editor über alle Blöcke eines
// TYPs (store.unified, siehe unified-frontmatter-editor.js) - Subtyp-Blöcke
// nur mit dem Unter-Schalter "Subtyp" - bzw. ein einzelner Block (siehe
// typeStore/subtypeStore in type-frontmatter-editor.js).
function keysForStore(plugin, store) {
  const { colorViews } = plugin.settings;
  if (!colorViews.frontmatterDefaults || !store) return NO_KEYS;
  if (store.unified) {
    return splitKeys(blocksForType(plugin, store.type, colorViews.frontmatterDefaultsSubtyp ? ALL_SUBTYPES : null));
  }
  if (store.subtype && !colorViews.frontmatterDefaultsSubtyp) return NO_KEYS;
  return splitKeys([blockOf(store.getFrontmatter(), store.getFloating())]);
}

// Property-Name (lowercase) -> Map(TYP -> nur als Floating markiert?) über
// alle Typen, in deren Frontmatter (ggf. inkl. ihrer Subtyp-Blöcke) er
// vorkommt. Die "All Properties"-Ansicht ist vault-weit und kennt keinen
// einzelnen TYP-Kontext - daher hier statt eines einzelnen Fett-Flags gleich
// die vollständige Zuordnung sammeln, damit applyToAllPropertiesView zwischen
// "genau ein Typ" (einfärben) und "mehrere Typen" (fett) unterscheiden kann.
// Eigener Schalter (colorViews.allProperties), unabhängig von
// colorViews.frontmatterDefaults. Eine Subtyp-Property zählt für ihren TYP.
function typesUsingKeyMap(plugin) {
  const map = new Map();
  const { colorViews } = plugin.settings;
  if (!colorViews.allProperties) return map;
  const types = new Set([
    ...Object.keys(plugin.settings.typeDefaultFrontmatter),
    ...(colorViews.allPropertiesSubtyp ? Object.keys(plugin.settings.typeSubtypes ?? {}) : []),
  ]);
  for (const type of types) {
    const blocks = blocksForType(plugin, type, colorViews.allPropertiesSubtyp ? ALL_SUBTYPES : null);
    for (const { keys, floating } of blocks) {
      for (const key of keys) {
        if (!map.has(key)) map.set(key, new Map());
        const byType = map.get(key);
        byType.set(type, (byType.get(type) ?? true) && floating.has(key));
      }
    }
  }
  return map;
}

// Nur das Label (Property-Key-Input) fett/kursiv markieren, nicht die Werte -
// betrifft sowohl Notizen (Frontmatter im Dokument + "Properties"-
// Seitenleiste) als auch die eigene TYP-Detailansicht des Plugins selbst.
function applyToContainer(containerEl, standardKeys, floatingKeys) {
  if (!containerEl) return;
  const rows = containerEl.querySelectorAll(".metadata-property[data-property-key]");
  for (const row of rows) {
    const keyEl = row.querySelector(".metadata-property-key-input");
    if (!keyEl) continue;
    const propertyKey = row.getAttribute("data-property-key");
    keyEl.classList.toggle(HIGHLIGHT_CLASS, !!standardKeys && standardKeys.has(propertyKey));
    keyEl.classList.toggle(FLOATING_CLASS, !!floatingKeys && floatingKeys.has(propertyKey));
  }
}

// Die "All Properties"-Ansicht rendert ihre Zeilen nicht über das
// Metadata-Widget, sondern über eigene Tree-Item-Komponenten (Klasse "aH" im
// gebauten app.js), erreichbar über view.doms (Property-Name -> Komponente).
// Deren Titel-Element trägt die Klasse "tree-item-inner-text", nicht
// ".metadata-property-key-input" wie im Frontmatter-Widget.
//
// Nutzt genau ein Typ diese Property als Standard, wird der Name in dessen
// Farbe eingefärbt (wie der Farbpunkt/die Liste des Typs) - eindeutig genug,
// um sie zuzuordnen. Nutzen mehrere Typen sie, wäre eine einzelne Farbe
// irreführend, daher stattdessen fett (dieselbe Markierung wie im
// Frontmatter-Widget einer Notiz).
// Subtyp-Block eines TYPs, in dem ein Key steht (Vergleich ohne Groß-/
// Kleinschreibung), sonst null (TYP-Frontmatter).
function subtypeOfKey(plugin, type, key) {
  const lower = key.toLowerCase();
  return (
    getSubtypeNames(plugin.settings, type).find((name) =>
      Object.keys(getSubtype(plugin.settings, type, name)?.frontmatter ?? {}).some((k) => k.toLowerCase() === lower)
    ) ?? null
  );
}

function applyToAllPropertiesView(plugin) {
  const usageMap = typesUsingKeyMap(plugin);
  for (const leaf of plugin.app.workspace.getLeavesOfType(ALL_PROPERTIES_VIEW_TYPE)) {
    const doms = leaf.view?.doms;
    if (!doms) continue;
    for (const [key, dom] of Object.entries(doms)) {
      const titleEl = dom?.titleEl;
      if (!titleEl) continue;

      const types = usageMap.get(key.toLowerCase());
      const count = types ? types.size : 0;
      titleEl.classList.toggle(HIGHLIGHT_CLASS, count > 1);

      // Kursiv nur, wenn eindeutig genau ein TYP die Property nutzt UND sie
      // dort überall (TYP- wie Subtyp-Blöcke) als Floating markiert ist - bei
      // mehreren TYPs (Fett-Fall) wäre nicht klar, wessen Floating-Markierung
      // gemeint ist.
      let isFloating = false;
      if (count === 1) {
        const [[onlyType, onlyFloating]] = types;
        isFloating = onlyFloating;
        // Mit "Subtyp" in der Farbe des Subtyp-Blocks, aus dem die Property
        // stammt (jeder Key steht in genau einem Block des TYPs).
        const color = plugin.settings.colorViews.allPropertiesSubtyp
          ? subtypeColor(plugin.settings, onlyType, subtypeOfKey(plugin, onlyType, key))
          : plugin.settings.typeColors[onlyType];
        // !important via setProperty, da die Fett-Regel für .fred-typ-default-
        // property in styles.css ebenfalls !important color setzt und ein
        // Inline-Style ohne !important dagegen verlieren würde, falls die
        // Klasse (aus einem vorherigen Zustand mit mehreren Typen) noch dranhängt.
        if (color) titleEl.style.setProperty("color", color, "important");
        else titleEl.style.removeProperty("color");
      } else {
        titleEl.style.removeProperty("color");
      }
      titleEl.classList.toggle(FLOATING_CLASS, isFloating);
    }
  }
}

function applyFrontmatterDefaultHighlight(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view;
    const { standard, floating } = keysForFile(plugin, view?.file);
    applyToContainer(view?.metadataEditor?.containerEl, standard, floating);
  }

  // Die "Properties"-Seitenleiste zeigt immer die aktive Datei, hält aber
  // keine eigene, verlässliche Referenz darauf griffbereit wie MarkdownView -
  // daher auf die vom Workspace aktuell aktive Datei zurückfallen.
  for (const leaf of plugin.app.workspace.getLeavesOfType("file-properties")) {
    const view = leaf.view;
    const file = view?.file ?? plugin.app.workspace.getActiveFile();
    const { standard, floating } = keysForFile(plugin, file);
    applyToContainer(view?.metadataEditor?.containerEl, standard, floating);
  }

  // TYP-Detailansicht des Plugins selbst: dort zeigt jeder Editor direkt einen
  // Frontmatter-Block (TYP bzw. Subtyp), entspricht also 1:1 dessen
  // "Standard"- bzw. "Floating"-Properties (view.frontmatterEditors kommt aus
  // typ-view.js, editor.owner.fredStore aus type-frontmatter-editor.js).
  for (const leaf of plugin.app.workspace.getLeavesOfType(TYP_VIEW_TYPE)) {
    for (const editor of leaf.view?.frontmatterEditors ?? []) {
      const { standard, floating } = keysForStore(plugin, editor.owner?.fredStore);
      applyToContainer(editor.containerEl, standard, floating);
    }
  }

  applyToAllPropertiesView(plugin);
}

function registerFrontmatterDefaultHighlight(plugin) {
  const refresh = () => applyFrontmatterDefaultHighlight(plugin);

  plugin.registerEvent(plugin.app.metadataCache.on("changed", refresh));
  plugin.registerEvent(plugin.app.metadataCache.on("resolved", refresh));
  plugin.registerEvent(plugin.app.workspace.on("layout-change", refresh));
  plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", refresh));

  plugin.app.workspace.onLayoutReady(refresh);

  return refresh;
}

module.exports = { registerFrontmatterDefaultHighlight };
