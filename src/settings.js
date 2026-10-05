const { PluginSettingTab, SettingGroup, ToggleComponent, DropdownComponent, debounce } = require("obsidian");
const { mountGlobalOrderEditor } = require("./frontmatter-order-editor");
const { DEFAULT_GLOBAL_ORDER } = require("./frontmatter-sort");
const { SUBTYP_COLOR_CHANNELS, DEFAULT_SUBTYP_COLOR_RANGES, colorRange } = require("./typ-colors");

const DEFAULT_SETTINGS = {
  typs: [],
  typColors: {},
  typDescriptions: {},
  typDefaultFrontmatter: {},
  // Keys of typDefaultFrontmatter[typ] marked as floating. They share the list
  // and its order (which frontmatter sorting uses), but getTypDefaults() leaves
  // them out unless asked with includeFloating, so new notes don't get them
  // automatically.
  typFloatingKeys: {},
  // Shortcuts per key of typDefaultFrontmatter[typ]:
  //   { [TYP]: { [Property]: { name: "today" | "tp.<script>" } } }
  // Kept NEXT TO the frontmatter, not as its value - see shortcuts.js.
  typShortcuts: {},
  typManual: {},
  // Registered Subtyps per TYP with their own frontmatter block, see subtyps.js.
  typSubtyps: {},
  // Pinned single properties (kind: "property") plus the four fixed
  // placeholders "typValue", "subtypValue", "typ" and "other" - see
  // frontmatter-sort.js.
  globalPropertyOrder: DEFAULT_GLOBAL_ORDER,
  // How the open note shows its TYP (see active-title-colors.js): "none",
  // "dot" or "badge". The three badge settings below only matter for "badge".
  // colorViews.noteTitleColor (the title text itself) is independent.
  noteTitleStyle: "dot",
  // Badge colored (TYP color) or neutral (text-muted).
  noteTitleBadgeColored: true,
  // Badge label: "typ" ([TYP]), "typ-subtyp" ([TYP/Subtyp]) or "subtyp"
  // ([Subtyp]; no badge without a Subtyp). Colored in the TYP or Subtyp color;
  // for "typ-subtyp" chosen with colorViews.noteTitleMarkerSubtyp.
  noteTitleBadgeLabel: "typ",
  // "title" (next to the inline title) or "block" (left of the property
  // block, turned 90°).
  noteTitleBadgePosition: "title",
  // For position "block": top or bottom edge of the property block.
  noteTitleVerticalAlign: "top",
  typSortOrder: "count-desc",
  // What the TYP-List shows next to the name: "subtyps", "description" or
  // "none". Switched by the header button next to sorting (SECONDARY_MODES in
  // typ-pane.js), not here: like the sort order it only concerns that list.
  typListSecondary: "subtyps",
  // See pickTypAndSubtyp in typ-picker.js: false = each Subtyp indented in the
  // TYP-Picker, true = a separate Subtyp-Picker after the TYP choice.
  separateSubtypPicker: false,
  includeIgnoredFiles: false,
  // Ask before deleting a TYP or a Subtyp with properties. Only deletions that
  // touch nothing but these settings can be switched off ("Don't ask again" in
  // the dialog) - they can be undone (undo.js). Anything that rewrites notes
  // or files always asks.
  confirmDeletion: true,
  // Own tag/attachment colors in the graph disabled (2026-09-30): the Minimal
  // theme's Style Settings cover both, see graph-colors.js.
  // graphTagColorEnabled: false,
  // graphTagColor: "",
  // graphAttachmentColorEnabled: false,
  // graphAttachmentColor: "",
  // How far a Subtyp's color may differ from its TYP's (±), see typ-colors.js:
  // hue in degrees, lightness in % of the way to white or black.
  subtypColorRanges: { ...DEFAULT_SUBTYP_COLOR_RANGES },
  colorViews: {
    fileExplorer: true,
    graph: true,
    search: true,
    recentFiles: true,
    backlinks: true,
    bookmarks: true,
    // Bases: file names; the two sub-rows below it color links in values and
    // group headings (see bases-colors.js).
    bases: true,
    basesLinks: true,
    basesGroupHeadings: true,
    // "<view>Subtyp" sub-toggles: use a note's Subtyp color instead of its
    // TYP's (see colorForFile in typ-colors.js).
    fileExplorerSubtyp: true,
    graphSubtyp: true,
    searchSubtyp: true,
    recentFilesSubtyp: true,
    backlinksSubtyp: true,
    bookmarksSubtyp: true,
    basesSubtyp: true,
    basesLinksSubtyp: true,
    basesGroupHeadingsSubtyp: true,
    linksSubtyp: true,
    propertyLinksSubtyp: true,
    typListSubtyp: true,
    noteTitleColorSubtyp: true,
    noteTitleMarkerSubtyp: true,
    frontmatterDefaults: true,
    // Sub-toggle of frontmatterDefaults and allProperties: include the Subtyp
    // blocks (see frontmatter-default-highlight.js); for allProperties also in
    // the Subtyp color.
    frontmatterDefaultsSubtyp: true,
    typList: true,
    allProperties: true,
    allPropertiesSubtyp: true,
    noteTitleColor: true,
    links: true,
    // Links in property values (see property-link-colors.js).
    propertyLinks: true,
  },
};

class TypSystemSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Each section is a SettingGroup (heading plus one box, entries separated by
  // lines), like Obsidian's core settings. Settings created one by one with
  // new Setting(containerEl) would each get their own small box.
  display() {
    const { containerEl } = this;
    // Keep the scroll position across rebuilds (toggles with sub-options call
    // display()): the TYP marker dropdown measures itself on setValue() and
    // forces a layout while the page is only partly built, so the browser
    // clamps scrollTop to that height and the page would jump up.
    const { scrollTop } = containerEl;
    containerEl.empty();

    new SettingGroup(containerEl)
      .setHeading("General")
      .addSetting((setting) =>
        setting
          .setName("Include excluded files")
          .setDesc(
            "Count notes from Obsidian's \"Excluded files\" (e.g. folders hidden by Hide Folders) in TYP counts, the TYP-Picker and frontmatter sorting."
          )
          .addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.includeIgnoredFiles).onChange(async (value) => {
              this.plugin.settings.includeIgnoredFiles = value;
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
            })
          )
      )
      .addSetting((setting) =>
        setting
          .setName("Confirm deletion")
          .setDesc(
            "Ask before deleting a TYP or a Subtyp with properties. When off, they are deleted at once; either way the notice afterwards offers Undo. Dialogs that rewrite notes (rename and update notes, merge) always ask."
          )
          .addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.confirmDeletion).onChange(async (value) => {
              this.plugin.settings.confirmDeletion = value;
              await this.plugin.saveSettings();
            })
          )
      )
      .addSetting((setting) =>
        setting
          .setName("Separate Subtyp-Picker")
          .setDesc(
            "After choosing a TYP, choose the Subtyp in a second picker. When off, each Subtyp is listed indented below its TYP."
          )
          .addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.separateSubtypPicker).onChange(async (value) => {
              this.plugin.settings.separateSubtypPicker = value;
              await this.plugin.saveSettings();
            })
          )
      );

    // subtypKey (optional): two labeled toggles instead of one - "TYP" for the
    // setting itself and below it "Subtyp", shown only while "TYP" is on. The
    // default tooltips fit the coloring toggles.
    //
    // nested: an indented sub-row of the row above (.typ-nested-setting). Its
    // own toggles work as usual; the caller adds it only while the main row is
    // on - the main row's "TYP" toggle re-renders the page via display(), so
    // sub-rows come and go with it:
    //   colorViewToggle(group, "main", "Main", "…", "mainSubtyp");
    //   if (this.plugin.settings.colorViews.main) {
    //     colorViewToggle(group, "mainPart", "Main part", "…", "mainPartSubtyp", { nested: true });
    //   }
    // The module behind it checks both toggles (enabled in view-colors.js).
    const colorViewToggle = (
      group,
      key,
      name,
      desc,
      subtypKey = null,
      { typTooltip = "Color by TYP", subtypTooltip = "Use Subtyp color instead of TYP color", nested = false } = {}
    ) =>
      group.addSetting((setting) => {
        setting.setName(name).setDesc(desc);
        if (nested) setting.settingEl.addClass("typ-nested-setting");
        const save = async (settingKey, value) => {
          this.plugin.settings.colorViews[settingKey] = value;
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
        };

        if (!subtypKey) {
          setting.addToggle((toggle) => toggle.setValue(this.plugin.settings.colorViews[key]).onChange((value) => save(key, value)));
          return;
        }

        setting.settingEl.addClass("typ-note-title-setting");
        const addRow = (label, tooltip, settingKey, onChanged) => {
          const row = setting.controlEl.createDiv({ cls: "typ-note-title-toggle-row" });
          row.createSpan({ cls: "typ-note-title-toggle-label", text: label });
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

    const coloringGroup = new SettingGroup(containerEl).setHeading("Coloring");

    colorViewToggle(coloringGroup, "fileExplorer", "File explorer", "Color note names in the file explorer.", "fileExplorerSubtyp");
    colorViewToggle(coloringGroup, "graph", "Graph", "Color nodes in the global and local graph.", "graphSubtyp");
    colorViewToggle(coloringGroup, "search", "Search", "Color result titles in search and in query blocks in notes.", "searchSubtyp");
    colorViewToggle(
      coloringGroup,
      "bases",
      "Bases",
      "Color note names in Bases (table, cards, list), in .base files and embedded in notes.",
      "basesSubtyp"
    );
    if (this.plugin.settings.colorViews.bases) {
      colorViewToggle(
        coloringGroup,
        "basesLinks",
        "Bases links",
        "Color links in values: link properties, file.links, backlinks, embeds and formulas.",
        "basesLinksSubtyp",
        { nested: true }
      );
      colorViewToggle(
        coloringGroup,
        "basesGroupHeadings",
        "Bases group headings",
        "Color group headings that link to a note.",
        "basesGroupHeadingsSubtyp",
        { nested: true }
      );
    }
    colorViewToggle(coloringGroup, "recentFiles", "Recent Files", "Color entries in the Recent Files plugin.", "recentFilesSubtyp");
    colorViewToggle(
      coloringGroup,
      "links",
      "Links in notes",
      "Color internal links by the TYP of their target (reading view, Live Preview, hover preview). Unresolved links stay as they are.",
      "linksSubtyp"
    );
    colorViewToggle(
      coloringGroup,
      "propertyLinks",
      "Property links",
      "Color internal links in property values by the TYP of their target (property block, properties sidebar, hover preview, TYP-Pane). External links and links to notes that don't exist stay as they are.",
      "propertyLinksSubtyp"
    );
    colorViewToggle(coloringGroup, "typList", "TYP-Pane", "Color names in the TYP-Pane and TYP-Picker.", "typListSubtyp");
    colorViewToggle(
      coloringGroup,
      "noteTitleColor",
      "Color note title",
      "Color the inline title of the open note.",
      "noteTitleColorSubtyp"
    );

    // Progressive disclosure: "badge" adds toggles (color, position) to this
    // one setting row, position "block" one more (alignment). Each re-renders
    // via display() so only the relevant ones show.
    const isBadge = this.plugin.settings.noteTitleStyle === "badge";
    const isBlockPosition = this.plugin.settings.noteTitleBadgePosition === "block";

    coloringGroup.addSetting((noteTitleSetting) => {
      noteTitleSetting
        .setName("TYP marker in note")
        .setDesc(isBadge ? "Badge options: label, color, position." : "How the open note shows its TYP.")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("none", "None")
            .addOption("dot", "Dot at title")
            .addOption("badge", "Badge with TYP name")
            .setValue(this.plugin.settings.noteTitleStyle)
            .onChange(async (value) => {
              this.plugin.settings.noteTitleStyle = value;
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
              this.display();
            })
        );

      // "Subtyp" (Subtyp color instead of TYP color) only while the marker is
      // colored at all: always for the dot, for the badge only with "Colored"
      // and label [TYP/Subtyp] - with [TYP] or [Subtyp] the color follows the
      // label.
      const badgeLabel = this.plugin.settings.noteTitleBadgeLabel ?? "typ";
      const showSubtyp =
        this.plugin.settings.noteTitleStyle === "dot" ||
        (isBadge && this.plugin.settings.noteTitleBadgeColored && badgeLabel === "typ-subtyp");
      if (!isBadge && !showSubtyp) return;

      // Stacks the extra toggles instead of Obsidian's side-by-side layout,
      // see .typ-note-title-setting in styles.css.
      noteTitleSetting.settingEl.addClass("typ-note-title-setting");

      // A small label per toggle - addToggle() alone adds a bare switch.
      const addLabeledToggle = (label, tooltip, value, onChange) => {
        const row = noteTitleSetting.controlEl.createDiv({ cls: "typ-note-title-toggle-row" });
        row.createSpan({ cls: "typ-note-title-toggle-label", text: label });
        new ToggleComponent(row).setTooltip(tooltip).setValue(value).onChange(onChange);
      };

      const addSubtypToggle = (label) =>
        addLabeledToggle(
          label,
          "Use Subtyp color instead of TYP color",
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

      const labelRow = noteTitleSetting.controlEl.createDiv({ cls: "typ-note-title-toggle-row" });
      labelRow.createSpan({ cls: "typ-note-title-toggle-label", text: "Label" });
      new DropdownComponent(labelRow)
        .addOption("typ", "[TYP]")
        .addOption("typ-subtyp", "[TYP/Subtyp]")
        .addOption("subtyp", "[Subtyp]")
        .setValue(badgeLabel)
        .onChange(async (value) => {
          this.plugin.settings.noteTitleBadgeLabel = value;
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
          this.display();
        });

      addLabeledToggle("Colored", "Colored instead of neutral", this.plugin.settings.noteTitleBadgeColored, async (value) => {
        this.plugin.settings.noteTitleBadgeColored = value;
        await this.plugin.saveSettings();
        this.plugin.refreshTypColors?.();
        this.display();
      });
      if (showSubtyp) addSubtypToggle("Subtyp color");

      addLabeledToggle("At property block", "At the property block (rotated) instead of the title", isBlockPosition, async (value) => {
        this.plugin.settings.noteTitleBadgePosition = value ? "block" : "title";
        await this.plugin.saveSettings();
        this.plugin.refreshTypColors?.();
        this.display();
      });

      if (isBlockPosition) {
        addLabeledToggle(
          "Top instead of bottom",
          "Top of the property block instead of bottom",
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
      "Color results in the backlinks pane and in embedded backlinks, including unlinked mentions.",
      "backlinksSubtyp"
    );
    colorViewToggle(coloringGroup, "bookmarks", "Bookmarks", "Color bookmarks that point directly to a note.", "bookmarksSubtyp");
    colorViewToggle(
      coloringGroup,
      "allProperties",
      "All Properties",
      "In Obsidian's \"All properties\" view, color property names that belong to exactly one TYP-Frontmatter, or bold them if more than one TYP uses them. With Subtyp, Subtyp blocks count as well, in the Subtyp color.",
      "allPropertiesSubtyp",
      { typTooltip: "TYP-Frontmatter", subtypTooltip: "Include Subtyp blocks, in Subtyp color" }
    );

    // Limits of the sliders a Subtyp derives its color with (dot at the bottom
    // of a Subtyp block, see typ-colors.js). A larger stored offset is clamped
    // to the new limit.
    const subtypColorGroup = new SettingGroup(containerEl).setHeading("Subtyp colors");
    const rangeMax = { h: 180, /* s: 100, */ l: 100 };
    const rangeDesc = {
      h: "Maximum hue difference between a Subtyp and its TYP.",
      // s: "Maximum share by which a Subtyp may be paler than its TYP. Only goes down - a Subtyp shouldn't be louder than its TYP.",
      l: "Maximum lightness difference between a Subtyp and its TYP, as a share of the way to white or black.",
    };
    // The slider reports every step; the other views only follow once it rests.
    const refreshColorsSoon = debounce(() => this.plugin.refreshTypColors?.(), 300, true);
    for (const { key, label, unit, downOnly } of SUBTYP_COLOR_CHANNELS) {
      subtypColorGroup.addSetting((setting) =>
        setting
          .setName(`${label} (${downOnly ? "−" : "±"} ${unit})`)
          .setDesc(rangeDesc[key])
          .addSlider((slider) =>
            slider
              .setLimits(0, rangeMax[key], 1)
              .setValue(colorRange(this.plugin.settings, key))
              .setDynamicTooltip()
              .onChange(async (value) => {
                this.plugin.settings.subtypColorRanges = { ...DEFAULT_SUBTYP_COLOR_RANGES, ...this.plugin.settings.subtypColorRanges, [key]: value };
                await this.plugin.saveSettings();
                refreshColorsSoon();
              })
          )
          .addExtraButton((button) =>
            button
              .setIcon("rotate-ccw")
              .setTooltip(`Reset to ${DEFAULT_SUBTYP_COLOR_RANGES[key]}`)
              .onClick(async () => {
                this.plugin.settings.subtypColorRanges = { ...DEFAULT_SUBTYP_COLOR_RANGES, ...this.plugin.settings.subtypColorRanges, [key]: DEFAULT_SUBTYP_COLOR_RANGES[key] };
                await this.plugin.saveSettings();
                this.plugin.refreshTypColors?.();
                this.display();
              })
          )
      );
    }

    // Group "Graph" (tag/attachment colors) disabled (2026-09-30): the Minimal
    // theme's Style Settings cover both, see graph-colors.js. Coloring note
    // nodes by TYP stays, under "Coloring" → "Graph".
    //     const graphGroup = new SettingGroup(containerEl).setHeading("Graph");
    //
    //     // One setting per node kind the graph engine knows, same layout
    //     // (toggle + color picker + reset) for each.
    //     const graphColorSetting = (enabledKey, colorKey, defaultColor, name, desc) =>
    //       graphGroup.addSetting((setting) =>
    //         setting
    //           .setName(name)
    //           .setDesc(desc)
    //           .addToggle((toggle) =>
    //             toggle.setValue(this.plugin.settings[enabledKey]).onChange(async (value) => {
    //               this.plugin.settings[enabledKey] = value;
    //               await this.plugin.saveSettings();
    //               this.plugin.refreshTypColors?.();
    //             })
    //           )
    //           .addColorPicker((picker) =>
    //             picker.setValue(this.plugin.settings[colorKey] || defaultColor).onChange(async (value) => {
    //               this.plugin.settings[colorKey] = value;
    //               await this.plugin.saveSettings();
    //               this.plugin.refreshTypColors?.();
    //             })
    //           )
    //           .addExtraButton((button) =>
    //             button
    //               .setIcon("rotate-ccw")
    //               .setTooltip("Reset to default color")
    //               .onClick(async () => {
    //                 this.plugin.settings[colorKey] = "";
    //                 await this.plugin.saveSettings();
    //                 this.plugin.refreshTypColors?.();
    //                 this.display();
    //               })
    //           )
    //       );
    //
    //     graphColorSetting(
    //       "graphTagColorEnabled",
    //       "graphTagColor",
    //       "#888888",
    //       "Tag color",
    //       "Own color for tag nodes in the global and local graph. Color groups still take precedence."
    //     );
    //     graphColorSetting(
    //       "graphAttachmentColorEnabled",
    //       "graphAttachmentColor",
    //       "#e0ac00",
    //       "Attachment color",
    //       "Own color for attachment nodes (non-markdown files such as images or PDFs) in the graph."
    //     );

    const frontmatterGroup = new SettingGroup(containerEl).setHeading("TYP-Frontmatter");

    colorViewToggle(
      frontmatterGroup,
      "frontmatterDefaults",
      "Bold TYP properties",
      "Show TYP-Frontmatter property names in bold in notes and the properties sidebar. With Subtyp, the note's Subtyp block counts as well.",
      "frontmatterDefaultsSubtyp",
      { typTooltip: "TYP-Frontmatter", subtypTooltip: "Include Subtyp blocks" }
    );

    // The order editor brings its own heading and buttons, so it goes straight
    // into infoEl instead of setName/setDesc (see .typ-order-setting).
    frontmatterGroup.addSetting((setting) => {
      setting.settingEl.addClass("typ-order-setting");
      mountGlobalOrderEditor(setting.infoEl, this.plugin);
      setting.infoEl.createDiv({
        cls: "setting-item-description",
        text:
          'Order applied by the "Sort frontmatter" commands; values are never changed. Pin single properties such as cssclasses or aliases. Drag to reorder; hover a placeholder row for what it stands for. Placeholder rows can\'t be removed.',
      });
    });

    containerEl.scrollTop = scrollTop;
  }
}

module.exports = { DEFAULT_SETTINGS, TypSystemSettingTab };
