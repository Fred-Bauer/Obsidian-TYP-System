const { editorInfoField, getLinkpath } = require("obsidian");
const { ViewPlugin, Decoration } = require("@codemirror/view");
const { Prec, RangeSetBuilder, StateEffect } = require("@codemirror/state");
const { syntaxTree } = require("@codemirror/language");
const { colorForFile } = require("./typ-colors");

// Colors links in note text by the TYP of their target. Obsidian colors
// internal links through var(--link-color), so only that variable is set per
// link. --link-color-hover stays untouched (hover shows the normal link color),
// and underline and theme tweaks keep working.
//
// Two separate paths, because the two renderings have nothing in common:
//  - Reading view, hover preview and rendered blocks in Live Preview (tables,
//    callouts): real <a class="internal-link" data-href> elements ->
//    markdown post-processor, once per link when rendered.
//  - Live Preview/source mode: only CodeMirror spans over the raw text ->
//    a ViewPlugin that looks at the visible range only.
//
// Recoloring otherwise only happens on a real TYP change (typIndex "change")
// or a settings change, not on every save.

const COLOR_VAR = "--link-color";
const SOURCE_ATTR = "data-typ-src";

// [[target]], [[target|alias]], [[target#heading]]. Embeds (![[…]]) are not
// links. Inside tables the alias pipe is escaped ("\|").
const WIKILINK_PATTERN = /(?<!!)\[\[([^[\]]+?)\]\]/g;

function colorForLinktext(plugin, linktext, sourcePath) {
  const target = linktext.split(/\\?\|/)[0].trim();
  const linkpath = getLinkpath(target);
  if (!linkpath) return null;
  const file = plugin.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
  return colorForFile(plugin, file, "links");
}

// --- Reading view -------------------------------------------------------

function applyToAnchor(plugin, anchorEl) {
  const href = anchorEl.getAttribute("data-href");
  const color =
    plugin.settings.colorViews.links && href && !anchorEl.classList.contains("is-unresolved")
      ? colorForLinktext(plugin, href, anchorEl.getAttribute(SOURCE_ATTR) ?? "")
      : null;
  if (color) anchorEl.style.setProperty(COLOR_VAR, color);
  else anchorEl.style.removeProperty(COLOR_VAR);
}

// Recolors links that are already rendered. The post-processor stores each
// link's source note on it, which ambiguous link text needs to resolve.
// Collects all windows (pop-outs included) through their leaves.
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
        class: "typ-link",
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
        // Only what Obsidian's parser treats as an internal link, which rules
        // out [[…]] in code blocks and inline code.
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

      // The parser may work through the visible range bit by bit, so a new
      // syntax tree also triggers a rebuild.
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
    // Store the source even while coloring is off, so turning it on later
    // also covers links that are already rendered.
    for (const anchorEl of el.querySelectorAll("a.internal-link")) {
      anchorEl.setAttribute(SOURCE_ATTR, ctx.sourcePath);
      applyToAnchor(plugin, anchorEl);
    }
  });
  // Obsidian's ".cm-hmd-internal-link" span always ends up outside our mark,
  // whatever the priority, so a rule in styles.css (.typ-link) sets the color.
  // Lowest priority at least wraps ".cm-underline", covering the whole text.
  plugin.registerEditorExtension(Prec.lowest(buildLinkViewPlugin(plugin)));

  const refresh = () => {
    refreshRenderedLinks(plugin);
    refreshEditors(plugin);
  };
  plugin.registerEvent(plugin.typIndex.on("change", refresh));
  // Editor decorations go away with the extension on unload, the inline
  // variables on rendered links don't.
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
