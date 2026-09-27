const { PluginSettingTab, SettingGroup, ToggleComponent, DropdownComponent, debounce } = require("obsidian");
const { mountGlobalOrderEditor } = require("./frontmatter-order-editor");
const { DEFAULT_GLOBAL_ORDER } = require("./frontmatter-sort");
const { SUBTYPE_COLOR_CHANNELS, DEFAULT_SUBTYPE_COLOR_RANGES, colorRange } = require("./type-colors");

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
  // Registrierte Subtypen je TYP samt eigenem Frontmatter-Block, siehe subtypes.js.
  typeSubtypes: {},
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
  // Nur relevant bei noteTitleStyle: "badge" - Beschriftung der Box: "type"
  // ([TYP]), "type-subtype" ([TYP/Subtyp]) oder "subtype" ([Subtyp], bei
  // Notizen ohne Subtyp keine Box). Farbe (mit noteTitleBadgeColored)
  // entsprechend die des TYPs bzw. des Subtyps - bei "type-subtype" wählbar
  // über colorViews.noteTitleMarkerSubtyp ("Subtyp-Farbe").
  noteTitleBadgeLabel: "type",
  // Nur relevant bei noteTitleStyle: "badge" - "title" (neben dem Inline-Titel,
  // normale Ausrichtung) oder "block" (links am Property-Block, um 90° gedreht).
  noteTitleBadgePosition: "title",
  // Nur relevant bei noteTitleBadgePosition: "block" - ob die gedrehte Box am
  // oberen oder unteren Rand des Property-Blocks sitzt.
  noteTitleVerticalAlign: "top",
  typSortOrder: "count-desc",
  typListDescriptionEnabled: true,
  // Siehe pickTypeAndSubtype in type-picker.js: false = Subtypen eingerückt
  // direkt im TYP-Picker, true = eigener Subtyp-Picker nach der TYP-Auswahl.
  separateSubtypePicker: false,
  includeIgnoredFiles: false,
  graphTagColorEnabled: false,
  graphTagColor: "",
  graphAttachmentColorEnabled: false,
  graphAttachmentColor: "",
  // Wie weit die Farbe eines Subtyps höchstens von der seines TYPs abweichen
  // darf (±), siehe type-colors.js: Farbton in Grad, Sättigung in % relativ,
  // Helligkeit in Prozentpunkten.
  subtypeColorRanges: { h: 25, s: 30, l: 20 },
  colorViews: {
    fileExplorer: true,
    graph: true,
    search: true,
    recentFiles: true,
    backlinks: true,
    bookmarks: true,
    // Unter-Schalter "<Ansicht>Subtyp" der Einfärbungen: Farbe des Subtyps
    // einer Notiz statt der ihres TYPs (siehe colorForFile in type-colors.js).
    fileExplorerSubtyp: true,
    graphSubtyp: true,
    searchSubtyp: true,
    recentFilesSubtyp: true,
    backlinksSubtyp: true,
    bookmarksSubtyp: true,
    linksSubtyp: true,
    typListSubtyp: true,
    noteTitleColorSubtyp: true,
    noteTitleMarkerSubtyp: true,
    frontmatterDefaults: true,
    // Unter-Schalter zu frontmatterDefaults bzw. allProperties: bezieht die
    // Frontmatter-Blöcke der Subtypen mit ein (siehe
    // frontmatter-default-highlight.js) - bei allProperties zugleich in der
    // Farbe des jeweiligen Subtyps.
    frontmatterDefaultsSubtyp: true,
    typList: true,
    allProperties: true,
    allPropertiesSubtyp: true,
    noteTitleColor: true,
    links: true,
  },
};

class TypSystemSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Jeder Abschnitt ist eine SettingGroup - Obsidians eigene Gruppierung
  // (Überschrift + eine Box, Einträge darin durch Trennlinien getrennt), wie
  // in den Core-Einstellungen. Einzeln per new Setting(containerEl) angelegte
  // Einträge würden stattdessen je als eigene kleine Box gerendert.
  display() {
    const { containerEl } = this;
    // Scroll-Position über den Neuaufbau retten (display() wird auch von
    // Schaltern mit Unter-Optionen aufgerufen): das Dropdown der
    // TYP-Markierung misst sich beim setValue() (resizeToFit liest
    // offsetWidth) und erzwingt so ein Layout, solange die Seite erst bis
    // dorthin aufgebaut ist - der Browser kappt scrollTop dann auf diese
    // Teilhöhe, die Ansicht spränge nach oben.
    const { scrollTop } = containerEl;
    containerEl.empty();

    new SettingGroup(containerEl)
      .setHeading("TYP-Liste")
      .addSetting((setting) =>
        setting
          .setName("Beschreibungs-Textfeld anzeigen")
          .setDesc("Zeigt in der TYP-Liste neben jedem registrierten TYP ein Textfeld zur Bearbeitung seiner Beschreibung.")
          .addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.typListDescriptionEnabled).onChange(async (value) => {
              this.plugin.settings.typListDescriptionEnabled = value;
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
            })
          )
      )
      .addSetting((setting) =>
        setting
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
          )
      );

    new SettingGroup(containerEl).setHeading("TYP-Picker").addSetting((setting) =>
      setting
        .setName("Subtyp-Picker separat")
        .setDesc(
          "Beim Anlegen einer Notiz folgt auf den TYP-Picker ein eigener Subtyp-Picker (ESC dort führt zurück zur TYP-Auswahl), statt die Subtypen direkt eingerückt unter ihrem TYP im TYP-Picker anzuzeigen."
        )
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.separateSubtypePicker).onChange(async (value) => {
            this.plugin.settings.separateSubtypePicker = value;
            await this.plugin.saveSettings();
          })
        )
    );

    // subtypKey (optional): statt eines einzelnen Schalters zwei beschriftete
    // untereinander (wie die Unter-Schalter bei "Box mit TYP-Namen", siehe
    // unten) - "TYP" für den eigentlichen Schalter, darunter "Subtyp", nur
    // sichtbar, solange "TYP" an ist. Die Tooltips passen standardmäßig zu den
    // Einfärbungen (Subtyp = Farbe des Subtyps statt der des TYPs).
    const colorViewToggle = (
      group,
      key,
      name,
      desc,
      subtypKey = null,
      { typTooltip = "Nach TYP-Farbe einfärben", subtypTooltip = "Farbe des Subtyps statt der des TYPs verwenden" } = {}
    ) =>
      group.addSetting((setting) => {
        setting.setName(name).setDesc(desc);
        const save = async (settingKey, value) => {
          this.plugin.settings.colorViews[settingKey] = value;
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
        };

        if (!subtypKey) {
          setting.addToggle((toggle) => toggle.setValue(this.plugin.settings.colorViews[key]).onChange((value) => save(key, value)));
          return;
        }

        setting.settingEl.addClass("fred-note-title-setting");
        const addRow = (label, tooltip, settingKey, onChanged) => {
          const row = setting.controlEl.createDiv({ cls: "fred-note-title-toggle-row" });
          row.createSpan({ cls: "fred-note-title-toggle-label", text: label });
          new ToggleComponent(row)
            .setTooltip(tooltip)
            .setValue(this.plugin.settings.colorViews[settingKey])
            .onChange(async (value) => {
              await save(settingKey, value);
              onChanged?.();
            });
        };
        addRow("TYP", typTooltip, key, () => this.display());
        if (this.plugin.settings.colorViews[key]) addRow("Subtyp", subtypTooltip, subtypKey);
      });

    const coloringGroup = new SettingGroup(containerEl).setHeading("Einfärbung");

    colorViewToggle(coloringGroup, "fileExplorer", "Datei-Explorer", "Notiznamen im Datei-Explorer nach TYP einfärben.", "fileExplorerSubtyp");
    colorViewToggle(coloringGroup, "graph", "Graph", "Knoten im Graph (global und lokal) nach TYP einfärben.", "graphSubtyp");
    colorViewToggle(coloringGroup, "search", "Suche", "Treffer-Titel in der Suche nach TYP einfärben.", "searchSubtyp");
    colorViewToggle(coloringGroup, "recentFiles", "Recent Files", "Einträge im Recent-Files-Plugin nach TYP einfärben.", "recentFilesSubtyp");
    colorViewToggle(
      coloringGroup,
      "links",
      "Links in Notizen",
      "Interne Links im Notiztext (Lese-Modus, Live Preview, Hover-Vorschau) in der Farbe des TYPs ihres Ziels darstellen. Nicht aufgelöste Links bleiben unverändert.",
      "linksSubtyp"
    );
    colorViewToggle(
      coloringGroup,
      "typList",
      "TYP View",
      "Typ-Namen in der TYP-View selbst (Liste und Detailansicht) und im TYP-Picker in ihrer jeweiligen Farbe darstellen. Mit \"Subtyp\" auch die Subtypen in ihrer eigenen Farbe.",
      "typListSubtyp"
    );
    colorViewToggle(
      coloringGroup,
      "noteTitleColor",
      "Titel-Text einfärben",
      "Färbt den Inline-Titel der geöffneten Notiz selbst in der Farbe ihres TYPs ein - unabhängig von der TYP-Markierung daneben (s. u.), beides lässt sich kombinieren.",
      "noteTitleColorSubtyp"
    );

    // Progressive Offenlegung: bei noteTitleStyle "badge" kommen weitere
    // Schalter direkt in dieser einen Setting-Zeile dazu (Farbe, Position),
    // bei Position "block" noch ein dritter (Ausrichtung) - jeweils per
    // this.display() neu gerendert, damit nur die gerade relevanten Schalter
    // erscheinen, statt permanent alle anzuzeigen bzw. eigene Zeilen zu belegen.
    const isBadge = this.plugin.settings.noteTitleStyle === "badge";
    const isBlockPosition = this.plugin.settings.noteTitleBadgePosition === "block";

    coloringGroup.addSetting((noteTitleSetting) => {
      noteTitleSetting
        .setName("TYP-Markierung in der Notiz")
        .setDesc(
          isBadge
            ? '"Box mit TYP-Namen" - Beschriftung, Schalter: farbig/neutral, am Titel/am Property-Block (gedreht)' +
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

      // "Subtyp" (Farbe des Subtyps statt der des TYPs) nur, solange die
      // Markierung überhaupt farbig ist: beim Punkt immer, bei der Box nur
      // mit "Farbig" und Beschriftung [TYP/Subtyp] - bei [TYP] bzw. [Subtyp]
      // folgt die Farbe der Beschriftung.
      const badgeLabel = this.plugin.settings.noteTitleBadgeLabel ?? "type";
      const showSubtyp =
        this.plugin.settings.noteTitleStyle === "dot" ||
        (isBadge && this.plugin.settings.noteTitleBadgeColored && badgeLabel === "type-subtype");
      if (!isBadge && !showSubtyp) return;

      // Eigene Klasse, damit die bei "badge" zusätzlich angehängten Schalter
      // statt nebeneinander (Obsidians Standard-Layout für mehrere Controls in
      // einer Setting-Zeile) untereinander stehen - siehe
      // .fred-note-title-setting in styles.css.
      noteTitleSetting.settingEl.addClass("fred-note-title-setting");

      // Eigenes kleines Label je Schalter statt nur Tooltip - addToggle() allein
      // hängt nur den nackten Schalter ohne Beschriftung an, daher hier eine
      // eigene Zeile (Label + ToggleComponent) direkt in controlEl gebaut.
      const addLabeledToggle = (label, tooltip, value, onChange) => {
        const row = noteTitleSetting.controlEl.createDiv({ cls: "fred-note-title-toggle-row" });
        row.createSpan({ cls: "fred-note-title-toggle-label", text: label });
        new ToggleComponent(row).setTooltip(tooltip).setValue(value).onChange(onChange);
      };

      const addSubtypToggle = (label) =>
        addLabeledToggle(
          label,
          "Farbe des Subtyps statt der des TYPs verwenden",
          this.plugin.settings.colorViews.noteTitleMarkerSubtyp,
          async (value) => {
            this.plugin.settings.colorViews.noteTitleMarkerSubtyp = value;
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
          }
        );

      if (!isBadge) {
        addSubtypToggle("Subtyp");
        return;
      }

      const labelRow = noteTitleSetting.controlEl.createDiv({ cls: "fred-note-title-toggle-row" });
      labelRow.createSpan({ cls: "fred-note-title-toggle-label", text: "Beschriftung" });
      new DropdownComponent(labelRow)
        .addOption("type", "[TYP]")
        .addOption("type-subtype", "[TYP/Subtyp]")
        .addOption("subtype", "[Subtyp]")
        .setValue(badgeLabel)
        .onChange(async (value) => {
          this.plugin.settings.noteTitleBadgeLabel = value;
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
          this.display();
        });

      addLabeledToggle("Farbig", "Farbig (TYP-Farbe) statt neutral", this.plugin.settings.noteTitleBadgeColored, async (value) => {
        this.plugin.settings.noteTitleBadgeColored = value;
        await this.plugin.saveSettings();
        this.plugin.refreshTypColors?.();
        this.display();
      });
      if (showSubtyp) addSubtypToggle("Subtyp-Farbe");

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
    });

    colorViewToggle(
      coloringGroup,
      "backlinks",
      "Backlinks",
      "Trefferzeilen im Backlinks-Pane sowie in den im Dokument eingebetteten Backlinks (inkl. nicht verlinkter Erwähnungen) nach TYP einfärben.",
      "backlinksSubtyp"
    );
    colorViewToggle(
      coloringGroup,
      "bookmarks",
      "Bookmarks",
      "Einträge im Bookmarks-Pane, die direkt auf eine Notiz zeigen, nach TYP einfärben.",
      "bookmarksSubtyp"
    );
    colorViewToggle(
      coloringGroup,
      "allProperties",
      "All Properties",
      "In Obsidians vault-weiter \"All Properties\"-Ansicht Property-Namen einfärben, die im TYP-Frontmatter genau eines TYPs vorkommen (in dessen Farbe) - kommen sie bei mehreren TYPs vor, stattdessen fett statt eingefärbt. Mit \"Subtyp\" zählen auch die Frontmatter-Blöcke der Subtypen für ihren jeweiligen TYP, eingefärbt in der Farbe des Subtyps.",
      "allPropertiesSubtyp",
      { typTooltip: "TYP-Frontmatter der TYPen", subtypTooltip: "Frontmatter-Blöcke der Subtypen mit einbeziehen, in Subtyp-Farbe" }
    );

    // Grenzen der drei Regler, mit denen ein Subtyp seine Farbe von der seines
    // TYPs ableitet (Farbpunkt unten im Subtyp-Block der TYP-Detailansicht,
    // siehe type-colors.js). Eine schon eingestellte, größere Abweichung wird
    // auf die neue Grenze gekappt.
    const subtypeColorGroup = new SettingGroup(containerEl).setHeading("Subtyp-Farben");
    const rangeMax = { h: 180, s: 100, l: 100 };
    const rangeDesc = {
      h: "Wie weit der Farbton eines Subtyps höchstens von dem seines TYPs abweichen darf (± Grad).",
      s: "Wie weit die Sättigung eines Subtyps höchstens von der seines TYPs abweichen darf (± Prozent).",
      l: "Wie weit die Helligkeit eines Subtyps höchstens von der seines TYPs abweichen darf (± Prozentpunkte).",
    };
    // Der Regler meldet jede Zwischenstellung - die übrigen Ansichten erst
    // nachziehen, wenn er kurz ruht.
    const refreshColorsSoon = debounce(() => this.plugin.refreshTypColors?.(), 300, true);
    for (const { key, label, unit } of SUBTYPE_COLOR_CHANNELS) {
      subtypeColorGroup.addSetting((setting) =>
        setting
          .setName(`${label} (± ${unit})`)
          .setDesc(rangeDesc[key])
          .addSlider((slider) =>
            slider
              .setLimits(0, rangeMax[key], 1)
              .setValue(colorRange(this.plugin.settings, key))
              .setDynamicTooltip()
              .onChange(async (value) => {
                this.plugin.settings.subtypeColorRanges = { ...DEFAULT_SUBTYPE_COLOR_RANGES, ...this.plugin.settings.subtypeColorRanges, [key]: value };
                await this.plugin.saveSettings();
                refreshColorsSoon();
              })
          )
          .addExtraButton((button) =>
            button
              .setIcon("rotate-ccw")
              .setTooltip(`Zurücksetzen auf ${DEFAULT_SUBTYPE_COLOR_RANGES[key]}`)
              .onClick(async () => {
                this.plugin.settings.subtypeColorRanges = { ...DEFAULT_SUBTYPE_COLOR_RANGES, ...this.plugin.settings.subtypeColorRanges, [key]: DEFAULT_SUBTYPE_COLOR_RANGES[key] };
                await this.plugin.saveSettings();
                this.plugin.refreshTypColors?.();
                this.display();
              })
          )
      );
    }

    const graphGroup = new SettingGroup(containerEl).setHeading("Graph");

    // Ein Setting pro Node-Typ, den Obsidians Graph-Engine kennt - gleicher
    // Aufbau (Toggle + Farbwahl + Zurücksetzen) für jeden, daher als Helper
    // statt dupliziert.
    const graphColorSetting = (enabledKey, colorKey, defaultColor, name, desc) =>
      graphGroup.addSetting((setting) =>
        setting
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
          )
      );

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

    const frontmatterGroup = new SettingGroup(containerEl).setHeading("TYP-Frontmatter");

    colorViewToggle(
      frontmatterGroup,
      "frontmatterDefaults",
      "Property-Namen fett markieren",
      "In Notizen (Frontmatter im Dokument sowie Properties-Seitenleiste) die Namen der Properties fett darstellen, die im TYP-Frontmatter des jeweiligen TYPs hinterlegt sind. Mit \"Subtyp\" zusätzlich die aus dem Frontmatter-Block ihres SUBTYPs.",
      "frontmatterDefaultsSubtyp",
      { typTooltip: "TYP-Frontmatter der TYPen", subtypTooltip: "Frontmatter-Blöcke der Subtypen mit einbeziehen" }
    );

    // Order-Editor samt Beschreibung als eigener Eintrag derselben Gruppe -
    // bringt Überschrift und Buttons selbst mit, daher direkt in infoEl statt
    // über setName/setDesc (siehe .fred-order-setting in styles.css).
    frontmatterGroup.addSetting((setting) => {
      setting.settingEl.addClass("fred-order-setting");
      mountGlobalOrderEditor(setting.infoEl, this.plugin);
      setting.infoEl.createDiv({
        cls: "setting-item-description",
        text:
          'Bestimmt die Reihenfolge, in der die Befehle "Frontmatter Sortierung aktualisieren" die in einer Notiz vorhandenen Properties anordnen (ergänzt oder ändert keine Werte). Einzelne Properties (z. B. cssclasses, aliases) lassen sich fest platzieren - "TYP" ist die TYP-Property selbst, "SUBTYP" analog die SUBTYP-Property, "TYP-Frontmatter" steht für die TYP-Frontmatter-Liste des jeweiligen Typs samt dahinter dem Block seines SUBTYPs, "Sonstige Properties" für alles Übrige. Reihenfolge per Drag & Drop änderbar, die vier Platzhalter-Zeilen lassen sich nicht entfernen.',
      });
    });

    containerEl.scrollTop = scrollTop;
  }
}

module.exports = { DEFAULT_SETTINGS, TypSystemSettingTab };
