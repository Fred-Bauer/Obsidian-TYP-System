const { PluginSettingTab, Setting, ToggleComponent } = require("obsidian");
const { mountGlobalOrderEditor } = require("./frontmatter-order-editor");
const { DEFAULT_GLOBAL_ORDER } = require("./frontmatter-sort");

const DEFAULT_SETTINGS = {
  types: [],
  typeColors: {},
  typeDescriptions: {},
  typeDefaultFrontmatter: {},
  // Keys aus typeDefaultFrontmatter[type], die als "Floating Property" markiert
  // sind (siehe type-frontmatter-editor.js/typ-view.js) - Teil derselben Liste
  // und Reihenfolge wie die übrigen Standard-Properties des Typs (wichtig für
  // die Frontmatter-Sortierung, siehe orderedDefaultKeys in frontmatter-sort.js),
  // aber NICHT Teil des von getTypeDefaults() (main.js) standardmäßig
  // gelieferten Frontmatters - Templater legt sie beim Anlegen einer Notiz also
  // nicht automatisch an (nur über den expliziten includeFloating-Parameter).
  typeFloatingKeys: {},
  typeManual: {},
  // SUBTYP (siehe subtyp-view.js): je TYP eine eigene Liste registrierter
  // Subtypen samt Beschreibung - anders als TYP ohne eigene Farbe, ohne
  // "Manueller TYP"-Schalter und (bisher) ohne Standard-Frontmatter/
  // Detailansicht, siehe Kommentar an SubtypPane.
  subtypesByType: {},
  subtypeDescriptions: {},
  // Siehe frontmatter-order-editor.js / frontmatter-sort.js: Reihenfolge aus
  // fest positionierten Einzel-Properties (kind: "property") sowie den vier
  // nicht entfernbaren Platzhaltern "typValue" (TYP-Property selbst),
  // "subtypValue" (SUBTYP-Property selbst), "typ" (Standardliste des Typs)
  // und "other" (alles Übrige).
  globalPropertyOrder: DEFAULT_GLOBAL_ORDER,
  // Siehe active-title-colors.js: wie der TYP in der geöffneten Notiz markiert
  // wird - "none" (nichts), "dot" (Farbpunkt am Titel) oder "badge" (Box mit
  // TYP-Namen, weiter konfiguriert über die drei folgenden Einstellungen, die
  // nur bei "badge" überhaupt eine Rolle spielen bzw. in den Einstellungen
  // angezeigt werden). Unabhängig davon und beliebig kombinierbar:
  // colorViews.noteTitleColor färbt den Titeltext selbst ein.
  noteTitleStyle: "dot",
  // Nur relevant bei noteTitleStyle: "badge" - ob die Box farbig (TYP-Farbe)
  // oder neutral (text-muted) dargestellt wird.
  noteTitleBadgeColored: true,
  // Nur relevant bei noteTitleStyle: "badge" - "title" (neben dem Inline-Titel,
  // normale Ausrichtung) oder "block" (links am Property-Block, um 90° gedreht).
  noteTitleBadgePosition: "title",
  // Nur relevant bei noteTitleBadgePosition: "block" - ob die gedrehte Box am
  // oberen oder unteren Rand des Property-Blocks sitzt.
  noteTitleVerticalAlign: "top",
  typSortOrder: "count-desc",
  typListDescriptionEnabled: true,
  // Höhenverhältnis der unteren SUBTYP-Hälfte im geteilten TYP-View (siehe
  // buildSplitPanes in typ-view.js), per Splitter-Drag verstellbar.
  typSubtypPaneRatio: 0.5,
  includeIgnoredFiles: false,
  graphTagColorEnabled: false,
  graphTagColor: "",
  graphAttachmentColorEnabled: false,
  graphAttachmentColor: "",
  colorViews: {
    fileExplorer: true,
    graph: true,
    search: true,
    recentFiles: true,
    backlinks: true,
    bookmarks: true,
    frontmatterDefaults: true,
    typList: true,
    allProperties: true,
    noteTitleColor: true,
    links: true,
  },
};

class TypSystemSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h4", { text: "TYP-Liste" });

    new Setting(containerEl)
      .setName("Beschreibungs-Textfeld anzeigen")
      .setDesc("Zeigt in der TYP-Liste neben jedem registrierten TYP ein Textfeld zur Bearbeitung seiner Beschreibung.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.typListDescriptionEnabled).onChange(async (value) => {
          this.plugin.settings.typListDescriptionEnabled = value;
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
        })
      );

    new Setting(containerEl)
      .setName("Ignorierte Notizen IMMER berücksichtigen")
      .setDesc(
        "Bezieht Notizen aus Obsidians \"Excluded files\"-Liste (dort tragen auch Plugins wie Hide Folders ausgeblendete Ordner ein) wieder in TYP-Zähler, TYP-Picker und die Frontmatter-Sortierung mit ein, statt sie zu überspringen."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.includeIgnoredFiles).onChange(async (value) => {
          this.plugin.settings.includeIgnoredFiles = value;
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
        })
      );

    containerEl.createEl("h4", { text: "Einfärbung" });

    const colorViewToggle = (key, name, desc) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.colorViews[key]).onChange(async (value) => {
            this.plugin.settings.colorViews[key] = value;
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
          })
        );
    };

    colorViewToggle("fileExplorer", "Datei-Explorer", "Notiznamen im Datei-Explorer nach TYP einfärben.");
    colorViewToggle("graph", "Graph", "Knoten im Graph (global und lokal) nach TYP einfärben.");
    colorViewToggle("search", "Suche", "Treffer-Titel in der Suche nach TYP einfärben.");
    colorViewToggle("recentFiles", "Recent Files", "Einträge im Recent-Files-Plugin nach TYP einfärben.");
    colorViewToggle(
      "links",
      "Links in Notizen",
      "Interne Links im Notiztext (Lese-Modus, Live Preview, Hover-Vorschau) in der Farbe des TYPs ihres Ziels darstellen. Nicht aufgelöste Links bleiben unverändert."
    );
    colorViewToggle("typList", "TYP View", "Typ-Namen in der TYP-View selbst (Liste und Detailansicht) in ihrer jeweiligen Farbe darstellen.");
    colorViewToggle(
      "noteTitleColor",
      "Titel-Text einfärben",
      "Färbt den Inline-Titel der geöffneten Notiz selbst in der Farbe ihres TYPs ein - unabhängig von der TYP-Markierung daneben (s. u.), beides lässt sich kombinieren."
    );

    // Progressive Offenlegung: bei noteTitleStyle "badge" kommen weitere
    // Schalter direkt in dieser einen Setting-Zeile dazu (Farbe, Position),
    // bei Position "block" noch ein dritter (Ausrichtung) - jeweils per
    // this.display() neu gerendert, damit nur die gerade relevanten Schalter
    // erscheinen, statt permanent alle anzuzeigen bzw. eigene Zeilen zu belegen.
    const isBadge = this.plugin.settings.noteTitleStyle === "badge";
    const isBlockPosition = this.plugin.settings.noteTitleBadgePosition === "block";

    // Eigene Klasse, damit die bei "badge" zusätzlich angehängten Schalter
    // (siehe unten) statt nebeneinander (Obsidians Standard-Layout für
    // mehrere Controls in einer Setting-Zeile) untereinander stehen - siehe
    // .fred-note-title-setting in styles.css.
    const noteTitleSetting = new Setting(containerEl)
      .setName("TYP-Markierung in der Notiz")
      .setDesc(
        isBadge
          ? '"Box mit TYP-Namen" - Schalter: farbig/neutral, am Titel/am Property-Block (gedreht)' +
              (isBlockPosition ? ", oben/unten am Property-Block" : "") +
              "."
          : "Wie der TYP in der geöffneten Notiz markiert wird."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("none", "Nichts")
          .addOption("dot", "Farbpunkt am Titel")
          .addOption("badge", "Box mit TYP-Namen")
          .setValue(this.plugin.settings.noteTitleStyle)
          .onChange(async (value) => {
            this.plugin.settings.noteTitleStyle = value;
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
            this.display();
          })
      );

    if (isBadge) noteTitleSetting.settingEl.addClass("fred-note-title-setting");

    // Eigenes kleines Label je Schalter statt nur Tooltip - addToggle() allein
    // hängt nur den nackten Schalter ohne Beschriftung an, daher hier eine
    // eigene Zeile (Label + ToggleComponent) direkt in controlEl gebaut.
    const addLabeledToggle = (label, tooltip, value, onChange) => {
      const row = noteTitleSetting.controlEl.createDiv({ cls: "fred-note-title-toggle-row" });
      row.createSpan({ cls: "fred-note-title-toggle-label", text: label });
      new ToggleComponent(row).setTooltip(tooltip).setValue(value).onChange(onChange);
    };

    if (isBadge) {
      addLabeledToggle("Farbig", "Farbig (TYP-Farbe) statt neutral", this.plugin.settings.noteTitleBadgeColored, async (value) => {
        this.plugin.settings.noteTitleBadgeColored = value;
        await this.plugin.saveSettings();
        this.plugin.refreshTypColors?.();
      });

      addLabeledToggle("Am Property-Block", "Am Property-Block (gedreht) statt am Titel", isBlockPosition, async (value) => {
        this.plugin.settings.noteTitleBadgePosition = value ? "block" : "title";
        await this.plugin.saveSettings();
        this.plugin.refreshTypColors?.();
        this.display();
      });

      if (isBlockPosition) {
        addLabeledToggle(
          "Oben statt unten",
          "Oben statt unten am Property-Block",
          this.plugin.settings.noteTitleVerticalAlign === "top",
          async (value) => {
            this.plugin.settings.noteTitleVerticalAlign = value ? "top" : "bottom";
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
          }
        );
      }
    }

    colorViewToggle(
      "backlinks",
      "Backlinks",
      "Trefferzeilen im Backlinks-Pane sowie in den im Dokument eingebetteten Backlinks (inkl. nicht verlinkter Erwähnungen) nach TYP einfärben."
    );
    colorViewToggle(
      "bookmarks",
      "Bookmarks",
      "Einträge im Bookmarks-Pane, die direkt auf eine Notiz zeigen, nach TYP einfärben."
    );
    colorViewToggle(
      "allProperties",
      "All Properties",
      "In Obsidians vault-weiter \"All Properties\"-Ansicht Property-Namen einfärben, die im Standard-Frontmatter genau eines TYPs vorkommen (in dessen Farbe) - kommen sie bei mehreren TYPs vor, stattdessen fett statt eingefärbt."
    );

    containerEl.createEl("h4", { text: "Graph" });

    // Ein Setting pro Node-Typ, den Obsidians Graph-Engine kennt - gleicher
    // Aufbau (Toggle + Farbwahl + Zurücksetzen) für jeden, daher als Helper
    // statt dupliziert.
    const graphColorSetting = (enabledKey, colorKey, defaultColor, name, desc) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings[enabledKey]).onChange(async (value) => {
            this.plugin.settings[enabledKey] = value;
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
          })
        )
        .addColorPicker((picker) =>
          picker.setValue(this.plugin.settings[colorKey] || defaultColor).onChange(async (value) => {
            this.plugin.settings[colorKey] = value;
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
          })
        )
        .addExtraButton((button) =>
          button
            .setIcon("rotate-ccw")
            .setTooltip("Zurücksetzen auf Standardfarbe")
            .onClick(async () => {
              this.plugin.settings[colorKey] = "";
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
              this.display();
            })
        );
    };

    graphColorSetting(
      "graphTagColorEnabled",
      "graphTagColor",
      "#888888",
      "Tag-Farbe",
      "Eigene Farbe für Tag-Knoten im Graph (global und lokal) verwenden statt der Standardfarbe. Eigene Farbgruppen im Graph haben weiterhin Vorrang."
    );
    graphColorSetting(
      "graphAttachmentColorEnabled",
      "graphAttachmentColor",
      "#e0ac00",
      "Anhänge-Farbe",
      "Eigene Farbe für Anhang-Knoten (Nicht-Markdown-Dateien wie Bilder oder PDFs) im Graph verwenden statt der Standardfarbe."
    );

    containerEl.createEl("h4", { text: "Standard-Frontmatter" });

    colorViewToggle(
      "frontmatterDefaults",
      "Property-Namen fett markieren",
      "In Notizen (Frontmatter im Dokument sowie Properties-Seitenleiste) die Namen der Properties fett darstellen, die im Standard-Frontmatter des jeweiligen TYPs hinterlegt sind."
    );

    mountGlobalOrderEditor(containerEl, this.plugin);
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        'Bestimmt die Reihenfolge, in der die Befehle "Frontmatter Sortierung aktualisieren" die in einer Notiz vorhandenen Properties anordnen (ergänzt oder ändert keine Werte). Einzelne Properties (z. B. cssclasses, aliases) lassen sich fest platzieren - "TYP" ist die TYP-Property selbst, "SUBTYP" analog die SUBTYP-Property, "TYP Properties" steht für die Standard-Frontmatter-Liste des jeweiligen Typs, "Sonstige Properties" für alles Übrige. Reihenfolge per Drag & Drop änderbar, die vier Platzhalter-Zeilen lassen sich nicht entfernen.',
    });
  }
}

module.exports = { DEFAULT_SETTINGS, TypSystemSettingTab };
