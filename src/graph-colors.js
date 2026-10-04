const { colorForFile } = require("./typ-colors");

const GRAPH_VIEW_TYPES = ["graph", "localgraph"];

function hexToInt(hex) {
  return parseInt(hex.replace("#", ""), 16);
}

// engine.render() only consults its fileFilter once a color group exists;
// without one every file just gets color:true. So we patch renderer.setData,
// right before the node data reaches the WebGL renderer - the same spot the
// community plugin graph-nested-tags uses. Nodes already colored by a color
// group are left alone.
function patchRenderer(plugin, renderer) {
  if (renderer.__typSystemColorPatched) return;
  renderer.__typSystemColorPatched = true;

  const original = renderer.setData;
  renderer.setData = function (data) {
    for (const path in data.nodes) {
      const node = data.nodes[path];
      if (node.color) continue;

      if (node.type === "tag") {
        // Own tag color disabled (2026-09-30): the Minimal theme's Style
        // Settings already cover it (Graphs → Tag node color).
        // if (plugin.settings.graphTagColorEnabled && plugin.settings.graphTagColor) {
        //   node.color = { a: 1, rgb: hexToInt(plugin.settings.graphTagColor) };
        // }
        continue;
      }

      const file = plugin.app.vault.getAbstractFileByPath(path);
      let color = null;

      if (file && file.extension !== "md") {
        // Own attachment color disabled (2026-09-30), see tag color above
        // (Graphs → Attachment node color).
        // if (plugin.settings.graphAttachmentColorEnabled && plugin.settings.graphAttachmentColor) {
        //   color = plugin.settings.graphAttachmentColor;
        // }
      } else if (plugin.settings.colorViews.graph) {
        color = colorForFile(plugin, file, "graph");
      }

      if (color) node.color = { a: 1, rgb: hexToInt(color) };
    }
    return original.call(this, data);
  };

  plugin.register(() => {
    renderer.setData = original;
    delete renderer.__typSystemColorPatched;
  });
}

function getGraphLeaves(app) {
  const leaves = [];
  for (const viewType of GRAPH_VIEW_TYPES) leaves.push(...app.workspace.getLeavesOfType(viewType));
  return leaves;
}

function registerGraphColors(plugin) {
  const refresh = () => {
    for (const leaf of getGraphLeaves(plugin.app)) {
      if (leaf.view?.renderer) patchRenderer(plugin, leaf.view.renderer);
      // The global graph keeps its engine in view.dataEngine, the local one in
      // view.engine.
      (leaf.view?.dataEngine ?? leaf.view?.engine)?.render();
    }
  };

  // Registered before any patchRenderer() cleanup, so it runs after them on
  // unload (Obsidian runs these callbacks last-in, first-out): with setData
  // back to the original, one render() draws the graph without TYP colors at
  // once instead of on its next change.
  plugin.register(() => {
    for (const leaf of getGraphLeaves(plugin.app)) (leaf.view?.dataEngine ?? leaf.view?.engine)?.render();
  });

  plugin.registerEvent(plugin.app.workspace.on("layout-change", refresh));
  plugin.registerEvent(plugin.typIndex.on("change", refresh));
  plugin.app.workspace.onLayoutReady(refresh);

  return refresh;
}

module.exports = { registerGraphColors };
