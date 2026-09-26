var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/frontmatter-sort.js
var require_frontmatter_sort = __commonJS({
  "src/frontmatter-sort.js"(exports2, module2) {
    var TYP_PROPERTY = "TYP";
    var SUBTYP_PROPERTY = "SUBTYP";
    var DEFAULT_GLOBAL_ORDER = [{ kind: "typValue" }, { kind: "subtypValue" }, { kind: "typ" }, { kind: "other" }];
    function normalizeGlobalOrder2(order) {
      const result = Array.isArray(order) ? order.filter((entry) => entry && typeof entry === "object") : [];
      const hasKind = (kind) => result.some((entry) => entry.kind === kind);
      if (!hasKind("typValue")) result.unshift({ kind: "typValue" });
      if (!hasKind("subtypValue")) {
        const typValueIndex = result.findIndex((entry) => entry.kind === "typValue");
        result.splice(typValueIndex + 1, 0, { kind: "subtypValue" });
      }
      if (!hasKind("typ")) result.push({ kind: "typ" });
      if (!hasKind("other")) result.push({ kind: "other" });
      return result;
    }
    function orderedDefaultKeys(plugin, type) {
      if (!type) return null;
      const standard = plugin.settings.typeDefaultFrontmatter[type] ?? {};
      const keys = Object.keys(standard).filter((key) => key !== "" && key.toLowerCase() !== TYP_PROPERTY.toLowerCase());
      return keys.length > 0 ? keys : null;
    }
    function computeSortedKeys(existingKeys, globalOrder, typeDefaultKeys) {
      const lowerToActual = new Map(existingKeys.map((key) => [key.toLowerCase(), key]));
      const resolve = (name) => lowerToActual.get(name.toLowerCase());
      const pinned = new Set(
        globalOrder.filter((entry) => entry.kind === "property").map((entry) => resolve(entry.name)).filter(Boolean)
      );
      const typKey = resolve(TYP_PROPERTY);
      const subtypKey = resolve(SUBTYP_PROPERTY);
      const typBlockKeys = new Set(
        (typeDefaultKeys ?? []).map(resolve).filter((key) => key && key !== typKey && !pinned.has(key))
      );
      const claimed = new Set(pinned);
      for (const key of typBlockKeys) claimed.add(key);
      if (typKey) claimed.add(typKey);
      if (subtypKey) claimed.add(subtypKey);
      const sortedKeys = [];
      const seen = /* @__PURE__ */ new Set();
      const push = (key) => {
        if (key && !seen.has(key)) {
          sortedKeys.push(key);
          seen.add(key);
        }
      };
      for (const entry of globalOrder) {
        if (entry.kind === "property") push(resolve(entry.name));
        else if (entry.kind === "typValue") push(typKey);
        else if (entry.kind === "subtypValue") push(subtypKey);
        else if (entry.kind === "typ") {
          for (const name of typeDefaultKeys ?? []) {
            const key = resolve(name);
            if (key && typBlockKeys.has(key)) push(key);
          }
        } else if (entry.kind === "other") {
          for (const key of existingKeys) {
            if (!claimed.has(key)) push(key);
          }
        }
      }
      for (const key of existingKeys) push(key);
      return sortedKeys;
    }
    function cachedFrontmatterKeys(app, file) {
      const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) return null;
      return Object.keys(frontmatter).filter((key) => key !== "position");
    }
    async function sortFileFrontmatter(app, file, globalOrder, typeDefaultKeys) {
      const cachedKeys = cachedFrontmatterKeys(app, file);
      if (!cachedKeys || cachedKeys.length <= 1) return false;
      const cachedSorted = computeSortedKeys(cachedKeys, globalOrder, typeDefaultKeys);
      if (cachedSorted.every((key, i) => key === cachedKeys[i])) return false;
      let changed = false;
      await app.fileManager.processFrontMatter(file, (frontmatter) => {
        const existingKeys = Object.keys(frontmatter);
        if (existingKeys.length <= 1) return;
        const sortedKeys = computeSortedKeys(existingKeys, globalOrder, typeDefaultKeys);
        if (sortedKeys.every((key, i) => key === existingKeys[i])) return;
        const snapshot = { ...frontmatter };
        for (const key of existingKeys) delete frontmatter[key];
        for (const key of sortedKeys) frontmatter[key] = snapshot[key];
        changed = true;
      });
      return changed;
    }
    async function sortSingleFileFrontmatter(app, plugin, file) {
      const globalOrder = normalizeGlobalOrder2(plugin.settings.globalPropertyOrder);
      const type = plugin.typIndex.typeOf(file);
      const typeDefaultKeys = orderedDefaultKeys(plugin, type);
      return sortFileFrontmatter(app, file, globalOrder, typeDefaultKeys);
    }
    async function sortAllFrontmatter(app, plugin, onlyType) {
      let checked = 0;
      let changed = 0;
      const globalOrder = normalizeGlobalOrder2(plugin.settings.globalPropertyOrder);
      const hasTypeDefaults = onlyType ? orderedDefaultKeys(plugin, onlyType) !== null : null;
      for (const file of app.vault.getMarkdownFiles()) {
        if (!plugin.settings.includeIgnoredFiles && app.metadataCache.isUserIgnored(file.path)) continue;
        const type = plugin.typIndex.typeOf(file);
        if (onlyType && type !== onlyType) continue;
        const typeDefaultKeys = orderedDefaultKeys(plugin, type);
        checked++;
        if (await sortFileFrontmatter(app, file, globalOrder, typeDefaultKeys)) changed++;
      }
      return { checked, changed, hasTypeDefaults };
    }
    module2.exports = {
      sortAllFrontmatter,
      sortSingleFileFrontmatter,
      normalizeGlobalOrder: normalizeGlobalOrder2,
      DEFAULT_GLOBAL_ORDER,
      TYP_PROPERTY,
      SUBTYP_PROPERTY
    };
  }
});

// src/frontmatter-order-editor.js
var require_frontmatter_order_editor = __commonJS({
  "src/frontmatter-order-editor.js"(exports2, module2) {
    var { setIcon, Notice } = require("obsidian");
    var { TYP_PROPERTY, SUBTYP_PROPERTY, sortAllFrontmatter } = require_frontmatter_sort();
    var PLACEHOLDER_LABELS = {
      typValue: "TYP",
      subtypValue: "SUBTYP",
      typ: "TYP Properties",
      other: "Sonstige Properties"
    };
    function mountGlobalOrderEditor(containerEl, plugin) {
      const header = containerEl.createDiv({ cls: "fred-typ-frontmatter-header" });
      const titleGroup = header.createDiv({ cls: "fred-typ-frontmatter-title-group" });
      const applyBtn = titleGroup.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Auf alle Notizen anwenden" } });
      setIcon(applyBtn, "play");
      applyBtn.addEventListener("click", async () => {
        try {
          const { checked, changed } = await sortAllFrontmatter(plugin.app, plugin, null);
          new Notice(
            changed > 0 ? `Frontmatter Sortierung: ${checked} Notizen gepr\xFCft, ${changed} sortiert.` : `Frontmatter Sortierung: ${checked} Notizen gepr\xFCft, bereits alle sortiert.`
          );
        } catch (error) {
          console.error("[Frontmatter Sortierung]", error);
          new Notice(`Frontmatter Sortierung fehlgeschlagen: ${error.message}`);
        }
      });
      titleGroup.createDiv({ cls: "fred-typ-detail-section-title", text: "Globale Property-Reihenfolge" });
      const addBtn = header.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Property hinzuf\xFCgen" } });
      setIcon(addBtn, "plus");
      const listEl = containerEl.createDiv({ cls: "fred-order-list" });
      const order = () => plugin.settings.globalPropertyOrder;
      let draftEntry = null;
      const isDuplicateName = (value, ownEntry) => {
        const lower = value.toLowerCase();
        if (lower === TYP_PROPERTY.toLowerCase() || lower === SUBTYP_PROPERTY.toLowerCase()) return true;
        return order().some((other) => other !== ownEntry && other.kind === "property" && other.name.toLowerCase() === lower);
      };
      const render = () => {
        listEl.empty();
        const entries = draftEntry ? [...order(), draftEntry] : order();
        entries.forEach((entry, index) => {
          const isDraft = entry === draftEntry;
          const isPlaceholder = entry.kind !== "property";
          const rowCls = "fred-order-row" + (isPlaceholder ? " is-placeholder" : "") + (entry.kind === "typ" ? " is-typ-defaults" : "");
          const row = listEl.createDiv({ cls: rowCls });
          const dragHandle = row.createDiv({ cls: "fred-order-drag", attr: { "aria-label": "Verschieben" } });
          setIcon(dragHandle, "grip-vertical");
          if (isPlaceholder) {
            row.createDiv({ cls: "fred-order-label", text: PLACEHOLDER_LABELS[entry.kind] });
          } else {
            const input = row.createEl("input", {
              type: "text",
              cls: "fred-order-name-input",
              attr: { placeholder: "Property-Name" }
            });
            input.value = entry.name;
            input.addEventListener("blur", async () => {
              const value = input.value.trim();
              if (!value) {
                if (isDraft) {
                  draftEntry = null;
                } else {
                  order().splice(order().indexOf(entry), 1);
                  await plugin.saveSettings();
                }
                render();
                return;
              }
              if (isDuplicateName(value, isDraft ? null : entry)) {
                new Notice(`"${value}" ist bereits in der Liste.`);
                input.value = entry.name;
                return;
              }
              entry.name = value;
              if (isDraft) {
                order().push(entry);
                draftEntry = null;
              }
              await plugin.saveSettings();
              render();
            });
            const removeBtn = row.createDiv({ cls: "fred-order-remove clickable-icon", attr: { "aria-label": "Entfernen" } });
            setIcon(removeBtn, "x");
            removeBtn.addEventListener("click", async () => {
              if (isDraft) {
                draftEntry = null;
              } else {
                order().splice(order().indexOf(entry), 1);
                await plugin.saveSettings();
              }
              render();
            });
          }
          if (isDraft) return;
          row.draggable = true;
          row.addEventListener("dragstart", (event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(index));
            row.classList.add("is-dragging");
          });
          row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
          row.addEventListener("dragover", (event) => {
            event.preventDefault();
            const rect = row.getBoundingClientRect();
            const isAfter = event.clientY - rect.top > rect.height / 2;
            row.classList.toggle("is-drop-before", !isAfter);
            row.classList.toggle("is-drop-after", isAfter);
          });
          row.addEventListener("dragleave", () => row.classList.remove("is-drop-before", "is-drop-after"));
          row.addEventListener("drop", async (event) => {
            event.preventDefault();
            const isAfter = row.classList.contains("is-drop-after");
            row.classList.remove("is-drop-before", "is-drop-after");
            const fromIndex = Number(event.dataTransfer.getData("text/plain"));
            if (Number.isNaN(fromIndex)) return;
            let insertBefore = isAfter ? index + 1 : index;
            if (fromIndex < insertBefore) insertBefore -= 1;
            const [moved] = order().splice(fromIndex, 1);
            order().splice(insertBefore, 0, moved);
            await plugin.saveSettings();
            render();
          });
        });
      };
      addBtn.addEventListener("click", () => {
        if (!draftEntry) {
          draftEntry = { kind: "property", name: "" };
          render();
        }
        const inputs = listEl.querySelectorAll(".fred-order-name-input");
        inputs[inputs.length - 1]?.focus();
      });
      render();
    }
    module2.exports = { mountGlobalOrderEditor };
  }
});

// src/settings.js
var require_settings = __commonJS({
  "src/settings.js"(exports2, module2) {
    var { PluginSettingTab, Setting, ToggleComponent } = require("obsidian");
    var { mountGlobalOrderEditor } = require_frontmatter_order_editor();
    var { DEFAULT_GLOBAL_ORDER } = require_frontmatter_sort();
    var DEFAULT_SETTINGS2 = {
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
        links: true
      }
    };
    var TypSystemSettingTab2 = class extends PluginSettingTab {
      constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
      }
      display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h4", { text: "TYP-Liste" });
        new Setting(containerEl).setName("Beschreibungs-Textfeld anzeigen").setDesc("Zeigt in der TYP-Liste neben jedem registrierten TYP ein Textfeld zur Bearbeitung seiner Beschreibung.").addToggle(
          (toggle) => toggle.setValue(this.plugin.settings.typListDescriptionEnabled).onChange(async (value) => {
            this.plugin.settings.typListDescriptionEnabled = value;
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
          })
        );
        new Setting(containerEl).setName("Ignorierte Notizen IMMER ber\xFCcksichtigen").setDesc(
          'Bezieht Notizen aus Obsidians "Excluded files"-Liste (dort tragen auch Plugins wie Hide Folders ausgeblendete Ordner ein) wieder in TYP-Z\xE4hler, TYP-Picker und die Frontmatter-Sortierung mit ein, statt sie zu \xFCberspringen.'
        ).addToggle(
          (toggle) => toggle.setValue(this.plugin.settings.includeIgnoredFiles).onChange(async (value) => {
            this.plugin.settings.includeIgnoredFiles = value;
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
          })
        );
        containerEl.createEl("h4", { text: "Einf\xE4rbung" });
        const colorViewToggle = (key, name, desc) => {
          new Setting(containerEl).setName(name).setDesc(desc).addToggle(
            (toggle) => toggle.setValue(this.plugin.settings.colorViews[key]).onChange(async (value) => {
              this.plugin.settings.colorViews[key] = value;
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
            })
          );
        };
        colorViewToggle("fileExplorer", "Datei-Explorer", "Notiznamen im Datei-Explorer nach TYP einf\xE4rben.");
        colorViewToggle("graph", "Graph", "Knoten im Graph (global und lokal) nach TYP einf\xE4rben.");
        colorViewToggle("search", "Suche", "Treffer-Titel in der Suche nach TYP einf\xE4rben.");
        colorViewToggle("recentFiles", "Recent Files", "Eintr\xE4ge im Recent-Files-Plugin nach TYP einf\xE4rben.");
        colorViewToggle(
          "links",
          "Links in Notizen",
          "Interne Links im Notiztext (Lese-Modus, Live Preview, Hover-Vorschau) in der Farbe des TYPs ihres Ziels darstellen. Nicht aufgel\xF6ste Links bleiben unver\xE4ndert."
        );
        colorViewToggle("typList", "TYP View", "Typ-Namen in der TYP-View selbst (Liste und Detailansicht) in ihrer jeweiligen Farbe darstellen.");
        colorViewToggle(
          "noteTitleColor",
          "Titel-Text einf\xE4rben",
          "F\xE4rbt den Inline-Titel der ge\xF6ffneten Notiz selbst in der Farbe ihres TYPs ein - unabh\xE4ngig von der TYP-Markierung daneben (s. u.), beides l\xE4sst sich kombinieren."
        );
        const isBadge = this.plugin.settings.noteTitleStyle === "badge";
        const isBlockPosition = this.plugin.settings.noteTitleBadgePosition === "block";
        const noteTitleSetting = new Setting(containerEl).setName("TYP-Markierung in der Notiz").setDesc(
          isBadge ? '"Box mit TYP-Namen" - Schalter: farbig/neutral, am Titel/am Property-Block (gedreht)' + (isBlockPosition ? ", oben/unten am Property-Block" : "") + "." : "Wie der TYP in der ge\xF6ffneten Notiz markiert wird."
        ).addDropdown(
          (dropdown) => dropdown.addOption("none", "Nichts").addOption("dot", "Farbpunkt am Titel").addOption("badge", "Box mit TYP-Namen").setValue(this.plugin.settings.noteTitleStyle).onChange(async (value) => {
            this.plugin.settings.noteTitleStyle = value;
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
            this.display();
          })
        );
        if (isBadge) noteTitleSetting.settingEl.addClass("fred-note-title-setting");
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
          "Trefferzeilen im Backlinks-Pane sowie in den im Dokument eingebetteten Backlinks (inkl. nicht verlinkter Erw\xE4hnungen) nach TYP einf\xE4rben."
        );
        colorViewToggle(
          "bookmarks",
          "Bookmarks",
          "Eintr\xE4ge im Bookmarks-Pane, die direkt auf eine Notiz zeigen, nach TYP einf\xE4rben."
        );
        colorViewToggle(
          "allProperties",
          "All Properties",
          'In Obsidians vault-weiter "All Properties"-Ansicht Property-Namen einf\xE4rben, die im Standard-Frontmatter genau eines TYPs vorkommen (in dessen Farbe) - kommen sie bei mehreren TYPs vor, stattdessen fett statt eingef\xE4rbt.'
        );
        containerEl.createEl("h4", { text: "Graph" });
        const graphColorSetting = (enabledKey, colorKey, defaultColor, name, desc) => {
          new Setting(containerEl).setName(name).setDesc(desc).addToggle(
            (toggle) => toggle.setValue(this.plugin.settings[enabledKey]).onChange(async (value) => {
              this.plugin.settings[enabledKey] = value;
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
            })
          ).addColorPicker(
            (picker) => picker.setValue(this.plugin.settings[colorKey] || defaultColor).onChange(async (value) => {
              this.plugin.settings[colorKey] = value;
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
            })
          ).addExtraButton(
            (button) => button.setIcon("rotate-ccw").setTooltip("Zur\xFCcksetzen auf Standardfarbe").onClick(async () => {
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
          "Eigene Farbe f\xFCr Tag-Knoten im Graph (global und lokal) verwenden statt der Standardfarbe. Eigene Farbgruppen im Graph haben weiterhin Vorrang."
        );
        graphColorSetting(
          "graphAttachmentColorEnabled",
          "graphAttachmentColor",
          "#e0ac00",
          "Anh\xE4nge-Farbe",
          "Eigene Farbe f\xFCr Anhang-Knoten (Nicht-Markdown-Dateien wie Bilder oder PDFs) im Graph verwenden statt der Standardfarbe."
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
          text: 'Bestimmt die Reihenfolge, in der die Befehle "Frontmatter Sortierung aktualisieren" die in einer Notiz vorhandenen Properties anordnen (erg\xE4nzt oder \xE4ndert keine Werte). Einzelne Properties (z. B. cssclasses, aliases) lassen sich fest platzieren - "TYP" ist die TYP-Property selbst, "SUBTYP" analog die SUBTYP-Property, "TYP Properties" steht f\xFCr die Standard-Frontmatter-Liste des jeweiligen Typs, "Sonstige Properties" f\xFCr alles \xDCbrige. Reihenfolge per Drag & Drop \xE4nderbar, die vier Platzhalter-Zeilen lassen sich nicht entfernen.'
        });
      }
    };
    module2.exports = { DEFAULT_SETTINGS: DEFAULT_SETTINGS2, TypSystemSettingTab: TypSystemSettingTab2 };
  }
});

