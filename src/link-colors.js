const { editorInfoField, getLinkpath } = require("obsidian");
const { ViewPlugin, Decoration } = require("@codemirror/view");
const { Prec, RangeSetBuilder, StateEffect } = require("@codemirror/state");
const { syntaxTree } = require("@codemirror/language");
const { colorForFile } = require("./type-colors");

// Links im Notiztext nach dem TYP ihres Ziels einfärben. Obsidian färbt
// interne Links in beiden Darstellungen über var(--link-color) bzw.
// var(--link-color-hover) (siehe app.css: ".markdown-rendered .internal-link"
// und ".cm-s-obsidian span.cm-hmd-internal-link") - statt eigener Farbregeln
// wird daher nur --link-color je Link überschrieben. --link-color-hover bleibt
// bewusst unangetastet: beim Überfahren erscheint wieder die normale
// Link-Farbe. Unterstreichung und Theme-Anpassungen bleiben ebenso erhalten.
//
// Zwei getrennte Wege, da sich die Darstellungen grundlegend unterscheiden:
//  - Lese-Modus, Hover-Vorschau, gerenderte Blöcke in Live Preview (Tabellen,
//    Callouts): echte <a class="internal-link" data-href="…">-Elemente aus
//    Obsidians Markdown-Renderer -> MarkdownPostProcessor, je Link einmalig
//    beim Rendern.
//  - Live Preview/Quelltext-Modus: dort gibt es keine Link-Elemente mit
//    Zielattribut, nur CodeMirror-Spans (".cm-hmd-internal-link") über dem
//    Rohtext -> eigener ViewPlugin, der nur den sichtbaren Bereich betrachtet.
//
// Neu eingefärbt wird darüber hinaus nur bei tatsächlich geändertem TYP
// (typIndex "change") oder geänderter Einstellung - nicht bei jedem Speichern.

const COLOR_VAR = "--link-color";
const SOURCE_ATTR = "data-fred-typ-src";

// [[Ziel]], [[Ziel|Alias]], [[Ziel#Überschrift]] - Einbettungen (![[…]])
// bleiben außen vor, die sind keine Links im eigentlichen Sinn. In Tabellen
// steht die Alias-Pipe escaped ("\|").
const WIKILINK_PATTERN = /(?<!!)\[\[([^[\]]+?)\]\]/g;

function colorForLinktext(plugin, linktext, sourcePath) {
  const target = linktext.split(/\\?\|/)[0].trim();
  const linkpath = getLinkpath(target);
  if (!linkpath) return null;
  const file = plugin.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
  return colorForFile(plugin, file, "links");
}

// --- Lese-Modus ---------------------------------------------------------

function applyToAnchor(plugin, anchorEl) {
  const href = anchorEl.getAttribute("data-href");
  const color =
    plugin.settings.colorViews.links && href && !anchorEl.classList.contains("is-unresolved")
      ? colorForLinktext(plugin, href, anchorEl.getAttribute(SOURCE_ATTR) ?? "")
      : null;
  if (color) anchorEl.style.setProperty(COLOR_VAR, color);
  else anchorEl.style.removeProperty(COLOR_VAR);
}

// Bereits gerenderte Links neu einfärben (TYP- oder Einstellungsänderung). Der
// Post-Processor merkt sich dafür an jedem Link dessen Quellnotiz, da die zur
// Auflösung mehrdeutiger Linktexte gebraucht wird. Alle Fenster (Pop-outs)
// über ihre Leaves eingesammelt.
function refreshRenderedLinks(plugin) {
  const docs = new Set();
  plugin.app.workspace.iterateAllLeaves((leaf) => docs.add(leaf.view.containerEl.ownerDocument));
  for (const doc of docs) {
    for (const anchorEl of doc.querySelectorAll(`a.internal-link[${SOURCE_ATTR}]`)) applyToAnchor(plugin, anchorEl);
  }
}

// --- Live Preview -------------------------------------------------------

const refreshEffect = StateEffect.define();

function buildLinkViewPlugin(plugin) {
  const decorationsByColor = new Map();
  const decorationFor = (color) => {
    let decoration = decorationsByColor.get(color);
    if (!decoration) {
      decoration = Decoration.mark({
        class: "fred-typ-link",
        attributes: { style: `${COLOR_VAR}: ${color};` },
      });
      decorationsByColor.set(color, decoration);
    }
    return decoration;
  };

  const build = (view) => {
    if (!plugin.settings.colorViews.links) return Decoration.none;
    const sourcePath = view.state.field(editorInfoField, false)?.file?.path ?? "";
    const tree = syntaxTree(view.state);
    const builder = new RangeSetBuilder();

    for (const { from, to } of view.visibleRanges) {
      const text = view.state.sliceDoc(from, to);
      WIKILINK_PATTERN.lastIndex = 0;
      for (let match; (match = WIKILINK_PATTERN.exec(text)); ) {
        const start = from + match.index;
        // Nur, was Obsidians Markdown-Parser selbst als internen Link erkennt -
        // schließt z. B. [[…]] in Code-Blöcken oder Inline-Code aus.
        if (!tree.resolveInner(start + 2, 1).name.includes("hmd-internal-link")) continue;
        const color = colorForLinktext(plugin, match[1], sourcePath);
        if (color) builder.add(start, start + match[0].length, decorationFor(color));
      }
    }
    return builder.finish();
  };

  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = build(view);
      }

      // Der Parser arbeitet den sichtbaren Bereich ggf. erst nach und nach ab -
      // ein neuer Syntaxbaum zählt daher ebenfalls als Anlass zum Neuaufbau.
      update(update) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state) ||
          update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refreshEffect)))
        ) {
          this.decorations = build(update.view);
        }
      }
    },
    { decorations: (value) => value.decorations }
  );
}

function refreshEditors(plugin) {
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    leaf.view?.editor?.cm?.dispatch({ effects: refreshEffect.of(null) });
  });
}

// ------------------------------------------------------------------------

function registerLinkColors(plugin) {
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    // Quelle immer vermerken, auch bei ausgeschalteter Einfärbung - so greift
    // ein späteres Einschalten auch für bereits gerenderte Links.
    for (const anchorEl of el.querySelectorAll("a.internal-link")) {
      anchorEl.setAttribute(SOURCE_ATTR, ctx.sourcePath);
      applyToAnchor(plugin, anchorEl);
    }
  });
  // Obsidians Syntax-Span ".cm-hmd-internal-link" liegt unabhängig von der
  // Priorität immer außen, die Markierung also darin - die Farbe setzt daher
  // eine eigene Regel in styles.css (.fred-typ-link). Niedrigste Priorität legt
  // sie immerhin um ".cm-underline" herum, damit der ganze Linktext erfasst ist.
  plugin.registerEditorExtension(Prec.lowest(buildLinkViewPlugin(plugin)));

  const refresh = () => {
    refreshRenderedLinks(plugin);
    refreshEditors(plugin);
  };
  plugin.registerEvent(plugin.typIndex.on("change", refresh));
  // Die Editor-Dekorationen verschwinden beim Entladen mit der Erweiterung von
  // selbst, die Inline-Variablen an gerenderten Links nicht.
  plugin.register(() => {
    plugin.app.workspace.iterateAllLeaves((leaf) => {
      for (const anchorEl of leaf.view.containerEl.querySelectorAll(`a.internal-link[${SOURCE_ATTR}]`)) {
        anchorEl.style.removeProperty(COLOR_VAR);
      }
    });
  });
  return refresh;
}

module.exports = { registerLinkColors };
