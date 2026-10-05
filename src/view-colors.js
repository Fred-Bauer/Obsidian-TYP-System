const { Component } = require("obsidian");
const { clearInlineColors } = require("./typ-colors");
const { coalesceFrame } = require("./typ-utils");

// Shared frame of the coloring modules: each one runs only while its toggle is
// on. A view that is switched off costs nothing - no observer, no event
// handler - and loses its colors once; switched on, it is colored once in
// full.
//
// Modules learn about a toggle through their refresh(), which
// refreshTypColors() calls on every settings change (settings tab, Sync,
// Undo): refresh() compares the toggle with its own state, so no further
// wiring is needed.

// The on/off life cycle alone, for modules that don't color leaves of one view
// type (see registerLeafColors for those).
//   key      colorViews key of the toggle
//   enabled  () => boolean, defaults to colorViews[key]; for a row that depends
//            on another one (e.g. a sub-row under a main toggle)
//   start    (component) => refresh: registers everything the module needs
//            while on on the component (events, observers, frame cancel), colors
//            once and returns the refresh to use while on. Switching off
//            unloads the component, which undoes all of it.
//   clear    () => void: removes the module's colors after switching off
// Returns refresh(), for refreshTypColors().
function registerColorView(plugin, { key, enabled = () => !!plugin.settings.colorViews[key], start, clear }) {
  let component = null;
  let refreshOn = null;
  const refresh = () => {
    const on = enabled();
    if (on && !component) {
      component = plugin.addChild(new Component());
      refreshOn = start(component);
    } else if (!on && component) {
      plugin.removeChild(component);
      component = refreshOn = null;
      clear();
    } else if (on) {
      refreshOn();
    }
  };
  refresh();
  // Disabling the plugin unloads the component on its own; the colors go here.
  // Registered after main.js' clearInlineColors, so it runs before it (last in,
  // first out).
  plugin.register(() => {
    if (component) clear();
  });
  return refresh;
}

// Leaves of one or more view types, colored from outside through
// setInlineColor (explorer, search, Recent Files, backlinks, bookmarks):
//   viewTypes      observed with a MutationObserver (childList, subtree)
//   apply          (plugin) => void: a full round over the rendered rows
//   applyInserted  optional (plugin, nodes) => void: colors only the elements
//                  inserted since the last frame. Without it every DOM change
//                  asks for a full round
//   attributes     optional attribute names: an element whose attribute changes
//                  counts as inserted. For rows a view fills in after inserting
//                  them (the explorer sets data-path on first render)
//   events         optional (component, refresh) => void: further events, each
//                  registered on the component
//   clearKept      optional (plugin) => void: clears rows the view keeps out of
//                  the DOM (virtualized lists, collapsed folders). The default
//                  clear only reaches what is in the leaves' DOM, and such a row
//                  would show its old color once inserted again
//   clearRoots     optional (plugin) => elements: more places to clear, e.g.
//                  embedded backlinks inside markdown views
// key and enabled as in registerColorView.
function registerLeafColors(plugin, { key, enabled, viewTypes, apply, applyInserted = null, attributes = null, events = null, clearKept = null, clearRoots = null }) {
  const leaves = () => viewTypes.flatMap((viewType) => plugin.app.workspace.getLeavesOfType(viewType));

  const start = (component) => {
    // Two kinds of work, done at most once per frame:
    //  - a full round over every rendered row, for anything that can change
    //    existing rows (TYP change, layout change, refreshTypColors);
    //  - with applyInserted, only the elements the view inserted - all that
    //    scrolling a virtualized list or expanding a folder does.
    let fullRound = false;
    const insertedNodes = new Set();
    const flush = coalesceFrame(() => {
      if (fullRound) apply(plugin);
      else applyInserted(plugin, insertedNodes);
      fullRound = false;
      insertedNodes.clear();
    });
    component.register(flush.cancel);
    const refresh = () => {
      fullRound = true;
      flush();
    };

    // A pending full round makes the collected nodes unnecessary.
    const observer = new MutationObserver((records) => {
      if (fullRound) return;
      if (!applyInserted) {
        refresh();
        return;
      }
      for (const record of records) {
        if (record.type === "attributes") insertedNodes.add(record.target);
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) insertedNodes.add(node);
        }
      }
      if (insertedNodes.size) flush();
    });
    const options = attributes ? { childList: true, subtree: true, attributeFilter: attributes } : { childList: true, subtree: true };
    const observeLeaves = () => {
      for (const leaf of leaves()) observer.observe(leaf.view.containerEl, options);
    };
    component.register(() => observer.disconnect());

    component.registerEvent(plugin.typIndex.on("change", refresh));
    component.registerEvent(
      plugin.app.workspace.on("layout-change", () => {
        observeLeaves();
        refresh();
      })
    );
    events?.(component, refresh);

    // Before the layout is ready (plugin loading at startup) the leaves may not
    // exist yet. The callback can't be removed, hence the check that this
    // component is still the running one.
    let running = true;
    component.register(() => (running = false));
    plugin.app.workspace.onLayoutReady(() => {
      if (!running) return;
      observeLeaves();
      refresh();
    });
    return refresh;
  };

  const clear = () => {
    for (const leaf of leaves()) clearInlineColors(leaf.view.containerEl);
    for (const el of clearRoots?.(plugin) ?? []) clearInlineColors(el);
    clearKept?.(plugin);
  };

  return registerColorView(plugin, { key, enabled, start, clear });
}

module.exports = { registerColorView, registerLeafColors };