// src/commands.js
var require_commands = __commonJS({
  "src/commands.js"(exports2, module2) {
    var { Notice } = require("obsidian");
    var { sortAllFrontmatter, sortSingleFileFrontmatter } = require_frontmatter_sort();
    function registerCommands2(plugin) {
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
        name: "TYP - Frontmatter Sortierung GLOBAL aktualisieren",
        callback: runOrReportError("Frontmatter Sortierung", async () => {
          const { checked, changed } = await sortAllFrontmatter(plugin.app, plugin, null);
          new Notice(
            changed > 0 ? `Frontmatter Sortierung: ${checked} Notizen gepr\xFCft, ${changed} sortiert.` : `Frontmatter Sortierung: ${checked} Notizen gepr\xFCft, bereits alle sortiert.`
          );
        })
      });
      plugin.addCommand({
        id: "frontmatter-sortierung-typ",
        name: "TYP - Frontmatter Sortierung f\xFCr TYP aktualisieren",
        callback: runOrReportError("Frontmatter Sortierung", async () => {
          const type = await plugin.pickType({ includeManualOff: true, includeUnregistered: true });
          if (!type) return;
          const { checked, changed, hasTypeDefaults } = await sortAllFrontmatter(plugin.app, plugin, type);
          let message = changed > 0 ? `Frontmatter Sortierung ${type}: ${checked} Notizen gepr\xFCft, ${changed} sortiert.` : `Frontmatter Sortierung ${type}: ${checked} Notizen gepr\xFCft, bereits alle sortiert.`;
          if (hasTypeDefaults === false) {
            message += ` Hinweis: F\xFCr ${type} ist kein Standard-Frontmatter hinterlegt - nur die globale Reihenfolge wurde angewendet.`;
          }
          new Notice(message);
        })
      });
      plugin.addCommand({
        id: "frontmatter-sortierung-aktive-notiz",
        name: "TYP - Frontmatter Sortierung der aktiven Notiz aktualisieren",
        checkCallback: (checking) => {
          const file = plugin.app.workspace.getActiveFile();
          if (!file || file.extension !== "md") return false;
          if (checking) return true;
          runOrReportError("Frontmatter Sortierung", async () => {
            const changed = await sortSingleFileFrontmatter(plugin.app, plugin, file);
            new Notice(changed ? `Frontmatter von "${file.basename}" sortiert.` : `Frontmatter von "${file.basename}" war bereits sortiert.`);
          })();
          return true;
        }
      });
    }
    module2.exports = { registerCommands: registerCommands2 };
  }
});

// src/frontmatter-placeholders.js
var require_frontmatter_placeholders = __commonJS({
  "src/frontmatter-placeholders.js"(exports2, module2) {
    var { moment } = require("obsidian");
    var FRONTMATTER_PLACEHOLDERS = [
      {
        token: "{{today}}",
        description: "Heutiges Datum (JJJJ-MM-TT)",
        resolve: () => moment().format("YYYY-MM-DD")
      },
      {
        token: "{{now}}",
        description: "Aktuelles Datum mit Uhrzeit (JJJJ-MM-TT HH:mm)",
        resolve: () => moment().format("YYYY-MM-DD HH:mm")
      },
      {
        // Anders als {{today}}/{{now}} nicht der Aufrufzeitpunkt, sondern das
        // Erstellungsdatum der jeweiligen Datei (file.stat.ctime) - braucht daher
        // die Ziel-Datei als Kontext, siehe file-Parameter bei resolve() und
        // resolveFrontmatterPlaceholders() unten. Ohne Datei (z. B. Aufruf ohne
        // file-Option) Fallback auf den aktuellen Zeitpunkt.
        token: "{{created}}",
        description: "Erstellungsdatum der Datei (JJJJ-MM-TT)",
        resolve: (file) => moment(file?.stat?.ctime ?? Date.now()).format("YYYY-MM-DD")
      }
    ];
    var DYNAMIC_PLACEHOLDER_PATTERN2 = /^\{\{tp\.([^{}]*[^{}\s][^{}]*)\}\}$/;
    var DYNAMIC_PLACEHOLDER_INFO = {
      token: "{{tp.<Skriptname>}}",
      description: "Ruft beim Anlegen tp.user.<Skriptname>(tp, newFile, ctx) auf \u2013 R\xFCckgabe: Wert dieser Property, oder ein Objekt mit Werten f\xFCr mehrere Properties des TYPs"
    };
    function resolveFrontmatterPlaceholders2(frontmatter, file) {
      const resolved = {};
      for (const [key, value] of Object.entries(frontmatter)) {
        const placeholder = FRONTMATTER_PLACEHOLDERS.find((p) => p.token === value);
        resolved[key] = placeholder ? placeholder.resolve(file) : value;
      }
      return resolved;
    }
    function isPlaceholderToken(value) {
      if (typeof value !== "string") return false;
      if (FRONTMATTER_PLACEHOLDERS.some((p) => p.token === value)) return true;
      return DYNAMIC_PLACEHOLDER_PATTERN2.test(value);
    }
    module2.exports = {
      FRONTMATTER_PLACEHOLDERS,
      DYNAMIC_PLACEHOLDER_PATTERN: DYNAMIC_PLACEHOLDER_PATTERN2,
      DYNAMIC_PLACEHOLDER_INFO,
      resolveFrontmatterPlaceholders: resolveFrontmatterPlaceholders2,
      isPlaceholderToken
    };
  }
});

// src/type-frontmatter-editor.js
var require_type_frontmatter_editor = __commonJS({
  "src/type-frontmatter-editor.js"(exports2, module2) {
    var { MarkdownView, Menu } = require("obsidian");
    var { isPlaceholderToken } = require_frontmatter_placeholders();
    var TYP_PROPERTY = "TYP";
    function stripTypProperty(frontmatter) {
      for (const key of Object.keys(frontmatter)) {
        if (key.trim().toLowerCase() === TYP_PROPERTY.toLowerCase()) delete frontmatter[key];
      }
      return frontmatter;
    }
    var cachedEditorClass = null;
    function getMetadataEditorClass(app) {
      if (cachedEditorClass) return cachedEditorClass;
      const active = app.workspace.getActiveViewOfType(MarkdownView);
      if (active?.metadataEditor) {
        cachedEditorClass = active.metadataEditor.constructor;
        return cachedEditorClass;
      }
      for (const leaf of app.workspace.getLeavesOfType("markdown")) {
        if (leaf.view?.metadataEditor) {
          cachedEditorClass = leaf.view.metadataEditor.constructor;
          return cachedEditorClass;
        }
      }
      return null;
    }
    var cachedPropertyRowClass = null;
    function getPropertyRowClass(app, editor) {
      if (cachedPropertyRowClass) return cachedPropertyRowClass;
      if (editor?.rendered?.[0]) {
        cachedPropertyRowClass = editor.rendered[0].constructor;
        return cachedPropertyRowClass;
      }
      const active = app.workspace.getActiveViewOfType(MarkdownView);
      if (active?.metadataEditor?.rendered?.[0]) {
        cachedPropertyRowClass = active.metadataEditor.rendered[0].constructor;
        return cachedPropertyRowClass;
      }
      for (const leaf of app.workspace.getLeavesOfType("markdown")) {
        if (leaf.view?.metadataEditor?.rendered?.[0]) {
          cachedPropertyRowClass = leaf.view.metadataEditor.rendered[0].constructor;
          return cachedPropertyRowClass;
        }
      }
      return null;
    }
    function ensurePropertyMenuPatch(app, editor) {
      const RowClass = getPropertyRowClass(app, editor);
      if (!RowClass || RowClass._fredMenuPatched) return;
      RowClass._fredMenuPatched = true;
      const originalShowPropertyMenu = RowClass.prototype.showPropertyMenu;
      RowClass.prototype.showPropertyMenu = function(event) {
        const owner = this.metadataEditor?.owner;
        if (!owner?.fredView) return originalShowPropertyMenu.call(this, event);
        const row = this;
        const originalShowAtMouseEvent = Menu.prototype.showAtMouseEvent;
        Menu.prototype.showAtMouseEvent = function(mouseEvent) {
          Menu.prototype.showAtMouseEvent = originalShowAtMouseEvent;
          const isFloating = (owner.fredView.plugin.settings.typeFloatingKeys[owner.fredType] ?? []).includes(
            row.entry.key
          );
          this.addItem(
            (item) => item.setTitle("Floating").setIcon("pin-off").setChecked(isFloating).setSection("title").onClick(() => toggleFloatingProperty(owner.fredView, owner.fredType, row.entry.key))
          );
          return originalShowAtMouseEvent.call(this, mouseEvent);
        };
        return originalShowPropertyMenu.call(this, event);
      };
    }
    function toggleFloatingProperty(view, type, key) {
      const floating = view.plugin.settings.typeFloatingKeys[type] ?? [];
      const next = floating.includes(key) ? floating.filter((k) => k !== key) : [...floating, key];
      if (next.length > 0) view.plugin.settings.typeFloatingKeys[type] = next;
      else delete view.plugin.settings.typeFloatingKeys[type];
      view.plugin.saveSettings();
      view.plugin.refreshTypColors?.();
    }
    function mountTypeFrontmatterEditor(view, containerEl, type) {
      const app = view.app;
      const EditorClass = getMetadataEditorClass(app);
      if (!EditorClass) {
        containerEl.createEl("p", {
          cls: "fred-typ-frontmatter-unavailable",
          text: "Zum Initialisieren des Editors bitte zuerst einmal eine Notiz \xF6ffnen."
        });
        return null;
      }
      const owner = {
        app,
        // Marker für ensurePropertyMenuPatch() oben: identifiziert Property-
        // Zeilen dieses Plugin-eigenen Editors (nie einer echten Notiz) und
        // liefert Typ/View, die der globale Menü-Patch pro Zeile dynamisch
        // braucht (die Patch-Installation selbst passiert nur einmal, unabhängig
        // davon, welcher Typ dabei gerade offen war).
        fredType: type,
        fredView: view,
        getFile() {
          return null;
        },
        // Nur für Obsidians Hover-Preview bei internen Links innerhalb eines
        // Property-Werts (Event "hover-link") - beliebiger String reicht.
        getHoverSource() {
          return "fred-typ-frontmatter";
        },
        shiftFocusBefore() {
        },
        shiftFocusAfter() {
        },
        // Obsidians Editor ruft dies genau einmal pro abgeschlossener Änderung auf
        // (Rename erst beim Blur des Key-Inputs, siehe handleUpdateKey im
        // gebauten app.js) - jeder Aufruf trägt hier also maximal eine
        // hinzugefügte und/oder entfernte (nicht-leere) Property, nie mehrere
        // gleichzeitig außer bei einem Mehrfach-Löschen. Das macht die
        // Floating-Markierung unten robust nachführbar, ohne Zwischenzustände
        // während des Tippens verfolgen zu müssen.
        saveFrontmatter(frontmatter) {
          stripTypProperty(frontmatter);
          const previous = view.plugin.settings.typeDefaultFrontmatter[type] ?? {};
          const previousKeys = Object.keys(previous).filter((key) => key !== "");
          const currentKeys = Object.keys(frontmatter).filter((key) => key !== "");
          const removedKeys = previousKeys.filter((key) => !currentKeys.includes(key));
          const addedKeys = currentKeys.filter((key) => !previousKeys.includes(key));
          let floating = view.plugin.settings.typeFloatingKeys[type] ?? [];
          if (removedKeys.length === 1 && addedKeys.length === 1) {
            floating = floating.map((key) => key === removedKeys[0] ? addedKeys[0] : key);
          } else {
            if (removedKeys.length > 0) floating = floating.filter((key) => !removedKeys.includes(key));
            if (editor.fredPendingFloatingAdd && addedKeys.length === 1) {
              floating = [...floating, addedKeys[0]];
              editor.fredPendingFloatingAdd = false;
            }
          }
          if (floating.length > 0) view.plugin.settings.typeFloatingKeys[type] = floating;
          else delete view.plugin.settings.typeFloatingKeys[type];
          view.plugin.settings.typeDefaultFrontmatter[type] = frontmatter;
          view.plugin.saveSettings();
          view.plugin.refreshTypColors?.();
        }
      };
      const editor = new EditorClass(app, owner);
      editor.fredPendingFloatingAdd = false;
      containerEl.appendChild(editor.containerEl);
      view.addChild(editor);
      const defaults = view.plugin.settings.typeDefaultFrontmatter[type] ?? {};
      const hadTyp = Object.keys(defaults).some((key) => key.trim().toLowerCase() === TYP_PROPERTY.toLowerCase());
      stripTypProperty(defaults);
      if (hadTyp) view.plugin.saveSettings();
      editor.synchronize(defaults);
      markPlaceholderRows(editor.containerEl, defaults);
      ensurePropertyMenuPatch(app, editor);
      return editor;
    }
    function markPlaceholderRows(containerEl, frontmatter) {
      for (const row of containerEl.querySelectorAll(".metadata-property")) {
        const rowKey = row.getAttribute("data-property-key");
        const actualKey = Object.keys(frontmatter).find((k) => k.toLowerCase() === rowKey?.toLowerCase());
        row.toggleClass("fred-typ-placeholder-value", isPlaceholderToken(frontmatter[actualKey]));
      }
    }
    function addBlankProperty(editor) {
      if (!editor) return;
      const current = editor.serialize();
      if (!current.hasOwnProperty("")) {
        current[""] = null;
        editor.synchronize(current);
      }
      editor.focusKey("");
      ensurePropertyMenuPatch(editor.owner.app, editor);
    }
    module2.exports = { mountTypeFrontmatterEditor, addBlankProperty };
  }
});

// src/type-utils.js
var require_type_utils = __commonJS({
  "src/type-utils.js"(exports2, module2) {
    function normalizeTypeName(raw) {
      return raw.trim().toUpperCase();
    }
    function hexToHue(hex) {
      const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
      if (!match) return null;
      const int = parseInt(match[1], 16);
      const r = (int >> 16 & 255) / 255;
      const g = (int >> 8 & 255) / 255;
      const b = (int & 255) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      if (delta === 0) return null;
      let hue;
      if (max === r) hue = (g - b) / delta % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue *= 60;
      return hue < 0 ? hue + 360 : hue;
    }
    function compareTypes(mode, a, b, counts, typeColors) {
      const [key, dir] = mode.split("-");
      let cmp;
      if (key === "count") {
        cmp = (counts.get(a) ?? 0) - (counts.get(b) ?? 0);
        if (dir === "desc") cmp = -cmp;
      } else if (key === "color") {
        const hueA = hexToHue(typeColors[a] ?? null);
        const hueB = hexToHue(typeColors[b] ?? null);
        if (hueA === null && hueB === null) cmp = 0;
        else if (hueA === null) cmp = 1;
        else if (hueB === null) cmp = -1;
        else {
          cmp = hueA - hueB;
          if (dir === "desc") cmp = -cmp;
        }
      } else {
        cmp = a.localeCompare(b);
        if (dir === "desc") cmp = -cmp;
      }
      return cmp || a.localeCompare(b);
    }
    function sortTypesByMode2(types, mode, counts, typeColors) {
      if (mode === "manual") return [...types];
      return [...types].sort((a, b) => compareTypes(mode, a, b, counts, typeColors));
    }
    module2.exports = { normalizeTypeName, hexToHue, compareTypes, sortTypesByMode: sortTypesByMode2 };
  }
});

