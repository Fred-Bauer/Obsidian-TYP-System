const { colorForFile } = require("./type-colors");

const BACKLINK_VIEW_TYPE = "backlink";

// Das Backlinks-Pane (Seitenleiste) rendert Treffer intern über dieselbe
// SearchResultDom-Klasse wie die Suche. Verlinkte und nicht verlinkte
// Erwähnungen liegen als zwei resultDomLookup-Maps im BacklinkRenderer
// (view.backlink) - Feldnamen sind nicht offiziell dokumentiert, daher
// mehrere bekannte Pfade probieren statt einen fest anzunehmen.
function getResultDomLookups(view) {
  const renderer = view?.backlink;
  const candidates = [renderer?.backlinkDom, renderer?.unlinkedDom, view?.backlinkDom, view?.unlinkedDom, view?.dom];

  const lookups = [];
  for (const dom of candidates) {
    if (dom?.resultDomLookup instanceof Map) lookups.push(dom.resultDomLookup);
  }
  return lookups;
}

function colorTitleEl(plugin, el, file) {
  const color = plugin.settings.colorViews.backlinks ? colorForFile(plugin, file, "backlinks") : null;
  if (color) el.style.color = color;
  else el.style.removeProperty("color");
}

function applyBacklinkPaneColors(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType(BACKLINK_VIEW_TYPE)) {
    for (const lookup of getResultDomLookups(leaf.view)) {
      for (const [file, resultDom] of lookup) {
        const titleEl = resultDom.el?.querySelector(".search-result-file-title .tree-item-inner");
        if (titleEl) colorTitleEl(plugin, titleEl, file);
      }
    }
  }
}

// "Backlinks im Dokument" ist keine eigene Ansicht/kein eigener Leaf, sondern
// unten in die MarkdownView eingebettet (.embedded-backlinks) - hier reicht
// kein Leaf-Typ, stattdessen über offene Markdown-Leaves nach der DOM-Klasse
// suchen. Ohne data-path je Zeile wird die Datei über den angezeigten
// Dateinamen (Linktext) aufgelöst, wie Obsidian intern Links auflöst.
function applyEmbeddedBacklinkColors(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
    const paneEl = leaf.view.containerEl.querySelector(".embedded-backlinks .backlink-pane");
    if (!paneEl) continue;

    const sourcePath = leaf.view.file?.path ?? "";
    const titleEls = paneEl.querySelectorAll(".search-result-file-title .tree-item-inner");
    for (const titleEl of titleEls) {
      const basename = titleEl.textContent;
      const file = basename ? plugin.app.metadataCache.getFirstLinkpathDest(basename, sourcePath) : null;
      colorTitleEl(plugin, titleEl, file);
    }
  }
}

function applyBacklinkColors(plugin) {
  applyBacklinkPaneColors(plugin);
  applyEmbeddedBacklinkColors(plugin);
}

function registerBacklinkColors(plugin) {
  const refresh = () => applyBacklinkColors(plugin);

  // Nur das (kleine) Backlinks-Pane in der Seitenleiste per MutationObserver
  // beobachten - NICHT die MarkdownView-Container, da deren Editor-Subtree bei
  // jedem Tastendruck viele Mutationen erzeugt (siehe Warnung in
  // database-folders.js: ein subtree-Observer über einen Editor-nahen Container
  // hat dieses Vault schon einmal komplett eingefroren). Die eingebetteten
  // Backlinks im Dokument brauchen dafür keinen eigenen Observer: sie ändern
  // sich nur, wenn irgendwo im Vault Links hinzukommen/wegfallen oder beim
  // Öffnen/Wechseln einer Notiz - beides ist über die Events unten bereits
  // abgedeckt ("resolved" nach jeder Link-Auflösung, layout-change/
  // active-leaf-change lösen ohnehin applyBacklinkColors() und damit auch
  // applyEmbeddedBacklinkColors() aus).
  const observer = new MutationObserver(refresh);
  const observeLeaves = () => {
    for (const leaf of plugin.app.workspace.getLeavesOfType(BACKLINK_VIEW_TYPE)) {
      observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
    }
  };
  plugin.register(() => observer.disconnect());

  plugin.registerEvent(plugin.typIndex.on("change", refresh));
  // Nur der eingebettete Teil hängt (mangels eigenem Observer, siehe oben)
  // weiterhin an der Link-Auflösung - die Seitenleiste deckt ihr Observer ab.
  plugin.registerEvent(plugin.app.metadataCache.on("resolved", () => applyEmbeddedBacklinkColors(plugin)));
  plugin.registerEvent(
    plugin.app.workspace.on("layout-change", () => {
      observeLeaves();
      refresh();
    })
  );
  plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", refresh));

  plugin.app.workspace.onLayoutReady(() => {
    observeLeaves();
    refresh();
  });

  return refresh;
}

module.exports = { registerBacklinkColors };
