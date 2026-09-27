const { colorForFile } = require("./type-colors");

const GRAPH_VIEW_TYPES = ["graph", "localgraph"];

function hexToInt(hex) {
  return parseInt(hex.replace("#", ""), 16);
}

// engine.render() liest sein internes fileFilter-Objekt nur aus, wenn bereits
// mindestens eine eigene Farbgruppe/Filter-Query aktiv ist - ohne eigene Gruppen
// bekommt jede Datei pauschal color:true (kein Farbwert), fileFilter wird gar
// nicht erst konsultiert. Robuster ist der Eingriff direkt an renderer.setData,
// unmittelbar bevor die fertigen Node-Daten an den WebGL-Renderer gehen - an
// exakt dieser Stelle patcht auch das Community-Plugin "graph-nested-tags".
// Eigene Farbgruppen haben dort node.color bereits gesetzt und bleiben unangetastet.
function patchRenderer(plugin, renderer) {
  if (renderer.__fredTypColorPatched) return;
  renderer.__fredTypColorPatched = true;

  const original = renderer.setData;
  renderer.setData = function (data) {
    for (const path in data.nodes) {
      const node = data.nodes[path];
      if (node.color) continue;

      if (node.type === "tag") {
        if (plugin.settings.graphTagColorEnabled && plugin.settings.graphTagColor) {
          node.color = { a: 1, rgb: hexToInt(plugin.settings.graphTagColor) };
        }
        continue;
      }

      const file = plugin.app.vault.getAbstractFileByPath(path);
      let color = null;

      if (file && file.extension !== "md") {
        if (plugin.settings.graphAttachmentColorEnabled && plugin.settings.graphAttachmentColor) {
          color = plugin.settings.graphAttachmentColor;
        }
      } else if (plugin.settings.colorViews.graph) {
        color = colorForFile(plugin, file, "graph");
      }

      if (color) node.color = { a: 1, rgb: hexToInt(color) };
    }
    return original.call(this, data);
  };

  plugin.register(() => {
    renderer.setData = original;
    delete renderer.__fredTypColorPatched;
  });
}

function getGraphLeaves(app) {
  const leaves = [];
  for (const type of GRAPH_VIEW_TYPES) leaves.push(...app.workspace.getLeavesOfType(type));
  return leaves;
}

function registerGraphColors(plugin) {
  const refresh = () => {
    for (const leaf of getGraphLeaves(plugin.app)) {
      if (leaf.view?.renderer) patchRenderer(plugin, leaf.view.renderer);
      leaf.view?.dataEngine?.render();
    }
  };

  plugin.registerEvent(plugin.app.workspace.on("layout-change", refresh));
  // Nur bei tatsächlich geändertem TYP (siehe typ-index.js) - sonst zeigte der
  // Graph eine umgetragene Farbe erst nach dem nächsten eigenen Neuaufbau.
  plugin.registerEvent(plugin.typIndex.on("change", refresh));
  plugin.app.workspace.onLayoutReady(refresh);

  return refresh;
}

module.exports = { registerGraphColors };