// src/typ-index.js
var require_typ_index = __commonJS({
  "src/typ-index.js"(exports2, module2) {
    var { Events, TFile, debounce } = require("obsidian");
    var TYP_PROPERTY = "TYP";
    var SUBTYP_PROPERTY = "SUBTYP";
    var EMPTY_ENTRY = Object.freeze({ typeKey: null, rawType: null, subtypes: Object.freeze([]) });
    var FLUSH_DELAY_MS = 100;
    function rawItem(value) {
      if (value == null) return "";
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    }
    function typeKeyOf(value) {
      if (Array.isArray(value)) {
        const items = value.map(rawItem);
        if (items.every((item) => item.trim() === "")) return null;
        return `[${items.join(", ")}]`;
      }
      const text = rawItem(value);
      return text.trim() === "" ? null : text;
    }
    function subtypeList(value) {
      if (value == null) return [];
      return (Array.isArray(value) ? value : [value]).map((v) => rawItem(v).trim()).filter(Boolean);
    }
    function sameEntry(a, b) {
      return !!a && !!b && a.typeKey === b.typeKey && a.subtypes.length === b.subtypes.length && a.subtypes.every((v, i) => v === b.subtypes[i]);
    }
    var TypIndex2 = class extends Events {
      constructor(plugin) {
        super();
        this.plugin = plugin;
        this.app = plugin.app;
        this.entries = /* @__PURE__ */ new Map();
        this.built = false;
        this.aggregates = null;
        this.pendingPaths = /* @__PURE__ */ new Set();
        this.flush = debounce(() => {
          const paths = this.pendingPaths;
          this.pendingPaths = /* @__PURE__ */ new Set();
          this.trigger("change", paths);
        }, FLUSH_DELAY_MS);
      }
      register() {
        const { plugin, app } = this;
        plugin.registerEvent(app.metadataCache.on("changed", (file) => this.update(file)));
        plugin.registerEvent(app.metadataCache.on("deleted", (file) => this.remove(file.path)));
        plugin.registerEvent(app.vault.on("rename", (file, oldPath) => this.rename(file, oldPath)));
        plugin.registerEvent(app.vault.on("config-changed", () => this.aggregates = null));
        const resolvedRef = app.metadataCache.on("resolved", () => {
          app.metadataCache.offref(resolvedRef);
          this.rebuild();
        });
        plugin.registerEvent(resolvedRef);
        plugin.register(() => this.flush.cancel());
      }
      read(file) {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const rawType = frontmatter?.[TYP_PROPERTY] ?? null;
        return { typeKey: typeKeyOf(rawType), rawType, subtypes: subtypeList(frontmatter?.[SUBTYP_PROPERTY]) };
      }
      ensureBuilt() {
        if (!this.built) this.rebuild();
      }
      rebuild() {
        const previous = this.entries;
        const wasBuilt = this.built;
        this.entries = /* @__PURE__ */ new Map();
        for (const file of this.app.vault.getMarkdownFiles()) this.entries.set(file.path, this.read(file));
        this.built = true;
        this.aggregates = null;
        if (!wasBuilt) return;
        for (const [path, entry] of this.entries) {
          if (!sameEntry(previous.get(path), entry)) this.pendingPaths.add(path);
        }
        for (const path of previous.keys()) {
          if (!this.entries.has(path)) this.pendingPaths.add(path);
        }
        if (this.pendingPaths.size > 0) this.flush();
      }
      markChanged(path) {
        this.aggregates = null;
        this.pendingPaths.add(path);
        this.flush();
      }
      update(file) {
        if (!this.built || !(file instanceof TFile) || file.extension !== "md") return;
        const next = this.read(file);
        if (sameEntry(this.entries.get(file.path), next)) return;
        this.entries.set(file.path, next);
        this.markChanged(file.path);
      }
      remove(path) {
        if (!this.built || !this.entries.delete(path)) return;
        this.markChanged(path);
      }
      rename(file, oldPath) {
        if (!this.built) return;
        const entry = this.entries.get(oldPath);
        if (entry) {
          this.entries.delete(oldPath);
          this.markChanged(oldPath);
        }
        if (file instanceof TFile && file.extension === "md") {
          this.entries.set(file.path, entry ?? this.read(file));
          this.markChanged(file.path);
        }
      }
      entryFor(file) {
        if (!file) return EMPTY_ENTRY;
        this.ensureBuilt();
        return this.entries.get(file.path) ?? EMPTY_ENTRY;
      }
      // TYP-Schlüssel (siehe typeKeyOf) oder null. Für einen sauberen Wert ist das
      // schlicht der TYP-Name selbst.
      typeOf(file) {
        return this.entryFor(file).typeKey;
      }
      // Ein tatsächlicher Frontmatter-Wert zu einem Schlüssel - für Anzeige, Suche
      // und Normalisierung unregistrierter Einträge (alle Notizen eines Schlüssels
      // haben per Definition dieselbe Rohform).
      rawValueOf(typeKey) {
        return this.aggregate().rawByKey.get(typeKey);
      }
      // Sauberer Wert = Einzelwert ohne Leerzeichen am Rand. Klein geschriebene
      // Werte zählen hier als sauber (sie sind ein gültiger, nur noch nicht
      // registrierter TYP-Name), Listen und Randleerzeichen nicht.
      isCleanKey(typeKey) {
        const raw = this.rawValueOf(typeKey);
        return raw !== void 0 && !Array.isArray(raw) && typeKey === typeKey.trim();
      }
      // Dateien mit genau diesem TYP-Schlüssel, unter Beachtung der
      // "Ignorierte Notizen berücksichtigen"-Einstellung.
      filesWithType(typeKey) {
        this.ensureBuilt();
        const includeIgnored = !!this.plugin.settings.includeIgnoredFiles;
        const files = [];
        for (const [path, entry] of this.entries) {
          if (entry.typeKey !== typeKey) continue;
          if (!includeIgnored && this.app.metadataCache.isUserIgnored(path)) continue;
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) files.push(file);
        }
        return files;
      }
      // Respektiert standardmäßig Obsidians eigene "Excluded files"-Liste - dort
      // tragen auch Plugins wie Hide Folders ausgeblendete Ordner ein. Über die
      // Einstellung "Ignorierte Notizen berücksichtigen" abschaltbar.
      //
      // Mehrfach-SUBTYP (Array-Wert) zählt für jeden seiner SUBTYP-Buckets. Eine
      // Notiz ohne TYP hat keinen SUBTYP-Kontext.
      aggregate() {
        this.ensureBuilt();
        const includeIgnored = !!this.plugin.settings.includeIgnoredFiles;
        if (this.aggregates?.includeIgnored === includeIgnored) return this.aggregates;
        const counts = /* @__PURE__ */ new Map();
        const rawByKey = /* @__PURE__ */ new Map();
        const subtypesByType = /* @__PURE__ */ new Map();
        let noType = 0;
        for (const [path, { typeKey, rawType, subtypes }] of this.entries) {
          if (!includeIgnored && this.app.metadataCache.isUserIgnored(path)) continue;
          if (typeKey === null) {
            noType++;
            continue;
          }
          counts.set(typeKey, (counts.get(typeKey) ?? 0) + 1);
          if (!rawByKey.has(typeKey)) rawByKey.set(typeKey, rawType);
          let bucket = subtypesByType.get(typeKey);
          if (!bucket) {
            bucket = { counts: /* @__PURE__ */ new Map(), noSubtype: 0 };
            subtypesByType.set(typeKey, bucket);
          }
          if (subtypes.length === 0) bucket.noSubtype++;
          else for (const sub of subtypes) bucket.counts.set(sub, (bucket.counts.get(sub) ?? 0) + 1);
        }
        this.aggregates = { includeIgnored, counts, noType, rawByKey, subtypesByType };
        return this.aggregates;
      }
      // Zwischengespeichert - die gelieferten Maps nicht verändern.
      typeCounts() {
        const { counts, noType } = this.aggregate();
        return { counts, noType };
      }
      // TYP -> { counts: Map(SUBTYP -> Anzahl), noSubtype }. Zwischengespeichert -
      // nicht verändern.
      subtypeCounts() {
        return this.aggregate().subtypesByType;
      }
    };
    module2.exports = { TypIndex: TypIndex2, typeKeyOf, TYP_PROPERTY };
  }
});

// src/subtyp-view.js
var require_subtyp_view = __commonJS({
  "src/subtyp-view.js"(exports2, module2) {
    var { Notice, setIcon } = require("obsidian");
    var { normalizeTypeName, compareTypes } = require_type_utils();
    var { typeKeyOf, TYP_PROPERTY } = require_typ_index();
    var SUBTYP_PROPERTY = "SUBTYP";
    var SORT_MODE = "count-desc";
    function getSubtypeList(plugin, typ) {
      return plugin.settings.subtypesByType?.[typ] ?? [];
    }
    function getSubtypeDescription(plugin, typ, subtyp) {
      return plugin.settings.subtypeDescriptions?.[typ]?.[subtyp] ?? "";
    }
    function ensureSubtypesByType(plugin) {
      if (!plugin.settings.subtypesByType) plugin.settings.subtypesByType = {};
      return plugin.settings.subtypesByType;
    }
    function ensureSubtypeList(plugin, typ) {
      const byType = ensureSubtypesByType(plugin);
      if (!byType[typ]) byType[typ] = [];
      return byType[typ];
    }
    function ensureSubtypeDescriptions(plugin, typ) {
      if (!plugin.settings.subtypeDescriptions) plugin.settings.subtypeDescriptions = {};
      if (!plugin.settings.subtypeDescriptions[typ]) plugin.settings.subtypeDescriptions[typ] = {};
      return plugin.settings.subtypeDescriptions[typ];
    }
    async function renameSubtypeInNotes(app, typ, oldValue, newValue, { includeIgnored = false } = {}) {
      let changed = 0;
      for (const file of app.vault.getMarkdownFiles()) {
        if (!includeIgnored && app.metadataCache.isUserIgnored(file.path)) continue;
        const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
        if (typeKeyOf(frontmatter?.[TYP_PROPERTY]) !== typ) continue;
        const subValue = frontmatter?.[SUBTYP_PROPERTY];
        const subMatches = Array.isArray(subValue) ? subValue.includes(oldValue) : subValue === oldValue;
        if (!subMatches) continue;
        await app.fileManager.processFrontMatter(file, (fm) => {
          const current = fm[SUBTYP_PROPERTY];
          if (Array.isArray(current)) {
            fm[SUBTYP_PROPERTY] = [...new Set(current.map((v) => v === oldValue ? newValue : v))];
          } else if (current === oldValue) {
            fm[SUBTYP_PROPERTY] = newValue;
          }
        });
        changed++;
      }
      return changed;
    }
    function openSubtypSearch(app, typ, subtyp) {
      const globalSearch = app.internalPlugins.getPluginById("global-search");
      if (!globalSearch) return;
      const typClause = `["${TYP_PROPERTY}":"${typ}"]`;
      const query = subtyp === null ? `${typClause} -["${SUBTYP_PROPERTY}"] file:.md` : `${typClause} ["${SUBTYP_PROPERTY}":"${subtyp}"]`;
      globalSearch.instance.openGlobalSearch(query);
    }
    var SubtypPane = class {
      constructor(typView, containerEl) {
        this.typView = typView;
        this.plugin = typView.plugin;
        this.app = typView.app;
        this.containerEl = containerEl;
        this.activeType = null;
        this.isEditing = false;
      }
      render(activeType) {
        this.activeType = activeType;
        this.isEditing = false;
        const { containerEl } = this;
        containerEl.empty();
        const header = containerEl.createDiv({ cls: "nav-header" });
        header.createDiv({ cls: "fred-typ-subtyp-title", text: "SUBTYP" });
        const buttonsContainer = header.createDiv({ cls: "nav-buttons-container" });
        const addBtn = buttonsContainer.createDiv({
          cls: "clickable-icon nav-action-button",
          attr: {
            "aria-label": activeType ? "Neuen Subtyp hinzuf\xFCgen" : "Erst einen TYP \xF6ffnen, um Subtypen anzulegen"
          }
        });
        setIcon(addBtn, "plus");
        if (activeType) addBtn.addEventListener("click", () => this.startAdd());
        else addBtn.addClass("is-disabled");
        this.listEl = containerEl.createDiv({ cls: "fred-typ-list nav-files-container" });
        this.separatorEl = null;
        const byType = this.plugin.typIndex.subtypeCounts();
        if (activeType) this.renderFilteredList(activeType, byType.get(activeType) ?? { counts: /* @__PURE__ */ new Map(), noSubtype: 0 });
        else this.renderUnfilteredList(byType);
      }
      renderFilteredList(typ, bucket) {
        const registered = getSubtypeList(this.plugin, typ);
        const byCurrentOrder = (a, b) => compareTypes(SORT_MODE, a, b, bucket.counts, {});
        for (const subtyp of [...registered].sort(byCurrentOrder)) {
          this.renderRegisteredRow(typ, subtyp, bucket.counts.get(subtyp) ?? 0);
        }
        const unregistered = [...bucket.counts.keys()].filter((s) => !registered.includes(s)).sort(byCurrentOrder);
        const hasNoSubtype = bucket.noSubtype > 0;
        if (unregistered.length > 0 || hasNoSubtype) {
          this.separatorEl = this.listEl.createDiv({ cls: "fred-typ-separator" });
          for (const subtyp of unregistered) this.renderUnregisteredRow(typ, subtyp, bucket.counts.get(subtyp) ?? 0);
          if (hasNoSubtype) this.renderNoSubtypeRow(typ, bucket.noSubtype);
        }
      }
      // Ungefiltert (TYP-Liste offen, kein activeType): flache Übersicht aller
      // registrierten bzw. in Notizen vorkommenden (TYP, SUBTYP)-Paare, jede Zeile
      // zusätzlich mit einem TYP-Badge - anders als in renderFilteredList lässt
      // sich der zugehörige TYP hier nicht aus dem Kontext erschließen.
      renderUnfilteredList(byType) {
        const rows = [];
        const allTypes = /* @__PURE__ */ new Set([...Object.keys(this.plugin.settings.subtypesByType ?? {}), ...byType.keys()]);
        for (const typ of allTypes) {
          const bucket = byType.get(typ) ?? { counts: /* @__PURE__ */ new Map(), noSubtype: 0 };
          const registered = getSubtypeList(this.plugin, typ);
          for (const subtyp of registered) rows.push({ typ, subtyp, count: bucket.counts.get(subtyp) ?? 0, registered: true });
          for (const subtyp of bucket.counts.keys()) {
            if (!registered.includes(subtyp)) rows.push({ typ, subtyp, count: bucket.counts.get(subtyp) ?? 0, registered: false });
          }
        }
        rows.sort((a, b) => b.count - a.count || a.subtyp.localeCompare(b.subtyp) || a.typ.localeCompare(b.typ));
        for (const row of rows) {
          if (row.registered) this.renderRegisteredRow(row.typ, row.subtyp, row.count, { showType: true });
          else this.renderUnregisteredRow(row.typ, row.subtyp, row.count, { showType: true });
        }
      }
      renderRegisteredRow(typ, subtyp, count, { showType = false } = {}) {
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable" });
        self.createDiv({ cls: "tree-item-inner", text: subtyp });
        if (showType) {
          self.createSpan({ cls: "fred-typ-subtyp-type-badge", text: typ });
        } else {
          const descInput = self.createEl("input", { type: "text", cls: "fred-typ-list-description-input" });
          descInput.value = getSubtypeDescription(this.plugin, typ, subtyp);
          descInput.addEventListener("click", (event) => event.stopPropagation());
          descInput.addEventListener("change", async () => {
            const value = descInput.value.trim();
            const descriptions = ensureSubtypeDescriptions(this.plugin, typ);
            if (value) descriptions[subtyp] = value;
            else delete descriptions[subtyp];
            await this.plugin.saveSettings();
          });
        }
        this.renderCountFlair(self, count);
        self.addEventListener("click", () => openSubtypSearch(this.app, typ, subtyp));
        self.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openSubtypSearch(this.app, typ, subtyp);
        });
      }
      renderUnregisteredRow(typ, subtyp, count, { showType = false } = {}) {
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable fred-typ-unregistered" });
        self.createDiv({ cls: "tree-item-inner", text: subtyp });
        if (showType) self.createSpan({ cls: "fred-typ-subtyp-type-badge", text: typ });
        this.renderCountFlair(self, count);
        self.addEventListener("click", () => this.registerSubtype(typ, subtyp));
        self.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openSubtypSearch(this.app, typ, subtyp);
        });
      }
      renderNoSubtypeRow(typ, count) {
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable fred-typ-unregistered" });
        self.createDiv({ cls: "tree-item-inner", text: "[KEIN SUBTYP]" });
        this.renderCountFlair(self, count);
        self.addEventListener("click", () => openSubtypSearch(this.app, typ, null));
        self.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openSubtypSearch(this.app, typ, null);
        });
      }
      renderCountFlair(self, count) {
        const flairOuter = self.createDiv({ cls: "tree-item-flair-outer" });
        flairOuter.createSpan({ cls: "tree-item-flair", text: String(count) });
      }
      // subtyp kommt 1:1 aus einem tatsächlichen Frontmatter-Wert (siehe
      // renderUnregisteredRow) - könnte also klein geschrieben sein. SUBTYPen
      // werden aber immer groß geschrieben (siehe normalizeTypeName) - registriert
      // wird deshalb die normalisierte Form, und die betroffenen Notizen (mit
      // passendem TYP) werden gleich mit umgeschrieben.
      async registerSubtype(typ, rawValue) {
        const normalized = normalizeTypeName(rawValue);
        const list = ensureSubtypeList(this.plugin, typ);
        if (!list.includes(normalized)) list.push(normalized);
        let renamed = 0;
        if (normalized !== rawValue) {
          renamed = await renameSubtypeInNotes(this.app, typ, rawValue, normalized, {
            includeIgnored: this.plugin.settings.includeIgnoredFiles
          });
        }
        await this.plugin.saveSettings();
        this.render(this.activeType);
        if (renamed > 0) new Notice(`SUBTYP ${normalized} registriert, ${renamed} Notiz(en) angepasst.`);
      }
      // Neues, leeres Tree-Item anlegen und sofort in den Editier-Modus versetzen -
      // wie startAdd() in typ-view.js. Nur verfügbar, während oben ein TYP
      // geöffnet ist (siehe render()) - ein neuer Subtyp braucht immer einen TYP.
      startAdd() {
        if (this.isEditing || !this.activeType) return;
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        if (this.separatorEl) this.listEl.insertBefore(treeItem, this.separatorEl);
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable" });
        const inner = self.createDiv({ cls: "tree-item-inner" });
        this.startEditing(self, inner);
      }
      startEditing(self, inner) {
        if (this.isEditing) return;
        this.isEditing = true;
        const typ = this.activeType;
        self.addClass("is-being-renamed");
        inner.setAttribute("contenteditable", "true");
        inner.setAttribute("spellcheck", "false");
        inner.focus();
        const range = inner.doc.createRange();
        range.selectNodeContents(inner);
        const selection = inner.win.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        let done = false;
        const finish = async (commit) => {
          if (done) return;
          done = true;
          this.isEditing = false;
          const value = normalizeTypeName(inner.textContent);
          if (commit && value) {
            const list = ensureSubtypeList(this.plugin, typ);
            if (!list.some((s) => s.toLowerCase() === value.toLowerCase())) {
              list.push(value);
              await this.plugin.saveSettings();
            }
          }
          this.render(typ);
        };
        inner.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        });
        inner.addEventListener("blur", () => finish(true));
      }
    };
    module2.exports = { SubtypPane, SUBTYP_PROPERTY };
  }
});

