const { Notice } = require("obsidian");
const { sortAllFrontmatter, sortSingleFileFrontmatter } = require("./frontmatter-sort");

function registerCommands(plugin) {

  // Obsidian awaited den callback einer Befehlsdefinition nicht und fängt auch
  // keine Fehler ab - eine Exception darin würde sonst lautlos verschwinden
  // (nur ein Eintrag in der Entwicklerkonsole, keine sichtbare Rückmeldung).
  // Diese drei Sortierbefehle laufen deshalb über runOrReportError(), damit
  // im Fehlerfall trotzdem immer eine Notice erscheint statt gar keine.
  const runOrReportError = (label, fn) => async () => {
    try {
      await fn();
    } catch (error) {
      console.error(`[${label}]`, error);
      new Notice(`${label} fehlgeschlagen: ${error.message}`);
    }
  };

  plugin.addCommand({
    id: "frontmatter-sortierung-alle",
    name: "Frontmatter Sortierung GLOBAL aktualisieren",
    callback: runOrReportError("Frontmatter Sortierung", async () => {
      const { checked, changed } = await sortAllFrontmatter(plugin.app, plugin, null);
      new Notice(
        changed > 0
          ? `Frontmatter Sortierung: ${checked} Notizen geprüft, ${changed} sortiert.`
          : `Frontmatter Sortierung: ${checked} Notizen geprüft, bereits alle sortiert.`
      );
    }),
  });

  plugin.addCommand({
    id: "frontmatter-sortierung-typ",
    name: "Frontmatter Sortierung für TYP aktualisieren",
    callback: runOrReportError("Frontmatter Sortierung", async () => {
      // Derselbe TYP-Picker wie überall sonst im Plugin (siehe type-picker.js) -
      // zeigt Farbe, Beschreibung und Notiz-Anzahl statt einer reinen Namensliste
      // (und meldet selbst, falls es gar keine TYPen gibt). includeManualOff und
      // includeUnregistered: true, da die Sortierung unabhängig davon sinnvoll
      // ist, ob ein TYP manuell vergeben werden darf (z. B. KONTAKT, EXTERN)
      // oder überhaupt in der TYP-Liste registriert ist.
      const type = await plugin.pickType({ includeManualOff: true, includeUnregistered: true });
      if (!type) return;
      const { checked, changed, hasTypeDefaults } = await sortAllFrontmatter(plugin.app, plugin, type);
      let message =
        changed > 0
          ? `Frontmatter Sortierung ${type}: ${checked} Notizen geprüft, ${changed} sortiert.`
          : `Frontmatter Sortierung ${type}: ${checked} Notizen geprüft, bereits alle sortiert.`;
      // Kein Fehler, aber ohne TYP-Frontmatter greift für diesen Typ nur
      // die globale Reihenfolge (TYP selbst, fest positionierte Properties) -
      // ohne diesen Hinweis wäre unklar, warum sich ggf. nichts geändert hat.
      if (hasTypeDefaults === false) {
        message += ` Hinweis: Für ${type} ist kein TYP-Frontmatter hinterlegt - nur die globale Reihenfolge wurde angewendet.`;
      }
      new Notice(message);
    }),
  });

  plugin.addCommand({
    id: "frontmatter-sortierung-aktive-notiz",
    name: "Frontmatter Sortierung der aktiven Notiz aktualisieren",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file || file.extension !== "md") return false;
      if (checking) return true;

      runOrReportError("Frontmatter Sortierung", async () => {
        const changed = await sortSingleFileFrontmatter(plugin.app, plugin, file);
        new Notice(changed ? `Frontmatter von "${file.basename}" sortiert.` : `Frontmatter von "${file.basename}" war bereits sortiert.`);
      })();
      return true;
    },
  });

}

module.exports = { registerCommands };
