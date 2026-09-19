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

function floatingKeySet(plugin, type) {
  return new Set((plugin.settings.typeFloatingKeys[type] ?? []).map((key) => key.toLowerCase()));
}

// Liefert getrennte Sets für fett darzustellende ("standard") und kursiv
// darzustellende ("floating") Property-Namen (jeweils lowercase) - beide
// stammen aus derselben typeDefaultFrontmatter-Liste, Floating-markierte Keys
// zählen dabei nur zu "floating", nie zusätzlich zu "standard".
function keysForType(plugin, type) {
  if (!plugin.settings.colorViews.frontmatterDefaults) return { standard: null, floating: null };
  if (!type) return { standard: null, floating: null };
  const allKeys = rawKeysForType(type, plugin.settings.typeDefaultFrontmatter[type]);
  if (!allKeys) return { standard: null, floating: null };
  const floating = floatingKeySet(plugin, type);
  const standardKeys = allKeys.filter((key) => !floating.has(key));
  const floatingKeys = allKeys.filter((key) => floating.has(key));
  return {
    standard: standardKeys.length > 0 ? new Set(standardKeys) : null,
    floating: floatingKeys.length > 0 ? new Set(floatingKeys) : null,
  };
}

function keysForFile(plugin, file) {
  if (!file || file.extension !== "md") return { standard: null, floating: null };
  const value = plugin.app.metadataCache.getFileCache(file)?.frontmatter?.[TYP_PROPERTY];
  if (!value) return { standard: null, floating: null };
  const type = String(Array.isArray(value) ? value[0] : value).trim();
  return keysForType(plugin, type);
}

// Property-Name (lowercase) -> Set der Typen, in deren Standard-Frontmatter
// er vorkommt. Die "All Properties"-Ansicht ist vault-weit und kennt keinen
// einzelnen TYP-Kontext - daher hier statt eines einzelnen Fett-Flags gleich
// die vollständige Zuordnung sammeln, damit applyToAllPropertiesView zwischen
// "genau ein Typ" (einfärben) und "mehrere Typen" (fett) unterscheiden kann.
// Eigener Schalter (colorViews.allProperties), unabhängig von
// colorViews.frontmatterDefaults.
function typesUsingKeyMap(plugin) {
  const map = new Map();
  if (!plugin.settings.colorViews.allProperties) return map;
  for (const [type, defaults] of Object.entries(plugin.settings.typeDefaultFrontmatter)) {
    const keys = rawKeysForType(type, defaults);
    if (!keys) continue;
    for (const key of keys) {
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(type);
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
      // dort als Floating markiert ist - bei mehreren TYPs (Fett-Fall) wäre
      // nicht klar, wessen Floating-Markierung gemeint ist.
      let isFloating = false;
      if (count === 1) {
        const [onlyType] = types;
        isFloating = floatingKeySet(plugin, onlyType).has(key.toLowerCase());
        const color = plugin.settings.typeColors[onlyType];
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

  // TYP-Detailansicht des Plugins selbst: dort zeigt der Editor direkt das
  // Standard-Frontmatter des gerade ausgewählten Typs, entspricht also 1:1
  // den "Standard"- bzw. "Floating"-Properties (view.selectedType/
  // .frontmatterEditor kommen aus typ-view.js).
  for (const leaf of plugin.app.workspace.getLeavesOfType(TYP_VIEW_TYPE)) {
    const view = leaf.view;
    const { standard, floating } = keysForType(plugin, view?.selectedType);
    applyToContainer(view?.frontmatterEditor?.containerEl, standard, floating);
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