// src/typ-view.js
var require_typ_view = __commonJS({
  "src/typ-view.js"(exports2, module2) {
    var { ItemView, Menu, Modal, Notice, setIcon, debounce } = require("obsidian");
    var { mountTypeFrontmatterEditor, addBlankProperty } = require_type_frontmatter_editor();
    var { FRONTMATTER_PLACEHOLDERS, DYNAMIC_PLACEHOLDER_INFO } = require_frontmatter_placeholders();
    var { normalizeTypeName, compareTypes, sortTypesByMode: sortTypesByMode2 } = require_type_utils();
    var { SubtypPane } = require_subtyp_view();
    var { typeKeyOf, TYP_PROPERTY } = require_typ_index();
    var VIEW_TYPE_TYP = "fred-typ-view";
    var DEFAULT_TYPE_COLOR = "#888888";
    var DEFAULT_SORT_ORDER2 = "count-desc";
    var DEFAULT_SUBTYP_PANE_RATIO = 0.5;
    var SORT_OPTIONS = [
      // Nutzt (anders als die übrigen Modi) keinen eigenen Vergleich, sondern die
      // Reihenfolge von plugin.settings.types selbst als Speicherort - siehe
      // render() und renderRegisteredItem() für das per Drag & Drop verschiebbare
      // Rendern, das genau darauf aufbaut. Bewusst als erste Option (siehe
      // showSortMenu) - eigene, oberste Gruppe im Menü statt einsortiert zwischen
      // die eigentlichen Sortierkriterien.
      { mode: "manual", title: "Manuell (Drag & Drop)" },
      { mode: "count-desc", title: "H\xE4ufigkeit (absteigend)" },
      { mode: "count-asc", title: "H\xE4ufigkeit (aufsteigend)" },
      { mode: "name-asc", title: "Name (A bis Z)" },
      { mode: "name-desc", title: "Name (Z bis A)" },
      { mode: "color-asc", title: "Farbe (Rot \u2192 Violett)" },
      { mode: "color-desc", title: "Farbe (Violett \u2192 Rot)" }
    ];
    async function renameTypeInNotes(plugin, oldKey, newValue) {
      let changed = 0;
      for (const file of plugin.typIndex.filesWithType(oldKey)) {
        let matched = false;
        await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
          if (typeKeyOf(frontmatter[TYP_PROPERTY]) !== oldKey) return;
          frontmatter[TYP_PROPERTY] = newValue;
          matched = true;
        });
        if (matched) changed++;
      }
      return changed;
    }
    function normalizeRawType(raw) {
      if (Array.isArray(raw)) {
        return raw.map((v) => normalizeTypeName(String(v ?? ""))).filter(Boolean).join(", ");
      }
      return normalizeTypeName(String(raw));
    }
    function displayTypeKey(typeKey) {
      return typeKey !== typeKey.trim() ? `"${typeKey}"` : typeKey;
    }
    function appendTypeName(parentEl, plugin, type, color) {
      if (plugin.settings.colorViews.typList) {
        parentEl.createSpan({ cls: "fred-typ-inline-name", text: type }).style.color = color;
      } else {
        parentEl.createSpan({ cls: "fred-typ-inline-dot" }).style.backgroundColor = color;
        parentEl.createSpan({ cls: "fred-typ-inline-name", text: type });
      }
    }
    var ConfirmDeleteTypeModal = class extends Modal {
      constructor(plugin, type, onConfirm) {
        super(plugin.app);
        this.plugin = plugin;
        this.type = type;
        this.onConfirm = onConfirm;
      }
      onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass("fred-confirm-delete-modal");
        const p = contentEl.createEl("p");
        p.appendText("Typ ");
        appendTypeName(p, this.plugin, this.type, this.plugin.settings.typeColors[this.type] ?? DEFAULT_TYPE_COLOR);
        p.appendText(" wirklich l\xF6schen?");
        const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
        buttonRow.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());
        const confirmBtn = buttonRow.createEl("button", { cls: "mod-warning", text: "L\xF6schen" });
        confirmBtn.addEventListener("click", () => {
          this.close();
          this.onConfirm();
        });
      }
      onClose() {
        this.contentEl.empty();
      }
    };
    var ConfirmRenameTypeModal = class extends Modal {
      constructor(plugin, oldType, newType, affectedCount, onConfirm, onCancel) {
        super(plugin.app);
        this.plugin = plugin;
        this.oldType = oldType;
        this.newType = newType;
        this.affectedCount = affectedCount;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
        this.confirmed = false;
      }
      onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass("fred-confirm-delete-modal");
        const color = this.plugin.settings.typeColors[this.oldType] ?? DEFAULT_TYPE_COLOR;
        const p = contentEl.createEl("p");
        p.appendText("TYP ");
        appendTypeName(p, this.plugin, this.oldType, color);
        p.appendText(" in ");
        appendTypeName(p, this.plugin, this.newType, color);
        p.appendText(` umbenennen und ${this.affectedCount} Notiz(en) entsprechend anpassen?`);
        const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
        buttonRow.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());
        const confirmBtn = buttonRow.createEl("button", { cls: "mod-cta", text: "Umbenennen" });
        confirmBtn.addEventListener("click", () => {
          this.confirmed = true;
          this.close();
          this.onConfirm();
        });
      }
      // Deckt sowohl "Abbrechen"-Klick als auch Escape/Klick daneben ab - analog
      // zum Cancel-Handling in TypPickerModal.
      onClose() {
        this.contentEl.empty();
        if (!this.confirmed) this.onCancel?.();
      }
    };
    var ConfirmMergeTypeModal = class extends ConfirmRenameTypeModal {
      onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass("fred-confirm-delete-modal");
        const settings = this.plugin.settings;
        const p = contentEl.createEl("p");
        p.appendText("TYP ");
        appendTypeName(p, this.plugin, this.newType, settings.typeColors[this.newType] ?? DEFAULT_TYPE_COLOR);
        p.appendText(" existiert bereits. ");
        appendTypeName(p, this.plugin, this.oldType, settings.typeColors[this.oldType] ?? DEFAULT_TYPE_COLOR);
        p.appendText(" damit zusammenlegen?");
        contentEl.createEl("p", {
          text: `${this.affectedCount} Notiz(en) werden auf ${this.newType} umgestellt. Farbe, Beschreibung und Standard-Frontmatter von ${this.oldType} entfallen, seine SUBTYPen werden \xFCbernommen.`
        });
        const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
        buttonRow.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());
        const confirmBtn = buttonRow.createEl("button", { cls: "mod-warning", text: "Zusammenlegen" });
        confirmBtn.addEventListener("click", () => {
          this.confirmed = true;
          this.close();
          this.onConfirm();
        });
      }
    };
    var TypView = class extends ItemView {
      constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
      }
      getViewType() {
        return VIEW_TYPE_TYP;
      }
      getDisplayText() {
        return "TYP";
      }
      getIcon() {
        return "shapes";
      }
      async onOpen() {
        this.isEditing = false;
        this.selectedType = null;
        this.frontmatterEditor = null;
        this.contentEl.empty();
        this.contentEl.addClass("fred-typ-view");
        this.buildSplitPanes();
        this.registerDomEvent(this.contentEl, "keydown", (event) => {
          if (event.key === "Escape" && this.selectedType !== null) this.closeTypeSettings();
        });
        this.render();
      }
      async onClose() {
      }
      // Teilt den View-Content in zwei übereinander liegende, unabhängig
      // scrollbare Bereiche: oben die bestehende TYP-Liste/-Detailansicht (siehe
      // render()/renderTypeSettings(), rendern jetzt in paneTopEl statt direkt in
      // contentEl), unten die neue, immer sichtbare SUBTYP-Liste (siehe
      // SubtypPane in subtyp-view.js) - bleibt dadurch auch offen, während oben
      // gerade eine TYP-Detailansicht steht. Größe per Ziehen am Splitter
      // verstellbar, das Verhältnis wird in den Plugin-Settings gemerkt.
      buildSplitPanes() {
        this.splitEl = this.contentEl.createDiv({ cls: "fred-typ-split" });
        this.paneTopEl = this.splitEl.createDiv({ cls: "fred-typ-pane fred-typ-pane-top" });
        this.splitterEl = this.splitEl.createDiv({
          cls: "fred-typ-splitter",
          attr: { "aria-label": "Gr\xF6\xDFe der SUBTYP-Liste anpassen" }
        });
        this.paneBottomEl = this.splitEl.createDiv({ cls: "fred-typ-pane fred-typ-pane-bottom" });
        this.applyPaneRatio(this.plugin.settings.typSubtypPaneRatio ?? DEFAULT_SUBTYP_PANE_RATIO);
        this.registerSplitterDrag();
        this.subtypPane = new SubtypPane(this, this.paneBottomEl);
      }
      applyPaneRatio(ratio) {
        const clamped = Math.min(0.85, Math.max(0.15, ratio));
        this.paneBottomEl.style.flexBasis = `${clamped * 100}%`;
      }
      // Kein Obsidian-eigenes Splitter-Widget verfügbar (anders als z. B. zwischen
      // Sidebar und Editor) - daher ein schlichter eigener Drag-Handler direkt auf
      // pointermove/pointerup, nur für die Dauer eines einzelnen Drags registriert
      // (statt über registerDomEvent, das erst beim Schließen der View wieder
      // abmeldet) und deshalb im eigenen pointerup-Handler selbst wieder entfernt.
      registerSplitterDrag() {
        this.registerDomEvent(this.splitterEl, "pointerdown", (event) => {
          event.preventDefault();
          this.splitterEl.addClass("is-dragging");
          const startY = event.clientY;
          const totalHeight = this.splitEl.getBoundingClientRect().height;
          const startBottomHeight = this.paneBottomEl.getBoundingClientRect().height;
          const onMove = (moveEvent) => {
            if (totalHeight <= 0) return;
            const bottomHeight = startBottomHeight + (startY - moveEvent.clientY);
            this.applyPaneRatio(bottomHeight / totalHeight);
          };
          const onUp = async () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            this.splitterEl.removeClass("is-dragging");
            const ratio = totalHeight > 0 ? this.paneBottomEl.getBoundingClientRect().height / totalHeight : DEFAULT_SUBTYP_PANE_RATIO;
            this.plugin.settings.typSubtypPaneRatio = Math.min(0.85, Math.max(0.15, ratio));
            await this.plugin.saveSettings();
          };
          document.addEventListener("pointermove", onMove);
          document.addEventListener("pointerup", onUp);
        });
      }
      openSearch(type) {
        const globalSearch = this.plugin.app.internalPlugins.getPluginById("global-search");
        if (!globalSearch) return;
        const raw = type === null ? void 0 : this.plugin.typIndex.rawValueOf(type);
        const query = type === null ? `-["${TYP_PROPERTY}"] file:.md` : Array.isArray(raw) ? raw.map((v) => `["${TYP_PROPERTY}":"${String(v ?? "").trim()}"]`).join(" ") : `["${TYP_PROPERTY}":"${type}"]`;
        globalSearch.instance.openGlobalSearch(query);
      }
      // typeKey kommt 1:1 aus den tatsächlichen Frontmatter-Werten (siehe
      // unregisteredRows in render() und typeKeyOf in typ-index.js) - kann also
      // klein geschrieben sein, Randleerzeichen tragen oder eine Liste sein. TYPen
      // werden aber immer als sauberer Einzelwert in Großbuchstaben geführt -
      // registriert wird deshalb die bereinigte Form (siehe normalizeRawType), und
      // die betroffenen Notizen werden gleich mit umgeschrieben, damit sie nicht
      // weiterhin als "nicht registriert" auftauchen.
      async registerType(typeKey) {
        const raw = this.plugin.typIndex.rawValueOf(typeKey);
        const normalized = normalizeRawType(raw === void 0 ? typeKey : raw);
        if (!normalized) return;
        if (!this.plugin.settings.types.includes(normalized)) {
          this.plugin.settings.types.push(normalized);
        }
        let renamed = 0;
        if (normalized !== typeKey) {
          renamed = await renameTypeInNotes(this.plugin, typeKey, normalized);
        }
        await this.plugin.saveSettings();
        this.render();
        this.plugin.refreshTypColors?.();
        if (renamed > 0) {
          new Notice(`TYP ${normalized} registriert, ${renamed} Notiz(en) angepasst.`);
        }
      }
      // Neues, leeres Tree-Item anlegen und sofort in den Editier-Modus versetzen -
      // wie bei Obsidians eigenen Views (z. B. neue Bookmark-Gruppe).
      startAdd() {
        if (this.isEditing) return;
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        if (this.separatorEl) this.listEl.insertBefore(treeItem, this.separatorEl);
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable" });
        const inner = self.createDiv({ cls: "tree-item-inner" });
        this.startEditing(null, self, inner);
      }
      // Wie Obsidians eigene Tree-Items: kein zusätzliches Input-Element, sondern
      // das bestehende Text-Element wird selbst editierbar (contenteditable).
      // type === null → neuer Eintrag, sonst Umbenennen des übergebenen Typs.
      startEditing(type, self, inner) {
        if (this.isEditing) return;
        this.isEditing = true;
        self.addClass("is-being-renamed");
        inner.setAttribute("contenteditable", "true");
        inner.setAttribute("spellcheck", "false");
        inner.focus();
        const range = inner.doc.createRange();
        range.selectNodeContents(inner);
        const selection = inner.win.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        let done = false;
        const finish = async (commit) => {
          if (done) return;
          done = true;
          this.isEditing = false;
          const value = normalizeTypeName(inner.textContent);
          if (commit && value && value !== type) {
            const exists = this.plugin.settings.types.some(
              (t) => t.toLowerCase() === value.toLowerCase() && t !== type
            );
            if (!exists) {
              if (type === null) {
                this.plugin.settings.types.push(value);
              } else {
                const idx = this.plugin.settings.types.indexOf(type);
                if (idx !== -1) this.plugin.settings.types[idx] = value;
                if (this.plugin.settings.typeColors[type] !== void 0) {
                  this.plugin.settings.typeColors[value] = this.plugin.settings.typeColors[type];
                  delete this.plugin.settings.typeColors[type];
                }
                if (this.plugin.settings.typeDescriptions[type] !== void 0) {
                  this.plugin.settings.typeDescriptions[value] = this.plugin.settings.typeDescriptions[type];
                  delete this.plugin.settings.typeDescriptions[type];
                }
                if (this.plugin.settings.typeDefaultFrontmatter[type] !== void 0) {
                  this.plugin.settings.typeDefaultFrontmatter[value] = this.plugin.settings.typeDefaultFrontmatter[type];
                  delete this.plugin.settings.typeDefaultFrontmatter[type];
                }
                if (this.plugin.settings.typeFloatingKeys[type] !== void 0) {
                  this.plugin.settings.typeFloatingKeys[value] = this.plugin.settings.typeFloatingKeys[type];
                  delete this.plugin.settings.typeFloatingKeys[type];
                }
                if (this.ensureTypeManual()[type] !== void 0) {
                  this.plugin.settings.typeManual[value] = this.plugin.settings.typeManual[type];
                  delete this.plugin.settings.typeManual[type];
                }
              }
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
            }
          }
          this.render();
        };
        inner.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        });
        inner.addEventListener("blur", () => finish(true));
      }
      openTypeSettings(type) {
        this.selectedType = type;
        this.render();
      }
      closeTypeSettings() {
        this.selectedType = null;
        this.render();
      }
      // Wird als Component-Child geladen (siehe mountTypeFrontmatterEditor) und muss
      // deshalb vor jedem Neuaufbau der Detail-Ansicht explizit entladen werden -
      // contentEl.empty() allein würde nur die DOM-Elemente entfernen, nicht aber
      // den darauf registrierten metadataTypeManager-Listener der Editor-Instanz.
      destroyFrontmatterEditor() {
        if (this.frontmatterEditor) {
          this.removeChild(this.frontmatterEditor);
          this.frontmatterEditor = null;
        }
      }
      render() {
        if (this._rendering) return;
        this._rendering = true;
        try {
          this.destroyFrontmatterEditor();
          if (this.selectedType !== null) {
            this.renderTypeSettings(this.selectedType);
            return;
          }
          const contentEl = this.paneTopEl;
          contentEl.empty();
          const { counts, noType } = this.plugin.typIndex.typeCounts();
          const registered = this.plugin.settings.types;
          const typeColors = this.plugin.settings.typeColors;
          const sortOrder = this.plugin.settings.typSortOrder ?? DEFAULT_SORT_ORDER2;
          const isManualSort = sortOrder === "manual";
          const byCurrentOrder = (a, b) => compareTypes(sortOrder, a, b, counts, typeColors);
          this.renderListHeader(contentEl);
          const unregisteredRows = [...counts.keys()].filter((type) => !registered.includes(type)).sort(byCurrentOrder).map((type) => ({ type, count: counts.get(type) ?? 0 }));
          if (noType > 0) {
            unregisteredRows.push({ type: null, count: noType });
          }
          const listCls = "fred-typ-list nav-files-container" + (this.plugin.settings.typListDescriptionEnabled ? "" : " fred-typ-list-no-description");
          this.listEl = contentEl.createDiv({ cls: listCls });
          this.separatorEl = null;
          const registeredOrder = sortTypesByMode2(registered, sortOrder, counts, typeColors);
          registeredOrder.forEach((type, index) => {
            this.renderRegisteredItem(type, counts.get(type) ?? 0, { draggable: isManualSort, index });
          });
          if (unregisteredRows.length > 0) {
            this.separatorEl = this.listEl.createDiv({ cls: "fred-typ-separator" });
            for (const row of unregisteredRows) {
              if (row.type === null) this.renderNoTypeItem(row.count);
              else this.renderUnregisteredItem(row.type, row.count);
            }
          }
        } finally {
          this._rendering = false;
          this.subtypPane?.render(this.selectedType);
        }
      }
      // Wie der "Change sort order"-Button in Obsidians Tags- bzw. All-Properties-View.
      renderListHeader(contentEl) {
        const header = contentEl.createDiv({ cls: "nav-header" });
        const buttonsContainer = header.createDiv({ cls: "nav-buttons-container" });
        const addBtn = buttonsContainer.createDiv({
          cls: "clickable-icon nav-action-button",
          attr: { "aria-label": "Neuen Typ hinzuf\xFCgen" }
        });
        setIcon(addBtn, "plus");
        addBtn.addEventListener("click", () => this.startAdd());
        const sortBtn = buttonsContainer.createDiv({
          cls: "clickable-icon nav-action-button",
          attr: { "aria-label": "Sortierreihenfolge \xE4ndern" }
        });
        setIcon(sortBtn, "lucide-sort-asc");
        sortBtn.addEventListener("click", (event) => this.showSortMenu(event));
      }
      showSortMenu(event) {
        const current = this.plugin.settings.typSortOrder ?? DEFAULT_SORT_ORDER2;
        const menu = new Menu();
        const addGroup = (start, end) => {
          for (let i = start; i < end; i++) {
            const { mode, title } = SORT_OPTIONS[i];
            menu.addItem(
              (item) => item.setTitle(title).setChecked(current === mode).onClick(async () => {
                this.plugin.settings.typSortOrder = mode;
                await this.plugin.saveSettings();
                this.render();
              })
            );
          }
        };
        addGroup(0, 1);
        menu.addSeparator();
        addGroup(1, 3);
        menu.addSeparator();
        addGroup(3, 5);
        menu.addSeparator();
        addGroup(5, 7);
        menu.showAtMouseEvent(event);
      }
      renderNoTypeItem(count) {
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable fred-typ-unregistered" });
        self.createDiv({ cls: "tree-item-inner", text: "[KEIN TYP]" });
        this.renderCountFlair(self, count);
        self.addEventListener("click", () => this.openSearch(null));
        self.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openSearch(null);
        });
      }
      // Chromiums input[type=color] hat einen eigenen Mindest-Swatch, der sich nicht
      // unter Textgröße skalieren lässt - daher nur als unsichtbaren Picker-Trigger
      // über dem frei skalierbaren Punkt platzieren.
      renderColorPicker(parent, type, onChange, { showReset = false } = {}) {
        const currentColor = this.plugin.settings.typeColors[type] ?? DEFAULT_TYPE_COLOR;
        const colorWrap = parent.createDiv({ cls: "fred-typ-color-wrap" });
        const colorDot = colorWrap.createDiv({ cls: "fred-typ-color-dot" });
        colorDot.style.backgroundColor = currentColor;
        const colorInput = colorWrap.createEl("input", { type: "color", cls: "fred-typ-color-input" });
        colorInput.value = currentColor;
        colorInput.addEventListener("click", (event) => event.stopPropagation());
        colorInput.addEventListener("input", async () => {
          colorDot.style.backgroundColor = colorInput.value;
          this.plugin.settings.typeColors[type] = colorInput.value;
          await this.plugin.saveSettings();
          onChange?.(colorInput.value);
        });
        colorInput.addEventListener("change", () => this.plugin.refreshTypColors?.());
        if (showReset) {
          const resetBtn = parent.createDiv({
            cls: "clickable-icon fred-typ-color-reset",
            attr: { "aria-label": "Farbe zur\xFCcksetzen" }
          });
          setIcon(resetBtn, "rotate-ccw");
          resetBtn.addEventListener("click", async () => {
            delete this.plugin.settings.typeColors[type];
            colorInput.value = DEFAULT_TYPE_COLOR;
            colorDot.style.backgroundColor = DEFAULT_TYPE_COLOR;
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
            onChange?.(DEFAULT_TYPE_COLOR);
          });
        }
        return colorWrap;
      }
      // Fängt Bestandsinstallationen ab, deren settings-Objekt schon vor Einführung
      // von typeManual geladen wurde (z. B. laufende Session vor einem vollständigen
      // Plugin-Reload nach Hot-Reload) - ohne das würde jeder Zugriff unten mit
      // "Cannot read properties of undefined" abbrechen und dabei den gesamten
      // restlichen renderTypeSettings()-Aufruf (Farbe, Beschreibung, Frontmatter)
      // mit sich reißen, da der Fehler synchron mitten in der Funktion auftritt.
      ensureTypeManual() {
        if (!this.plugin.settings.typeManual) this.plugin.settings.typeManual = {};
        return this.plugin.settings.typeManual;
      }
      // Nachgebaut wie Obsidians eigener ToggleComponent (checkbox-container +
      // verstecktes input[type=checkbox]), da wir hier direkt im DOM statt über
      // die Setting-API bauen. Standardmäßig an - daher wird (wie bei den anderen
      // typeXxx-Dicts) nur die Abweichung vom Default gespeichert, hier also nur
      // "aus" (false); fehlender Eintrag bzw. true bedeuten "an". Steuert, ob ein
      // TYP in getTypes() (siehe main.js) exportiert wird, siehe dortiger Kommentar.
      renderManualToggle(parent, type) {
        const current = this.ensureTypeManual()[type] !== false;
        const toggleEl = parent.createDiv({
          cls: "checkbox-container" + (current ? " is-enabled" : ""),
          attr: { tabindex: "0", role: "checkbox", "aria-checked": String(current) }
        });
        toggleEl.createEl("input", { type: "checkbox" });
        const toggle = async () => {
          const next = !toggleEl.hasClass("is-enabled");
          toggleEl.toggleClass("is-enabled", next);
          toggleEl.setAttribute("aria-checked", String(next));
          if (next) delete this.ensureTypeManual()[type];
          else this.ensureTypeManual()[type] = false;
          await this.plugin.saveSettings();
        };
        toggleEl.addEventListener("click", toggle);
        toggleEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        });
        return toggleEl;
      }
      renderRegisteredItem(type, count, { draggable = false, index = -1 } = {}) {
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable" });
        let nameEl;
        this.renderColorPicker(self, type, (newColor) => {
          if (nameEl && this.plugin.settings.colorViews.typList) nameEl.style.color = newColor;
        });
        nameEl = self.createDiv({ cls: "tree-item-inner", text: type });
        const color = this.plugin.settings.colorViews.typList ? this.plugin.settings.typeColors[type] : null;
        if (color) nameEl.style.color = color;
        if (this.plugin.settings.typListDescriptionEnabled) {
          const descInput = self.createEl("input", {
            type: "text",
            cls: "fred-typ-list-description-input"
          });
          descInput.value = this.plugin.settings.typeDescriptions[type] ?? "";
          descInput.addEventListener("click", (event) => event.stopPropagation());
          descInput.addEventListener("change", async () => {
            const value = descInput.value.trim();
            if (value) this.plugin.settings.typeDescriptions[type] = value;
            else delete this.plugin.settings.typeDescriptions[type];
            await this.plugin.saveSettings();
          });
        }
        this.renderCountFlair(self, count);
        self.addEventListener("click", () => {
          if (this.isEditing) return;
          this.openTypeSettings(type);
        });
        self.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openSearch(type);
        });
        if (draggable) {
          self.draggable = true;
          self.addEventListener("dragstart", (event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(index));
            self.classList.add("is-dragging");
          });
          self.addEventListener("dragend", () => self.classList.remove("is-dragging"));
          self.addEventListener("dragover", (event) => {
            event.preventDefault();
            const rect = self.getBoundingClientRect();
            const isAfter = event.clientY - rect.top > rect.height / 2;
            self.classList.toggle("is-drop-before", !isAfter);
            self.classList.toggle("is-drop-after", isAfter);
          });
          self.addEventListener("dragleave", () => self.classList.remove("is-drop-before", "is-drop-after"));
          self.addEventListener("drop", async (event) => {
            event.preventDefault();
            const isAfter = self.classList.contains("is-drop-after");
            self.classList.remove("is-drop-before", "is-drop-after");
            const fromIndex = Number(event.dataTransfer.getData("text/plain"));
            if (Number.isNaN(fromIndex) || fromIndex === index) return;
            let insertBefore = isAfter ? index + 1 : index;
            if (fromIndex < insertBefore) insertBefore -= 1;
            const types = this.plugin.settings.types;
            const [moved] = types.splice(fromIndex, 1);
            types.splice(insertBefore, 0, moved);
            await this.plugin.saveSettings();
            this.render();
          });
        }
      }
      renderUnregisteredItem(type, count) {
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable fred-typ-unregistered" });
        self.createDiv({ cls: "tree-item-inner", text: displayTypeKey(type) });
        this.renderCountFlair(self, count);
        self.addEventListener("click", () => this.registerType(type));
        self.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openSearch(type);
        });
      }
      renderTypeSettings(type) {
        const contentEl = this.paneTopEl;
        contentEl.empty();
        const header = contentEl.createDiv({ cls: "fred-typ-detail-header" });
        const backBtn = header.createDiv({ cls: "clickable-icon fred-typ-back", attr: { "aria-label": "Zur\xFCck" } });
        setIcon(backBtn, "arrow-left");
        backBtn.addEventListener("click", () => this.closeTypeSettings());
        const titleEl = header.createDiv({ cls: "fred-typ-detail-title", text: type });
        const titleColor = this.plugin.settings.colorViews.typList ? this.plugin.settings.typeColors[type] : null;
        if (titleColor) titleEl.style.color = titleColor;
        const { counts } = this.plugin.typIndex.typeCounts();
        header.createSpan({ cls: "fred-typ-detail-count", text: String(counts.get(type) ?? 0) });
        const renameWithNotesBtn = header.createDiv({
          cls: "clickable-icon fred-typ-detail-rename-notes",
          attr: { "aria-label": "Umbenennen (inkl. Notizen anpassen)" }
        });
        setIcon(renameWithNotesBtn, "pencil");
        renameWithNotesBtn.addEventListener("click", () => this.startDetailRename(type, titleEl, { updateNotes: true }));
        const renameBtn = header.createDiv({ cls: "clickable-icon fred-typ-detail-rename", attr: { "aria-label": "Umbenennen" } });
        setIcon(renameBtn, "pencil");
        renameBtn.addEventListener("click", () => this.startDetailRename(type, titleEl));
        const deleteBtn = header.createDiv({ cls: "clickable-icon fred-typ-detail-delete", attr: { "aria-label": "L\xF6schen" } });
        setIcon(deleteBtn, "trash");
        deleteBtn.addEventListener("click", () => this.showDeleteConfirm(type));
        const body = contentEl.createDiv({ cls: "fred-typ-detail-body" });
        const descSection = body.createDiv({ cls: "fred-typ-description-section" });
        const optionsHeader = descSection.createDiv({ cls: "fred-typ-frontmatter-header fred-typ-options-header" });
        const manualToggleWrap = optionsHeader.createDiv({ cls: "fred-typ-manual-toggle" });
        manualToggleWrap.createSpan({ cls: "fred-typ-detail-section-title", text: "Manueller TYP" });
        this.renderManualToggle(manualToggleWrap, type);
        const colorRow = optionsHeader.createDiv({ cls: "fred-typ-detail-color-row" });
        this.renderColorPicker(
          colorRow,
          type,
          (newColor) => {
            if (this.plugin.settings.colorViews.typList) titleEl.style.color = newColor;
          },
          { showReset: true }
        );
        const descHeader = descSection.createDiv({ cls: "fred-typ-frontmatter-header" });
        descHeader.createDiv({ cls: "fred-typ-detail-section-title", text: "Beschreibung" });
        const descInput = descSection.createEl("textarea", {
          cls: "fred-typ-description-input",
          attr: { rows: "2" }
        });
        descInput.value = this.plugin.settings.typeDescriptions[type] ?? "";
        descInput.addEventListener("change", async () => {
          const value = descInput.value.trim();
          if (value) this.plugin.settings.typeDescriptions[type] = value;
          else delete this.plugin.settings.typeDescriptions[type];
          await this.plugin.saveSettings();
        });
        const sectionHeader = body.createDiv({ cls: "fred-typ-frontmatter-header" });
        sectionHeader.createDiv({ cls: "fred-typ-detail-section-title", text: "Standard-Frontmatter" });
        const addButtons = sectionHeader.createDiv({ cls: "fred-typ-frontmatter-add-group" });
        const addFloatingPropertyBtn = addButtons.createDiv({
          cls: "clickable-icon fred-typ-frontmatter-add-floating",
          attr: { "aria-label": "Floating Property hinzuf\xFCgen" }
        });
        setIcon(addFloatingPropertyBtn, "plus");
        addFloatingPropertyBtn.addEventListener("click", () => {
          if (this.frontmatterEditor) this.frontmatterEditor.fredPendingFloatingAdd = true;
          addBlankProperty(this.frontmatterEditor);
        });
        const addPropertyBtn = addButtons.createDiv({
          cls: "clickable-icon fred-typ-frontmatter-add",
          attr: { "aria-label": "Property hinzuf\xFCgen" }
        });
        setIcon(addPropertyBtn, "plus");
        addPropertyBtn.addEventListener("click", () => {
          if (this.frontmatterEditor) this.frontmatterEditor.fredPendingFloatingAdd = false;
          addBlankProperty(this.frontmatterEditor);
        });
        this.frontmatterEditor = mountTypeFrontmatterEditor(this, body, type);
        this.renderPlaceholderList(body);
        this.plugin.refreshFrontmatterHighlight?.();
      }
      showDeleteConfirm(type) {
        new ConfirmDeleteTypeModal(this.plugin, type, async () => {
          this.plugin.settings.types = this.plugin.settings.types.filter((t) => t !== type);
          delete this.plugin.settings.typeColors[type];
          delete this.plugin.settings.typeDescriptions[type];
          delete this.plugin.settings.typeDefaultFrontmatter[type];
          delete this.plugin.settings.typeFloatingKeys[type];
          delete this.ensureTypeManual()[type];
          delete this.plugin.settings.subtypesByType[type];
          delete this.plugin.settings.subtypeDescriptions[type];
          this.closeTypeSettings();
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
        }).open();
      }
      // Wie startEditing(), aber auf dem freistehenden Titel-Element der Detail-Ansicht
      // statt auf einem Tree-Item - und mit resultierendem selectedType-Wechsel statt
      // eines schlichten Re-Renders der Liste. updateNotes: true (zweiter, hervor-
      // gehobener Button) schreibt nach Bestätigung zusätzlich den TYP-Wert aller
      // betroffenen Notizen um (siehe renameTypeInNotes), statt nur die Plugin-
      // Einstellungen zu migrieren.
      startDetailRename(type, titleEl, { updateNotes = false } = {}) {
        if (this.isEditing) return;
        this.isEditing = true;
        titleEl.addClass("is-being-renamed");
        titleEl.setAttribute("contenteditable", "true");
        titleEl.setAttribute("spellcheck", "false");
        titleEl.focus();
        const range = titleEl.doc.createRange();
        range.selectNodeContents(titleEl);
        const selection = titleEl.win.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const applyRename = async (value) => {
          const idx = this.plugin.settings.types.indexOf(type);
          if (idx !== -1) this.plugin.settings.types[idx] = value;
          if (this.plugin.settings.typeColors[type] !== void 0) {
            this.plugin.settings.typeColors[value] = this.plugin.settings.typeColors[type];
            delete this.plugin.settings.typeColors[type];
          }
          if (this.plugin.settings.typeDescriptions[type] !== void 0) {
            this.plugin.settings.typeDescriptions[value] = this.plugin.settings.typeDescriptions[type];
            delete this.plugin.settings.typeDescriptions[type];
          }
          if (this.plugin.settings.typeDefaultFrontmatter[type] !== void 0) {
            this.plugin.settings.typeDefaultFrontmatter[value] = this.plugin.settings.typeDefaultFrontmatter[type];
            delete this.plugin.settings.typeDefaultFrontmatter[type];
          }
          if (this.plugin.settings.typeFloatingKeys[type] !== void 0) {
            this.plugin.settings.typeFloatingKeys[value] = this.plugin.settings.typeFloatingKeys[type];
            delete this.plugin.settings.typeFloatingKeys[type];
          }
          if (this.ensureTypeManual()[type] !== void 0) {
            this.plugin.settings.typeManual[value] = this.plugin.settings.typeManual[type];
            delete this.plugin.settings.typeManual[type];
          }
          if (this.plugin.settings.subtypesByType[type] !== void 0) {
            this.plugin.settings.subtypesByType[value] = this.plugin.settings.subtypesByType[type];
            delete this.plugin.settings.subtypesByType[type];
          }
          if (this.plugin.settings.subtypeDescriptions[type] !== void 0) {
            this.plugin.settings.subtypeDescriptions[value] = this.plugin.settings.subtypeDescriptions[type];
            delete this.plugin.settings.subtypeDescriptions[type];
          }
          this.selectedType = value;
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
        };
        let done = false;
        const finish = async (commit) => {
          if (done) return;
          done = true;
          this.isEditing = false;
          const value = normalizeTypeName(titleEl.textContent);
          if (!commit || !value || value === type) {
            this.render();
            return;
          }
          const existing = this.plugin.settings.types.find(
            (t) => t.toLowerCase() === value.toLowerCase() && t !== type
          );
          if (existing) {
            this.showMergeConfirm(type, existing);
            return;
          }
          if (!updateNotes) {
            await applyRename(value);
            this.render();
            return;
          }
          const { counts } = this.plugin.typIndex.typeCounts();
          new ConfirmRenameTypeModal(
            this.plugin,
            type,
            value,
            counts.get(type) ?? 0,
            async () => {
              await applyRename(value);
              const renamed = await renameTypeInNotes(this.plugin, type, value);
              new Notice(`TYP ${value}: ${renamed} Notiz(en) angepasst.`);
              this.render();
            },
            () => this.render()
          ).open();
        };
        titleEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
          }
        });
        titleEl.addEventListener("blur", () => finish(true));
      }
      showMergeConfirm(source, target) {
        const { counts } = this.plugin.typIndex.typeCounts();
        new ConfirmMergeTypeModal(
          this.plugin,
          source,
          target,
          counts.get(source) ?? 0,
          () => this.mergeType(source, target),
          () => this.render()
        ).open();
      }
      // Legt source in target auf: Notizen werden auf target umgeschrieben,
      // source verschwindet aus der TYP-Liste samt eigener Einstellungen (target
      // behält seine). Die SUBTYPen von source werden übernommen, da die
      // umgeschriebenen Notizen sie weiterhin tragen - Beschreibungen nur, wo
      // target für denselben SUBTYP noch keine hat.
      async mergeType(source, target) {
        var _a, _b;
        const settings = this.plugin.settings;
        const renamed = await renameTypeInNotes(this.plugin, source, target);
        settings.types = settings.types.filter((t) => t !== source);
        delete settings.typeColors[source];
        delete settings.typeDescriptions[source];
        delete settings.typeDefaultFrontmatter[source];
        delete settings.typeFloatingKeys[source];
        delete this.ensureTypeManual()[source];
        const sourceSubtypes = settings.subtypesByType?.[source] ?? [];
        if (sourceSubtypes.length > 0) {
          const targetSubtypes = (_a = settings.subtypesByType)[target] ?? (_a[target] = []);
          for (const subtyp of sourceSubtypes) {
            if (!targetSubtypes.includes(subtyp)) targetSubtypes.push(subtyp);
          }
        }
        const sourceDescriptions = settings.subtypeDescriptions?.[source];
        if (sourceDescriptions) {
          const targetDescriptions = (_b = settings.subtypeDescriptions)[target] ?? (_b[target] = {});
          for (const [subtyp, description] of Object.entries(sourceDescriptions)) {
            if (targetDescriptions[subtyp] === void 0) targetDescriptions[subtyp] = description;
          }
        }
        if (settings.subtypesByType) delete settings.subtypesByType[source];
        if (settings.subtypeDescriptions) delete settings.subtypeDescriptions[source];
        this.selectedType = target;
        await this.plugin.saveSettings();
        this.plugin.refreshTypColors?.();
        new Notice(`TYP ${source} mit ${target} zusammengelegt, ${renamed} Notiz(en) angepasst.`);
        this.render();
      }
      renderCountFlair(self, count) {
        const flairOuter = self.createDiv({ cls: "tree-item-flair-outer" });
        flairOuter.createSpan({ cls: "tree-item-flair", text: String(count) });
      }
      // Rein informativ, unter dem Standard-Frontmatter-Editor: der Hinweistext
      // erklärt den Floating-Property-Toggle (Rechtsklick auf eine Property oben,
      // siehe ensurePropertyMenuPatch in type-frontmatter-editor.js), die Liste
      // darunter die Platzhalter, die als Wert einer Property eingetragen werden
      // können (z. B. bei "Datum" der Text "{{today}}") - getTypeDefaults()
      // (main.js) löst sie bei jedem Abruf frisch auf, siehe
      // frontmatter-placeholders.js. Bewusst ohne eigene Überschrift, da direkt
      // unter der Property-Liste ohnehin klar ist, worauf sich beides bezieht.
      renderPlaceholderList(parent) {
        const section = parent.createDiv({ cls: "fred-typ-placeholder-section" });
        const list = section.createDiv({ cls: "fred-typ-placeholder-list" });
        for (const { token, description } of [...FRONTMATTER_PLACEHOLDERS, DYNAMIC_PLACEHOLDER_INFO]) {
          const row = list.createDiv({ cls: "fred-typ-placeholder-row" });
          row.createEl("code", { cls: "fred-typ-placeholder-token", text: token });
          row.createSpan({ cls: "fred-typ-placeholder-desc", text: description });
        }
        section.createDiv({
          cls: "fred-typ-placeholder-hint",
          text: "You can change a property to floating in the right-click menu."
        });
      }
    };
    function registerTypView2(plugin) {
      plugin.registerView(VIEW_TYPE_TYP, (leaf) => new TypView(leaf, plugin));
      plugin.addCommand({
        id: "typ-view-oeffnen",
        name: "TYP - TYP-View \xF6ffnen",
        callback: () => activateTypView(plugin)
      });
      plugin.addCommand({
        id: "typ-property-hinzufuegen",
        name: "TYP - Standard-Property hinzuf\xFCgen",
        callback: () => addTypPropertyCommand(plugin)
      });
      plugin.addCommand({
        id: "typ-hinzufuegen",
        name: "TYP - Neuen TYP hinzuf\xFCgen",
        callback: () => addTypCommand(plugin)
      });
      plugin.addCommand({
        id: "subtyp-hinzufuegen",
        name: "SUBTYP - Neuen Subtyp hinzuf\xFCgen",
        callback: () => addSubtypCommand(plugin)
      });
      plugin.app.workspace.onLayoutReady(() => activateTypView(plugin, false, false));
      const refresh = () => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TYP)) {
          leaf.view?.render?.();
        }
      };
      const debouncedRefresh = debounce(refresh, 500, true);
      plugin.registerEvent(plugin.typIndex.on("change", debouncedRefresh));
      plugin.registerEvent(plugin.app.vault.on("config-changed", debouncedRefresh));
      return refresh;
    }
    async function activateTypView(plugin, reveal = true, createIfMissing = true) {
      const app = plugin.app;
      const { workspace } = app;
      const candidates = [];
      workspace.iterateAllLeaves((leaf2) => {
        if (leaf2 === app.__fredTypLeaf || leaf2.view && leaf2.view.getViewType() === VIEW_TYPE_TYP) {
          candidates.push(leaf2);
        }
      });
      let leaf = candidates.shift() ?? null;
      for (const extra of candidates) extra.detach();
      if (!leaf) {
        if (!createIfMissing) return;
        leaf = workspace.getLeftLeaf(false);
        await leaf.setViewState({ type: VIEW_TYPE_TYP, active: true });
      } else if (!(leaf.view instanceof TypView)) {
        await leaf.setViewState({ type: VIEW_TYPE_TYP, active: false });
      }
      app.__fredTypLeaf = leaf;
      if (reveal) workspace.revealLeaf(leaf);
    }
    async function addTypPropertyCommand(plugin) {
      const app = plugin.app;
      const activeTypView = app.workspace.getActiveViewOfType(TypView);
      if (activeTypView && activeTypView.selectedType !== null) {
        addBlankProperty(activeTypView.frontmatterEditor);
        return;
      }
      const file = app.workspace.getActiveFile();
      const type = plugin.typIndex.typeOf(file);
      if (!type) {
        new Notice("Aktive Notiz hat keinen TYP.");
        return;
      }
      await activateTypView(plugin);
      const view = app.__fredTypLeaf?.view;
      if (!(view instanceof TypView)) return;
      view.openTypeSettings(type);
      addBlankProperty(view.frontmatterEditor);
    }
    async function addTypCommand(plugin) {
      await activateTypView(plugin);
      const view = plugin.app.__fredTypLeaf?.view;
      if (!(view instanceof TypView)) return;
      if (view.selectedType !== null) view.closeTypeSettings();
      view.startAdd();
    }
    async function addSubtypCommand(plugin) {
      await activateTypView(plugin);
      const view = plugin.app.__fredTypLeaf?.view;
      if (!(view instanceof TypView)) return;
      if (view.selectedType === null) {
        new Notice("Bitte zuerst einen TYP \xF6ffnen.");
        return;
      }
      view.subtypPane?.startAdd();
    }
    module2.exports = { registerTypView: registerTypView2, VIEW_TYPE_TYP, compareTypes, sortTypesByMode: sortTypesByMode2, DEFAULT_SORT_ORDER: DEFAULT_SORT_ORDER2, DEFAULT_TYPE_COLOR };
  }
});

