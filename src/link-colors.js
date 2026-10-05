const { editorInfoField, getLinkpath } = require("obsidian");
const { ViewPlugin, Decoration } = require("@codemirror/view");
const { Prec, RangeSetBuilder, StateEffect } = require("@codemirror/state");
const { syntaxTree } = require("@codemirror/language");
const { colorForFile, allDocuments } = require("./typ-colors");
const { coalesceFrame } = require("./typ-utils");
const { registerColorView } = require("./view-colors");

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
//    a ViewPlugin that looks at the visible range only. It finds wikilinks and
//    Markdown links ([text](Note.md)), each only where Obsidian's parser sees
//    a link.
//
// Recoloring otherwise only happens on a real TYP change (typIndex "change")
// or a settings change, not on every save. While the toggle is off, editors
// carry no extension and TYP changes recolor nothing (see registerLinkColors).

const COLOR_VAR = "--link-color";
const SOURCE_ATTR = "data-typ-src";

// [[target]], [[target|alias]], [[target#heading]]. Embeds (![[…]]) are not
// links. Inside tables the alias pipe is escaped ("\|").
const WIKILINK_PATTERN = /(?<!!)\[\[([^[\]]+?)\]\]/g;

// [text](target), [text](<target with spaces>), [text](target "title").
// Group 2 is the target; one level of parentheses inside it is allowed
// ("Note%20(draft).md"). Embeds (![…](…)) are not links.
const MD_LINK_PATTERN = /(?<!!)\[([^\]\n]*)\]\((<[^>\n]+>|[^()\s]+(?:\([^()\s]*\)[^()\s]*)*)(?:\s+"[^"\n]*")?\)/g;

// Resolves a link target ("Note", "Note#Heading", "folder/Note.md") the way
// Obsidian does and returns the TYP color of an existing note, else null.
function colorForTarget(plugin, target, sourcePath) {
  const linkpath = getLinkpath(target);
  if (!linkpath) return null;
  const file = plugin.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
  return colorForFile(plugin, file, "links");
}

function colorForLinktext(plugin, linktext, sourcePath) {
  return colorForTarget(plugin, linktext.split(/\\?\|/)[0].trim(), sourcePath);
}

// The target of a Markdown link, read with Obsidian's own rules: <…>
// unwrapped; internal only without a ":" (https:, obsidian:, mailto: … are
// external) or as an explicit relative path; then URL-decoded ("%20"). A
// target that can't be decoded is no link for Obsidian either.
function colorForMarkdownTarget(plugin, rawTarget, sourcePath) {
  const target = rawTarget.startsWith("<") ? rawTarget.slice(1, -1).trim() : rawTarget;
  const internal = target.startsWith("./") || target.startsWith("../") || !target.includes(":");
  if (!target || !internal) return null;
  let decoded;
  try {
    decoded = decodeURI(target);
  } catch {
    return null;
  }
  return colorForTarget(plugin, decoded.trim(), sourcePath);
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
// Covers all windows (pop-outs included).
//
// Links rendered while the plugin was off (before it was enabled, or before a
// reload) have no source yet; they get the note of the leaf they are shown in.
// Only rendered Markdown is meant - the same links the post-processor sees.
// Obsidian re-runs post-processors in reading view on its own, but not for
// blocks Live Preview has already rendered (tables, callouts), so without
// this they would stay uncolored until re-rendered.
function refreshRenderedLinks(plugin) {
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    const sourcePath = leaf.view.file?.path ?? "";
    for (const anchorEl of leaf.view.containerEl.querySelectorAll(`.markdown-rendered a.internal-link:not([${SOURCE_ATTR}])`)) {
      anchorEl.setAttribute(SOURCE_ATTR, sourcePath);
    }
  });
  for (const doc of allDocuments(plugin.app)) {
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
    const sourcePath = view.state.field(editorInfoField, false)?.file?.path ?? "";
    const tree = syntaxTree(view.state);
    const builder = new RangeSetBuilder();

    // RangeSetBuilder wants its ranges in order, and the two patterns are
    // searched one after the other: collect, sort, then add.
    const links = [];
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.sliceDoc(from, to);
      WIKILINK_PATTERN.lastIndex = 0;
      for (let match; (match = WIKILINK_PATTERN.exec(text)); ) {
        const start = from + match.index;
        // Only what Obsidian's parser treats as an internal link, which rules
        // out [[…]] in code blocks and inline code.
        if (!tree.resolveInner(start + 2, 1).name.includes("hmd-internal-link")) continue;
        const color = colorForLinktext(plugin, match[1], sourcePath);
        if (color) links.push({ from: start, to: start + match[0].length, color });
      }
      MD_LINK_PATTERN.lastIndex = 0;
      for (let match; (match = MD_LINK_PATTERN.exec(text)); ) {
        const start = from + match.index;
        // The same check on the target ("[" text "](" comes before it): the
        // parser marks it "string_url" only in a real link, never in code.
        const targetNode = tree.resolveInner(start + match[1].length + 3, 1).name;
        if (!targetNode.includes("string_url") || targetNode.includes("formatting")) continue;
        const color = colorForMarkdownTarget(plugin, match[2], sourcePath);
        if (color) links.push({ from: start, to: start + match[0].length, color });
      }
    }
    links.sort((a, b) => a.from - b.from);
    let end = -1;
    for (const link of links) {
      // Overlaps are hardly possible ([[…]] inside a Markdown link's text),
      // but the builder would throw on one.
      if (link.from < end) continue;
      builder.add(link.from, link.to, decorationFor(link.color));
      end = link.to;
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

// Returns schedule(): asks every editor to rebuild its link decorations, at
// most once per animation frame.
//
// Never dispatched synchronously: a refresh can arrive while an editor is in
// the middle of its own update (CodeMirror then throws "Calls to
// EditorView.update are not allowed while an update is in progress"), for
// instance when something an update sets off ends in refreshTypColors(). The
// frame also bundles bursts of refreshes - dragging a color slider sends one
// per input event. An editor still busy when the frame comes (updateState is
// CodeMirror's internal flag, 0 = idle; it is also non-zero while measuring)
// is retried a frame later. A pending run is cancelled with the component
// (switched off or unloaded).
function createEditorRefresher(plugin, component) {
  const run = () => {
    let busy = false;
    plugin.app.workspace.iterateAllLeaves((leaf) => {
      const cm = leaf.view?.editor?.cm;
      if (!cm) return;
      if (cm.updateState !== 0) {
        busy = true;
        return;
      }
      try {
        cm.dispatch({ effects: refreshEffect.of(null) });
      } catch (error) {
        // One editor failing must not keep the others from refreshing.
        console.error("[TYP link colors]", error);
      }
    });
    if (busy) schedule();
  };
  const schedule = coalesceFrame(run);
  component.register(schedule.cancel);
  return schedule;
}

// ------------------------------------------------------------------------

// Clears the inline variables on rendered links (all windows, hover previews
// included). The source attribute stays, so turning on again or the next load
// finds it.
function clearRenderedLinks(plugin) {
  for (const doc of allDocuments(plugin.app)) {
    for (const anchorEl of doc.querySelectorAll(`a.internal-link[${SOURCE_ATTR}]`)) {
      anchorEl.style.removeProperty(COLOR_VAR);
    }
  }
}

function registerLinkColors(plugin) {
  // Runs while coloring is off too, but only to store each link's source, so
  // turning it on later also covers links that are already rendered
  // (applyToAnchor then just checks the toggle).
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    for (const anchorEl of el.querySelectorAll("a.internal-link")) {
      anchorEl.setAttribute(SOURCE_ATTR, ctx.sourcePath);
      applyToAnchor(plugin, anchorEl);
    }
  });

  // The editor extension lives in an array Obsidian keeps a reference to:
  // filled while the toggle is on, empty while it is off, and
  // workspace.updateOptions() hands the change to every open editor. So an
  // editor of a note costs nothing per keystroke while links aren't colored.
  //
  // Obsidian's ".cm-hmd-internal-link" (wikilink) and ".cm-link" (Markdown
  // link text) spans always end up outside our mark, whatever the priority, so
  // rules in styles.css (.typ-link) set the color.
  // Lowest priority at least wraps ".cm-underline", covering the whole text.
  const editorExtensions = [];
  plugin.registerEditorExtension(editorExtensions);
  const linkViewPlugin = Prec.lowest(buildLinkViewPlugin(plugin));

  return registerColorView(plugin, {
    key: "links",
    start: (component) => {
      editorExtensions.push(linkViewPlugin);
      plugin.app.workspace.updateOptions();
      component.register(() => {
        editorExtensions.length = 0;
        plugin.app.workspace.updateOptions();
      });

      const refreshEditors = createEditorRefresher(plugin, component);
      const refresh = () => {
        refreshRenderedLinks(plugin);
        refreshEditors();
      };
      component.registerEvent(plugin.typIndex.on("change", refresh));
      // After enabling, turning on or a reload, links rendered earlier get
      // their colors right away instead of waiting for a re-render. The
      // callback can't be removed, hence the check that this component still
      // runs.
      let running = true;
      component.register(() => (running = false));
      plugin.app.workspace.onLayoutReady(() => {
        if (running) refreshRenderedLinks(plugin);
      });
      return refresh;
    },
    // Editor decorations go with the extension (see above), the inline
    // variables on rendered links don't.
    clear: () => clearRenderedLinks(plugin),
  });
}

module.exports = { registerLinkColors };
