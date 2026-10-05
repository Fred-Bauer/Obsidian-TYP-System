const { allDocuments } = require("./typ-colors");

// Finds blocks Obsidian renders into notes (query blocks, bases) wherever they
// show up: reading view, Live Preview, embedded notes, hover previews, canvas
// cards, pop-out windows. Nothing watches the notes themselves - a subtree
// observer near the editor once froze this vault - so a note without such a
// block costs nothing, typing included.
//
// The blocks announce themselves instead. While a watcher runs, its class sits
// on the body of every window, and styles.css gives the watched blocks an empty
// CSS animation under that class. A block starts it whenever it is inserted or
// shown, which fires "animationstart": the trick behind Obsidian's own
// onNodeInserted(), which only works on elements one already has. Setting the
// class makes the blocks already on screen announce themselves too; a block in
// a hidden tab does so once the tab is shown.
//
// The event comes in the rendering step before the frame is painted, so what
// onInserted changes is already in that frame.

const INSERTED_ANIMATION = "typ-embed-inserted";

// Runs while component lives.
//   bodyClass   the class styles.css animates the blocks under
//   selector    the animated blocks
//   onInserted  (el) => void, for every block inserted or shown - possibly
//               several times for the same block
function watchEmbeds(plugin, component, { bodyClass, selector, onInserted }) {
  const onAnimationStart = (evt) => {
    if (evt.animationName === INSERTED_ANIMATION && evt.target.matches(selector)) onInserted(evt.target);
  };
  const watchDocument = (doc) => {
    component.registerDomEvent(doc, "animationstart", onAnimationStart);
    doc.body.addClass(bodyClass);
  };
  for (const doc of allDocuments(plugin.app)) watchDocument(doc);
  component.registerEvent(plugin.app.workspace.on("window-open", (workspaceWindow, win) => watchDocument(win.document)));
  component.register(() => {
    for (const doc of allDocuments(plugin.app)) doc.body.removeClass(bodyClass);
  });
}

// The component Obsidian rendered a block with (a MarkdownRenderChild), since
// the DOM has no way back to it: a walk through Obsidian's component tree,
// starting at every leaf's view (about 60 components in this vault, 0.01 ms).
// Two kinds of children hang outside _children: a hover preview on its parent
// (hoverPopover) and a canvas card on its node (canvas.nodes, node.child). A
// hover preview opened from an embedded note hangs on a helper object outside
// the tree and isn't found.
//   predicate  (component) => boolean
function findRenderChild(app, predicate) {
  const seen = new Set();
  const visit = (component) => {
    if (!component || seen.has(component)) return null;
    seen.add(component);
    if (predicate(component)) return component;
    for (const child of [component.hoverPopover, ...(component._children ?? [])]) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };

  const roots = [];
  app.workspace.iterateAllLeaves((leaf) => {
    roots.push(leaf.view);
    for (const node of leaf.view.canvas?.nodes?.values() ?? []) roots.push(node.child);
  });
  for (const root of roots) {
    const found = visit(root);
    if (found) return found;
  }
  return null;
}

module.exports = { watchEmbeds, findRenderChild };