// src/type-colors.js
var require_type_colors = __commonJS({
  "src/type-colors.js"(exports2, module2) {
    function colorForFile(plugin, file) {
      const type = plugin.typIndex.typeOf(file);
      return type ? plugin.settings.typeColors[type] ?? null : null;
    }
    module2.exports = { colorForFile };
  }
});

// src/file-explorer-colors.js
var require_file_explorer_colors = __commonJS({
  "src/file-explorer-colors.js"(exports2, module2) {
    var { TFile, TFolder } = require("obsidian");
    var { colorForFile } = require_type_colors();
    var FILE_EXPLORER_VIEW_TYPE = "file-explorer";
    var FOLDER_NOTES_PLUGIN_ID = "folder-notes";
    function getFolderNoteFile(plugin, folder) {
      const folderNotes = plugin.app.plugins.plugins[FOLDER_NOTES_PLUGIN_ID];
      const settings = folderNotes?.settings;
      if (!settings) return null;
      const fileName = (settings.folderNoteName || "{{folder_name}}").replace("{{folder_name}}", folder.name) + (settings.folderNoteType || ".md");
      const dirPath = settings.storageLocation === "parentFolder" ? folder.parent?.path ?? "" : folder.path;
      const path = dirPath ? `${dirPath}/${fileName}` : fileName;
      const file = plugin.app.vault.getAbstractFileByPath(path);
      return file instanceof TFile ? file : null;
    }
    function applyColorToTitle(plugin, titleEl, file) {
      const contentEl = titleEl.querySelector(".nav-file-title-content, .nav-folder-title-content");
      if (!contentEl) return;
      const color = plugin.settings.colorViews.fileExplorer ? colorForFile(plugin, file) : null;
      if (color) contentEl.style.color = color;
      else contentEl.style.removeProperty("color");
    }
    function applyFileExplorerColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW_TYPE)) {
        const fileTitleEls = leaf.view.containerEl.querySelectorAll(".nav-file-title[data-path]");
        for (const titleEl of fileTitleEls) {
          const file = plugin.app.vault.getAbstractFileByPath(titleEl.getAttribute("data-path"));
          applyColorToTitle(plugin, titleEl, file instanceof TFile ? file : null);
        }
        const folderTitleEls = leaf.view.containerEl.querySelectorAll(".nav-folder-title[data-path]");
        for (const titleEl of folderTitleEls) {
          const folder = plugin.app.vault.getAbstractFileByPath(titleEl.getAttribute("data-path"));
          const noteFile = folder instanceof TFolder ? getFolderNoteFile(plugin, folder) : null;
          applyColorToTitle(plugin, titleEl, noteFile);
        }
      }
    }
    function registerFileExplorerColors2(plugin) {
      const refresh = () => applyFileExplorerColors(plugin);
      const observer = new MutationObserver(refresh);
      const observeExplorerLeaves = () => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW_TYPE)) {
          observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
        }
      };
      plugin.register(() => observer.disconnect());
      plugin.registerEvent(plugin.typIndex.on("change", refresh));
      plugin.registerEvent(plugin.app.vault.on("rename", refresh));
      plugin.registerEvent(
        plugin.app.workspace.on("layout-change", () => {
          observeExplorerLeaves();
          refresh();
        })
      );
      plugin.app.workspace.onLayoutReady(() => {
        observeExplorerLeaves();
        refresh();
      });
      return refresh;
    }
    module2.exports = { registerFileExplorerColors: registerFileExplorerColors2 };
  }
});

// src/graph-colors.js
var require_graph_colors = __commonJS({
  "src/graph-colors.js"(exports2, module2) {
    var { colorForFile } = require_type_colors();
    var GRAPH_VIEW_TYPES = ["graph", "localgraph"];
    function hexToInt(hex) {
      return parseInt(hex.replace("#", ""), 16);
    }
    function patchRenderer(plugin, renderer) {
      if (renderer.__fredTypColorPatched) return;
      renderer.__fredTypColorPatched = true;
      const original = renderer.setData;
      renderer.setData = function(data) {
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
            color = colorForFile(plugin, file);
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
    function registerGraphColors2(plugin) {
      const refresh = () => {
        for (const leaf of getGraphLeaves(plugin.app)) {
          if (leaf.view?.renderer) patchRenderer(plugin, leaf.view.renderer);
          leaf.view?.dataEngine?.render();
        }
      };
      plugin.registerEvent(plugin.app.workspace.on("layout-change", refresh));
      plugin.registerEvent(plugin.typIndex.on("change", refresh));
      plugin.app.workspace.onLayoutReady(refresh);
      return refresh;
    }
    module2.exports = { registerGraphColors: registerGraphColors2 };
  }
});

// src/search-colors.js
var require_search_colors = __commonJS({
  "src/search-colors.js"(exports2, module2) {
    var { colorForFile } = require_type_colors();
    var SEARCH_VIEW_TYPE = "search";
    function applySearchColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType(SEARCH_VIEW_TYPE)) {
        const resultDomLookup = leaf.view?.dom?.resultDomLookup;
        if (!resultDomLookup) continue;
        for (const [file, resultDom] of resultDomLookup) {
          const titleEl = resultDom.el?.querySelector(".search-result-file-title .tree-item-inner");
          if (!titleEl) continue;
          const color = plugin.settings.colorViews.search ? colorForFile(plugin, file) : null;
          if (color) titleEl.style.color = color;
          else titleEl.style.removeProperty("color");
        }
      }
    }
    function registerSearchColors2(plugin) {
      const refresh = () => applySearchColors(plugin);
      const observer = new MutationObserver(refresh);
      const observeLeaves = () => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(SEARCH_VIEW_TYPE)) {
          observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
        }
      };
      plugin.register(() => observer.disconnect());
      plugin.registerEvent(plugin.typIndex.on("change", refresh));
      plugin.registerEvent(
        plugin.app.workspace.on("layout-change", () => {
          observeLeaves();
          refresh();
        })
      );
      plugin.app.workspace.onLayoutReady(() => {
        observeLeaves();
        refresh();
      });
      return refresh;
    }
    module2.exports = { registerSearchColors: registerSearchColors2 };
  }
});

// src/recent-files-colors.js
var require_recent_files_colors = __commonJS({
  "src/recent-files-colors.js"(exports2, module2) {
    var { colorForFile } = require_type_colors();
    var RECENT_FILES_VIEW_TYPE = "recent-files";
    function applyRecentFilesColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType(RECENT_FILES_VIEW_TYPE)) {
        const recentFiles = leaf.view?.data?.recentFiles;
        if (!Array.isArray(recentFiles)) continue;
        const titleEls = leaf.view.containerEl.querySelectorAll(".recent-files-title .nav-file-title-content");
        titleEls.forEach((titleEl, index) => {
          const entry = recentFiles[index];
          const file = entry ? plugin.app.vault.getAbstractFileByPath(entry.path) : null;
          const color = plugin.settings.colorViews.recentFiles ? colorForFile(plugin, file) : null;
          if (color) titleEl.style.color = color;
          else titleEl.style.removeProperty("color");
        });
      }
    }
    function registerRecentFilesColors2(plugin) {
      const refresh = () => applyRecentFilesColors(plugin);
      const observer = new MutationObserver(refresh);
      const observeLeaves = () => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(RECENT_FILES_VIEW_TYPE)) {
          observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
        }
      };
      plugin.register(() => observer.disconnect());
      plugin.registerEvent(plugin.typIndex.on("change", refresh));
      plugin.registerEvent(
        plugin.app.workspace.on("layout-change", () => {
          observeLeaves();
          refresh();
        })
      );
      plugin.app.workspace.onLayoutReady(() => {
        observeLeaves();
        refresh();
      });
      return refresh;
    }
    module2.exports = { registerRecentFilesColors: registerRecentFilesColors2 };
  }
});

// src/backlink-colors.js
var require_backlink_colors = __commonJS({
  "src/backlink-colors.js"(exports2, module2) {
    var { colorForFile } = require_type_colors();
    var BACKLINK_VIEW_TYPE = "backlink";
    function getResultDomLookups(view) {
      const renderer = view?.backlink;
      const candidates = [renderer?.backlinkDom, renderer?.unlinkedDom, view?.backlinkDom, view?.unlinkedDom, view?.dom];
      const lookups = [];
      for (const dom of candidates) {
        if (dom?.resultDomLookup instanceof Map) lookups.push(dom.resultDomLookup);
      }
      return lookups;
    }
    function colorTitleEl(plugin, el, file) {
      const color = plugin.settings.colorViews.backlinks ? colorForFile(plugin, file) : null;
      if (color) el.style.color = color;
      else el.style.removeProperty("color");
    }
    function applyBacklinkPaneColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType(BACKLINK_VIEW_TYPE)) {
        for (const lookup of getResultDomLookups(leaf.view)) {
          for (const [file, resultDom] of lookup) {
            const titleEl = resultDom.el?.querySelector(".search-result-file-title .tree-item-inner");
            if (titleEl) colorTitleEl(plugin, titleEl, file);
          }
        }
      }
    }
    function applyEmbeddedBacklinkColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
        const paneEl = leaf.view.containerEl.querySelector(".embedded-backlinks .backlink-pane");
        if (!paneEl) continue;
        const sourcePath = leaf.view.file?.path ?? "";
        const titleEls = paneEl.querySelectorAll(".search-result-file-title .tree-item-inner");
        for (const titleEl of titleEls) {
          const basename = titleEl.textContent;
          const file = basename ? plugin.app.metadataCache.getFirstLinkpathDest(basename, sourcePath) : null;
          colorTitleEl(plugin, titleEl, file);
        }
      }
    }
    function applyBacklinkColors(plugin) {
      applyBacklinkPaneColors(plugin);
      applyEmbeddedBacklinkColors(plugin);
    }
    function registerBacklinkColors2(plugin) {
      const refresh = () => applyBacklinkColors(plugin);
      const observer = new MutationObserver(refresh);
      const observeLeaves = () => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(BACKLINK_VIEW_TYPE)) {
          observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
        }
      };
      plugin.register(() => observer.disconnect());
      plugin.registerEvent(plugin.typIndex.on("change", refresh));
      plugin.registerEvent(plugin.app.metadataCache.on("resolved", () => applyEmbeddedBacklinkColors(plugin)));
      plugin.registerEvent(
        plugin.app.workspace.on("layout-change", () => {
          observeLeaves();
          refresh();
        })
      );
      plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", refresh));
      plugin.app.workspace.onLayoutReady(() => {
        observeLeaves();
        refresh();
      });
      return refresh;
    }
    module2.exports = { registerBacklinkColors: registerBacklinkColors2 };
  }
});

// src/bookmark-colors.js
var require_bookmark_colors = __commonJS({
  "src/bookmark-colors.js"(exports2, module2) {
    var { colorForFile } = require_type_colors();
    var BOOKMARKS_VIEW_TYPE = "bookmarks";
    var BOOKMARKS_PLUGIN_ID = "bookmarks";
    function forEachFileBookmark(items, callback) {
      for (const item of items ?? []) {
        if (item.type === "file") callback(item);
        else if (item.type === "group") forEachFileBookmark(item.items, callback);
      }
    }
    function applyBookmarksColors(plugin) {
      const bookmarksPlugin = plugin.app.internalPlugins.getEnabledPluginById(BOOKMARKS_PLUGIN_ID);
      if (!bookmarksPlugin) return;
      for (const leaf of plugin.app.workspace.getLeavesOfType(BOOKMARKS_VIEW_TYPE)) {
        const itemDoms = leaf.view?.itemDoms;
        if (!itemDoms) continue;
        forEachFileBookmark(bookmarksPlugin.items, (item) => {
          const titleEl = itemDoms.get(item)?.titleEl;
          if (!titleEl) return;
          const file = plugin.app.vault.getAbstractFileByPath(item.path);
          const color = plugin.settings.colorViews.bookmarks ? colorForFile(plugin, file) : null;
          if (color) titleEl.style.color = color;
          else titleEl.style.removeProperty("color");
        });
      }
    }
    function registerBookmarksColors2(plugin) {
      const refresh = () => applyBookmarksColors(plugin);
      const observer = new MutationObserver(refresh);
      const observeLeaves = () => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(BOOKMARKS_VIEW_TYPE)) {
          observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
        }
      };
      plugin.register(() => observer.disconnect());
      plugin.registerEvent(plugin.typIndex.on("change", refresh));
      plugin.registerEvent(
        plugin.app.workspace.on("layout-change", () => {
          observeLeaves();
          refresh();
        })
      );
      plugin.app.workspace.onLayoutReady(() => {
        observeLeaves();
        refresh();
      });
      return refresh;
    }
    module2.exports = { registerBookmarksColors: registerBookmarksColors2 };
  }
});

// src/active-title-colors.js
var require_active_title_colors = __commonJS({
  "src/active-title-colors.js"(exports2, module2) {
    var { TFile } = require("obsidian");
    var { colorForFile } = require_type_colors();
    var DOT_CLASS = "fred-typ-title-dot";
    var BADGE_CLASS = "fred-typ-title-badge";
    var BADGE_PLAIN_CLASS = "fred-typ-title-badge-plain";
    var COLOR_VAR = "--fred-typ-title-color";
    var BLOCK_BADGE_CLASS = "fred-typ-block-badge";
    var BLOCK_BADGE_PLAIN_CLASS = "fred-typ-block-badge-plain";
    var BLOCK_ALIGN_TOP_CLASS = "fred-typ-block-badge-top";
    var BLOCK_ALIGN_BOTTOM_CLASS = "fred-typ-block-badge-bottom";
    var BLOCK_COLOR_VAR = "--fred-typ-block-color";
    function resolveMarker(plugin, file) {
      const style = plugin.settings.noteTitleStyle;
      if (style === "none") return { kind: "none" };
      if (style === "dot") return { kind: "dot", color: colorForFile(plugin, file) };
      const colored = plugin.settings.noteTitleBadgeColored;
      const color = colored ? colorForFile(plugin, file) : null;
      const typeName = colored ? color ? plugin.typIndex.typeOf(file) : null : plugin.typIndex.typeOf(file);
      if (!typeName) return { kind: "none" };
      const position = plugin.settings.noteTitleBadgePosition;
      return { kind: position === "block" ? "block-badge" : "title-badge", colored, color, typeName };
    }
    function applyStyleToTitle(titleEl, marker) {
      const isDot = marker.kind === "dot" && !!marker.color;
      const isBadge = marker.kind === "title-badge";
      titleEl.classList.toggle(DOT_CLASS, isDot);
      titleEl.classList.toggle(BADGE_CLASS, isBadge && marker.colored);
      titleEl.classList.toggle(BADGE_PLAIN_CLASS, isBadge && !marker.colored);
      if (isBadge) titleEl.dataset.fredTyp = marker.typeName;
      else delete titleEl.dataset.fredTyp;
      const markerColor = isDot && marker.color || isBadge && marker.colored && marker.color ? marker.color : null;
      if (markerColor) titleEl.style.setProperty(COLOR_VAR, markerColor);
      else titleEl.style.removeProperty(COLOR_VAR);
    }
    function applyStyleToBlock(plugin, blockEl, marker) {
      const isBlockBadge = marker.kind === "block-badge";
      blockEl.classList.toggle(BLOCK_BADGE_CLASS, isBlockBadge && marker.colored);
      blockEl.classList.toggle(BLOCK_BADGE_PLAIN_CLASS, isBlockBadge && !marker.colored);
      const align = plugin.settings.noteTitleVerticalAlign;
      blockEl.classList.toggle(BLOCK_ALIGN_TOP_CLASS, isBlockBadge && align !== "bottom");
      blockEl.classList.toggle(BLOCK_ALIGN_BOTTOM_CLASS, isBlockBadge && align === "bottom");
      if (isBlockBadge) blockEl.dataset.fredTyp = marker.typeName;
      else delete blockEl.dataset.fredTyp;
      const blockColor = isBlockBadge && marker.colored && marker.color ? marker.color : null;
      if (blockColor) blockEl.style.setProperty(BLOCK_COLOR_VAR, blockColor);
      else blockEl.style.removeProperty(BLOCK_COLOR_VAR);
    }
    function applyActiveTitleColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
        const containerEl = leaf.view.containerEl;
        const file = leaf.view.file;
        const typedFile = file instanceof TFile ? file : null;
        const marker = resolveMarker(plugin, typedFile);
        const titleEl = containerEl.querySelector(".inline-title");
        if (titleEl) {
          applyStyleToTitle(titleEl, marker);
          const textColor = plugin.settings.colorViews.noteTitleColor ? colorForFile(plugin, typedFile) : null;
          if (textColor) titleEl.style.color = textColor;
          else titleEl.style.removeProperty("color");
        }
        const blockEl = containerEl.querySelector(".metadata-container");
        if (blockEl) applyStyleToBlock(plugin, blockEl, marker);
      }
    }
    function registerActiveTitleColors2(plugin) {
      const refresh = () => applyActiveTitleColors(plugin);
      plugin.registerEvent(plugin.typIndex.on("change", refresh));
      plugin.registerEvent(plugin.app.workspace.on("file-open", refresh));
      plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", refresh));
      plugin.registerEvent(plugin.app.workspace.on("layout-change", refresh));
      plugin.app.workspace.onLayoutReady(refresh);
      return refresh;
    }
    module2.exports = { registerActiveTitleColors: registerActiveTitleColors2 };
  }
});

// src/link-colors.js
var require_link_colors = __commonJS({
  "src/link-colors.js"(exports2, module2) {
    var { editorInfoField, getLinkpath } = require("obsidian");
    var { ViewPlugin, Decoration } = require("@codemirror/view");
    var { Prec, RangeSetBuilder, StateEffect } = require("@codemirror/state");
    var { syntaxTree } = require("@codemirror/language");
    var { colorForFile } = require_type_colors();
    var COLOR_VAR = "--link-color";
    var SOURCE_ATTR = "data-fred-typ-src";
    var WIKILINK_PATTERN = /(?<!!)\[\[([^[\]]+?)\]\]/g;
    function colorForLinktext(plugin, linktext, sourcePath) {
      const target = linktext.split(/\\?\|/)[0].trim();
      const linkpath = getLinkpath(target);
      if (!linkpath) return null;
      const file = plugin.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
      return colorForFile(plugin, file);
    }
    function applyToAnchor(plugin, anchorEl) {
      const href = anchorEl.getAttribute("data-href");
      const color = plugin.settings.colorViews.links && href && !anchorEl.classList.contains("is-unresolved") ? colorForLinktext(plugin, href, anchorEl.getAttribute(SOURCE_ATTR) ?? "") : null;
      if (color) anchorEl.style.setProperty(COLOR_VAR, color);
      else anchorEl.style.removeProperty(COLOR_VAR);
    }
    function refreshRenderedLinks(plugin) {
      const docs = /* @__PURE__ */ new Set();
      plugin.app.workspace.iterateAllLeaves((leaf) => docs.add(leaf.view.containerEl.ownerDocument));
      for (const doc of docs) {
        for (const anchorEl of doc.querySelectorAll(`a.internal-link[${SOURCE_ATTR}]`)) applyToAnchor(plugin, anchorEl);
      }
    }
    var refreshEffect = StateEffect.define();
    function buildLinkViewPlugin(plugin) {
      const decorationsByColor = /* @__PURE__ */ new Map();
      const decorationFor = (color) => {
        let decoration = decorationsByColor.get(color);
        if (!decoration) {
          decoration = Decoration.mark({
            class: "fred-typ-link",
            attributes: { style: `${COLOR_VAR}: ${color};` }
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
          for (let match; match = WIKILINK_PATTERN.exec(text); ) {
            const start = from + match.index;
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
          // Der Parser arbeitet den sichtbaren Bereich ggf. erst nach und nach ab -
          // ein neuer Syntaxbaum zählt daher ebenfalls als Anlass zum Neuaufbau.
          update(update) {
            if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state) || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refreshEffect)))) {
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
    function registerLinkColors2(plugin) {
      plugin.registerMarkdownPostProcessor((el, ctx) => {
        for (const anchorEl of el.querySelectorAll("a.internal-link")) {
          anchorEl.setAttribute(SOURCE_ATTR, ctx.sourcePath);
          applyToAnchor(plugin, anchorEl);
        }
      });
      plugin.registerEditorExtension(Prec.lowest(buildLinkViewPlugin(plugin)));
      const refresh = () => {
        refreshRenderedLinks(plugin);
        refreshEditors(plugin);
      };
      plugin.registerEvent(plugin.typIndex.on("change", refresh));
      plugin.register(() => {
        plugin.app.workspace.iterateAllLeaves((leaf) => {
          for (const anchorEl of leaf.view.containerEl.querySelectorAll(`a.internal-link[${SOURCE_ATTR}]`)) {
            anchorEl.style.removeProperty(COLOR_VAR);
          }
        });
      });
      return refresh;
    }
    module2.exports = { registerLinkColors: registerLinkColors2 };
  }
});

// src/frontmatter-default-highlight.js
var require_frontmatter_default_highlight = __commonJS({
  "src/frontmatter-default-highlight.js"(exports2, module2) {
    var TYP_PROPERTY = "TYP";
    var TYP_VIEW_TYPE = "fred-typ-view";
    var ALL_PROPERTIES_VIEW_TYPE = "all-properties";
    var HIGHLIGHT_CLASS = "fred-typ-default-property";
    var FLOATING_CLASS = "fred-typ-floating-property";
    function rawKeysForType(type, defaults) {
      if (!type || !defaults) return null;
      const keys = Object.keys(defaults).filter((key) => key !== "" && key.toLowerCase() !== TYP_PROPERTY.toLowerCase());
      return keys.length > 0 ? keys.map((key) => key.toLowerCase()) : null;
    }
    function floatingKeySet(plugin, type) {
      return new Set((plugin.settings.typeFloatingKeys[type] ?? []).map((key) => key.toLowerCase()));
    }
    function keysForType(plugin, type) {
      if (!plugin.settings.colorViews.frontmatterDefaults) return { standard: null, floating: null };
      if (!type) return { standard: null, floating: null };
      const allKeys = rawKeysForType(type, plugin.settings.typeDefaultFrontmatter[type]);
      if (!allKeys) return { standard: null, floating: null };
      const floating = floatingKeySet(plugin, type);
      const standardKeys = allKeys.filter((key) => !floating.has(key));
      const floatingKeys = allKeys.filter((key) => floating.has(key));
      return {
        standard: standardKeys.length > 0 ? new Set(standardKeys) : null,
        floating: floatingKeys.length > 0 ? new Set(floatingKeys) : null
      };
    }
    function keysForFile(plugin, file) {
      return keysForType(plugin, plugin.typIndex.typeOf(file));
    }
    function typesUsingKeyMap(plugin) {
      const map = /* @__PURE__ */ new Map();
      if (!plugin.settings.colorViews.allProperties) return map;
      for (const [type, defaults] of Object.entries(plugin.settings.typeDefaultFrontmatter)) {
        const keys = rawKeysForType(type, defaults);
        if (!keys) continue;
        for (const key of keys) {
          if (!map.has(key)) map.set(key, /* @__PURE__ */ new Set());
          map.get(key).add(type);
        }
      }
      return map;
    }
    function applyToContainer(containerEl, standardKeys, floatingKeys) {
      if (!containerEl) return;
      const rows = containerEl.querySelectorAll(".metadata-property[data-property-key]");
      for (const row of rows) {
        const keyEl = row.querySelector(".metadata-property-key-input");
        if (!keyEl) continue;
        const propertyKey = row.getAttribute("data-property-key");
        keyEl.classList.toggle(HIGHLIGHT_CLASS, !!standardKeys && standardKeys.has(propertyKey));
        keyEl.classList.toggle(FLOATING_CLASS, !!floatingKeys && floatingKeys.has(propertyKey));
      }
    }
    function applyToAllPropertiesView(plugin) {
      const usageMap = typesUsingKeyMap(plugin);
      for (const leaf of plugin.app.workspace.getLeavesOfType(ALL_PROPERTIES_VIEW_TYPE)) {
        const doms = leaf.view?.doms;
        if (!doms) continue;
        for (const [key, dom] of Object.entries(doms)) {
          const titleEl = dom?.titleEl;
          if (!titleEl) continue;
          const types = usageMap.get(key.toLowerCase());
          const count = types ? types.size : 0;
          titleEl.classList.toggle(HIGHLIGHT_CLASS, count > 1);
          let isFloating = false;
          if (count === 1) {
            const [onlyType] = types;
            isFloating = floatingKeySet(plugin, onlyType).has(key.toLowerCase());
            const color = plugin.settings.typeColors[onlyType];
            if (color) titleEl.style.setProperty("color", color, "important");
            else titleEl.style.removeProperty("color");
          } else {
            titleEl.style.removeProperty("color");
          }
          titleEl.classList.toggle(FLOATING_CLASS, isFloating);
        }
      }
    }
    function applyFrontmatterDefaultHighlight(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        const { standard, floating } = keysForFile(plugin, view?.file);
        applyToContainer(view?.metadataEditor?.containerEl, standard, floating);
      }
      for (const leaf of plugin.app.workspace.getLeavesOfType("file-properties")) {
        const view = leaf.view;
        const file = view?.file ?? plugin.app.workspace.getActiveFile();
        const { standard, floating } = keysForFile(plugin, file);
        applyToContainer(view?.metadataEditor?.containerEl, standard, floating);
      }
      for (const leaf of plugin.app.workspace.getLeavesOfType(TYP_VIEW_TYPE)) {
        const view = leaf.view;
        const { standard, floating } = keysForType(plugin, view?.selectedType);
        applyToContainer(view?.frontmatterEditor?.containerEl, standard, floating);
      }
      applyToAllPropertiesView(plugin);
    }
    function registerFrontmatterDefaultHighlight2(plugin) {
      const refresh = () => applyFrontmatterDefaultHighlight(plugin);
      plugin.registerEvent(plugin.app.metadataCache.on("changed", refresh));
      plugin.registerEvent(plugin.app.metadataCache.on("resolved", refresh));
      plugin.registerEvent(plugin.app.workspace.on("layout-change", refresh));
      plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", refresh));
      plugin.app.workspace.onLayoutReady(refresh);
      return refresh;
    }
    module2.exports = { registerFrontmatterDefaultHighlight: registerFrontmatterDefaultHighlight2 };
  }
});

// src/type-picker.js
var require_type_picker = __commonJS({
  "src/type-picker.js"(exports2, module2) {
    var { FuzzySuggestModal, Notice } = require("obsidian");
    var { DEFAULT_TYPE_COLOR, compareTypes, DEFAULT_SORT_ORDER: DEFAULT_SORT_ORDER2 } = require_typ_view();
    var TypPickerModal = class extends FuzzySuggestModal {
      constructor(app, plugin, items, resolve) {
        super(app);
        this.plugin = plugin;
        this.items = items;
        this.resolve = resolve;
        this.chosen = false;
        this.setPlaceholder("ESC f\xFCr Abbruch");
      }
      getItems() {
        return this.items;
      }
      // Fuzzy-Suche greift auch auf die Beschreibung, nicht nur auf den TYP-Namen.
      getItemText(item) {
        return item.description ? `${item.type} ${item.description}` : item.type;
      }
      renderSuggestion(match, el) {
        const item = match.item;
        el.addClass("fred-typ-picker-suggestion");
        if (item.unregistered) el.addClass("fred-typ-picker-unregistered");
        if (item.unregistered) {
          el.createSpan({ cls: "fred-typ-picker-name", text: item.type });
        } else {
          const color = this.plugin.settings.typeColors[item.type] ?? DEFAULT_TYPE_COLOR;
          if (this.plugin.settings.colorViews.typList) {
            el.createSpan({ cls: "fred-typ-picker-name", text: item.type }).style.color = color;
          } else {
            el.createSpan({ cls: "fred-typ-picker-dot" }).style.backgroundColor = color;
            el.createSpan({ cls: "fred-typ-picker-name", text: item.type });
          }
        }
        if (item.description) {
          el.createSpan({ cls: "fred-typ-picker-desc", text: item.description });
        }
        el.createSpan({ cls: "fred-typ-picker-count", text: String(item.count) });
      }
      // Obsidians SuggestModal.selectSuggestion() ruft intern erst this.close()
      // auf und danach erst onChooseSuggestion()/onChooseItem() - "chosen" hier zu
      // setzen (statt in onChooseItem) ist daher nicht bloß Geschmackssache: würde
      // es erst in onChooseItem gesetzt, hätte das close()-ausgelöste onClose()
      // unten "chosen" noch als false gesehen und das Promise fälschlich schon mit
      // null aufgelöst, bevor der eigentliche onChooseItem-Aufruf überhaupt lief -
      // das zweite resolve() greift dann nicht mehr (ein Promise löst nur einmal
      // auf), das Ergebnis war unabhängig von der Auswahl immer null.
      selectSuggestion(item, evt) {
        this.chosen = true;
        super.selectSuggestion(item, evt);
      }
      onChooseItem(item) {
        this.resolve(item.type);
      }
      // ESC (oder Klick daneben) schließt das Modal ohne selectSuggestion - dann
      // statt eines hängenden Promise mit null auflösen, analog zu
      // tp.system.suggester.
      onClose() {
        super.onClose();
        if (!this.chosen) this.resolve(null);
      }
    };
    function unregisteredItems(app, plugin) {
      const registered = new Set(plugin.settings.types);
      const { counts } = plugin.typIndex.typeCounts();
      const sortOrder = plugin.settings.typSortOrder ?? DEFAULT_SORT_ORDER2;
      return [...counts.keys()].filter((type) => !registered.has(type) && plugin.typIndex.isCleanKey(type)).sort((a, b) => compareTypes(sortOrder, a, b, counts, plugin.settings.typeColors)).map((type) => ({ type, description: "", count: counts.get(type) ?? 0, unregistered: true }));
    }
    function pickType(app, plugin, { includeManualOff = false, includeUnregistered = false } = {}) {
      return new Promise((resolve) => {
        const items = plugin.getTypes({ includeManualOff }).map((item) => ({ ...item, unregistered: false }));
        if (includeUnregistered) items.push(...unregisteredItems(app, plugin));
        if (items.length === 0) {
          new Notice("Keine TYPen vorhanden.");
          resolve(null);
          return;
        }
        new TypPickerModal(app, plugin, items, resolve).open();
      });
    }
    module2.exports = { pickType };
  }
});

// src/main.js
var { Plugin } = require("obsidian");
var { DEFAULT_SETTINGS, TypSystemSettingTab } = require_settings();
var { registerCommands } = require_commands();
var { registerTypView, sortTypesByMode, DEFAULT_SORT_ORDER } = require_typ_view();
var { TypIndex } = require_typ_index();
var { registerFileExplorerColors } = require_file_explorer_colors();
var { registerGraphColors } = require_graph_colors();
var { registerSearchColors } = require_search_colors();
var { registerRecentFilesColors } = require_recent_files_colors();
var { registerBacklinkColors } = require_backlink_colors();
var { registerBookmarksColors } = require_bookmark_colors();
var { registerActiveTitleColors } = require_active_title_colors();
var { registerLinkColors } = require_link_colors();
var { registerFrontmatterDefaultHighlight } = require_frontmatter_default_highlight();
var { normalizeGlobalOrder } = require_frontmatter_sort();
var { resolveFrontmatterPlaceholders, DYNAMIC_PLACEHOLDER_PATTERN } = require_frontmatter_placeholders();
var { pickType: pickTypeModal } = require_type_picker();
function migrateFloatingFrontmatter(settings) {
  if (!settings.typeFloatingFrontmatter) return;
  for (const [type, floating] of Object.entries(settings.typeFloatingFrontmatter)) {
    const keys = Object.keys(floating).filter((key) => key !== "");
    if (keys.length === 0) continue;
    settings.typeDefaultFrontmatter[type] = { ...settings.typeDefaultFrontmatter[type] ?? {}, ...floating };
    settings.typeFloatingKeys[type] = [.../* @__PURE__ */ new Set([...settings.typeFloatingKeys[type] ?? [], ...keys])];
  }
  delete settings.typeFloatingFrontmatter;
}
module.exports = class TypSystemPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.typIndex = new TypIndex(this);
    this.typIndex.register();
    registerCommands(this);
    this.addSettingTab(new TypSystemSettingTab(this.app, this));
    this.refreshFrontmatterHighlight = registerFrontmatterDefaultHighlight(this);
    const refreshFns = [
      registerTypView(this),
      registerFileExplorerColors(this),
      registerGraphColors(this),
      registerSearchColors(this),
      registerRecentFilesColors(this),
      registerBacklinkColors(this),
      registerBookmarksColors(this),
      registerActiveTitleColors(this),
      registerLinkColors(this),
      this.refreshFrontmatterHighlight
    ];
    this.refreshTypColors = () => refreshFns.forEach((fn) => fn());
  }
  onunload() {
  }
  // Für _obsidian/templater-scripts/TYP.js: liefert die im TYP-View unter
  // "Standard-Frontmatter" hinterlegten Properties für den gegebenen TYP, damit
  // Templater sie beim Anlegen einer neuen Notiz übernehmen kann, statt sie dort
  // ein zweites Mal zu pflegen. Werte wie "{{today}}" werden dabei erst hier
  // aufgelöst (siehe frontmatter-placeholders.js), nicht schon beim Speichern -
  // liefert also bei jedem Aufruf frisch berechnete Werte. Kopie statt direkter
  // Referenz, damit ein Aufrufer die zurückgegebenen Werte gefahrlos mutieren
  // kann, ohne die Plugin-Settings zu verändern.
  //
  // includeFloating (Standard: false) lässt die als "Floating Property"
  // markierten Keys (typeFloatingKeys) in der Liste - anders als die übrigen
  // Standard-Properties werden diese NICHT automatisch bei jeder neuen Notiz
  // angelegt (sie zählen zwar für die Frontmatter-Sortierung mit, siehe
  // orderedDefaultKeys in frontmatter-sort.js, sollen aber nur bei Bedarf
  // explizit von einem Templater-Skript abgegriffen werden).
  //
  // file (optional) wird an resolveFrontmatterPlaceholders() durchgereicht -
  // nur für den "{{created}}"-Platzhalter relevant, der das Erstellungsdatum
  // der Ziel-Datei statt des Aufrufzeitpunkts liefert.
  getTypeDefaults(type, { includeFloating = false, file } = {}) {
    const defaults = { ...this.settings.typeDefaultFrontmatter[type] ?? {} };
    if (!includeFloating) {
      for (const key of this.settings.typeFloatingKeys[type] ?? []) delete defaults[key];
    }
    return resolveFrontmatterPlaceholders(defaults, file);
  }
  // Für _obsidian/templater-scripts/TYP.js: erkennt einen dynamischen
  // "{{tp.<Skriptname>}}"-Platzhalter (siehe frontmatter-placeholders.js) in
  // einem Standard-Frontmatter-Wert und liefert den referenzierten Skriptnamen,
  // sonst null. Die eigentliche Auflösung (Aufruf von tp.user.<Skriptname>)
  // kann nur Templater selbst übernehmen - das Plugin hat keinen tp-Zugriff,
  // daher hier bewusst nur Erkennung statt Auflösung wie bei getTypeDefaults().
  matchDynamicPlaceholder(value) {
    if (typeof value !== "string") return null;
    const match = value.match(DYNAMIC_PLACEHOLDER_PATTERN);
    return match ? match[1].trim() : null;
  }
  // Für _obsidian/templater-scripts/TYP.js: die im TYP-View registrierten TYPen
  // samt ihrer dort gepflegten Beschreibung, statt sie aus _obsidian/Typen.md zu parsen -
  // in derselben Reihenfolge, in der sie auch in der TYP-Liste selbst erscheinen
  // (aktuelle Sortiereinstellung dort, z. B. Häufigkeit oder Name).
  //
  // TYPen mit deaktiviertem "Manueller TYP"-Schalter (siehe TYP-Detailansicht)
  // sind nicht für die manuelle Auswahl gedacht (z. B. beim Anlegen einer neuen
  // Notiz) und werden deshalb standardmäßig ausgeklammert - Aufrufer, die
  // trotzdem alle TYPen brauchen, übergeben includeManualOff: true.
  getTypes({ includeManualOff = false } = {}) {
    const { counts } = this.typIndex.typeCounts();
    const sortOrder = this.settings.typSortOrder ?? DEFAULT_SORT_ORDER;
    return sortTypesByMode(this.settings.types, sortOrder, counts, this.settings.typeColors).filter((type) => includeManualOff || (this.settings.typeManual ?? {})[type] !== false).map((type) => ({
      type,
      description: this.settings.typeDescriptions[type] ?? "",
      count: counts.get(type) ?? 0
    }));
  }
  // Für _obsidian/templater-scripts/TYP.js: nativer TYP-Picker (siehe
  // type-picker.js) statt der reinen Text-Liste aus getTypes() +
  // tp.system.suggester - mit TYP-Farbe/-Punkt, Beschreibung und Notiz-Anzahl
  // je Zeile. includeManualOff wie bei getTypes(). Löst mit dem gewählten TYP
  // auf, oder mit null bei Abbruch (ESC).
  pickType(options) {
    return pickTypeModal(this.app, this, options);
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.colorViews = { ...DEFAULT_SETTINGS.colorViews, ...this.settings.colorViews };
    this.settings.globalPropertyOrder = normalizeGlobalOrder(this.settings.globalPropertyOrder);
    migrateFloatingFrontmatter(this.settings);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
