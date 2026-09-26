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

// src/placeholder-suggest.js
var require_placeholder_suggest = __commonJS({
  "src/placeholder-suggest.js"(exports2, module2) {
    var { TFile, Vault, debounce, normalizePath } = require("obsidian");
    var { FRONTMATTER_PLACEHOLDERS } = require_frontmatter_placeholders();
    var EDITOR_CLASS = "fred-typ-frontmatter-editor";
    var SHORTCUT_MARKER = /^\s*(?:\/\/|\/\*|\*).*@typ-shortcut\b/m;
    function registerPlaceholderSuggest2(plugin) {
      const { app } = plugin;
      const metadataCache = app.metadataCache;
      let scriptFolder = null;
      let shortcutScripts = [];
      const currentScriptFolder = () => {
        const folder = app.plugins.plugins["templater-obsidian"]?.settings?.user_scripts_folder;
        return folder ? normalizePath(folder) : null;
      };
      const isInScriptFolder = (path) => !!scriptFolder && !!path && path.startsWith(scriptFolder + "/");
      async function refreshScripts() {
        const folderPath = currentScriptFolder();
        scriptFolder = folderPath;
        const folder = folderPath ? app.vault.getFolderByPath(folderPath) : null;
        const files = [];
        if (folder) {
          Vault.recurseChildren(folder, (child) => {
            if (child instanceof TFile && child.extension === "js") files.push(child);
          });
        }
        const names = [];
        for (const file of files) {
          try {
            if (SHORTCUT_MARKER.test(await app.vault.cachedRead(file))) names.push(file.basename);
          } catch (e) {
            console.error(`TYP-System: Templater-Skript ${file.path} nicht lesbar`, e);
          }
        }
        if (folderPath !== scriptFolder) return;
        shortcutScripts = names.sort((a, b) => a.localeCompare(b));
      }
      const scheduleRefresh = debounce(refreshScripts, 300, true);
      const onFileChange = (file, oldPath) => {
        if (isInScriptFolder(file?.path) || isInScriptFolder(oldPath)) scheduleRefresh();
      };
      plugin.registerEvent(app.vault.on("create", onFileChange));
      plugin.registerEvent(app.vault.on("modify", onFileChange));
      plugin.registerEvent(app.vault.on("delete", onFileChange));
      plugin.registerEvent(app.vault.on("rename", onFileChange));
      app.workspace.onLayoutReady(refreshScripts);
      const placeholderTokens = () => [
        ...FRONTMATTER_PLACEHOLDERS.map((p) => p.token),
        ...shortcutScripts.map((name) => `{{tp.${name}}}`)
      ];
      const original = metadataCache.getFrontmatterPropertyValuesForKey;
      const wrapped = function(...args) {
        const values = original.apply(this, args);
        const inputEl = activeDocument.activeElement;
        if (!inputEl?.closest?.(`.${EDITOR_CLASS}`)) return values;
        const text = typeof inputEl.value === "string" ? inputEl.value : inputEl.textContent ?? "";
        if (!text.trimStart().startsWith("{")) return values;
        if (currentScriptFolder() !== scriptFolder) scheduleRefresh();
        const tokens = placeholderTokens();
        return [...tokens, ...values.filter((v) => !tokens.includes(v))];
      };
      metadataCache.getFrontmatterPropertyValuesForKey = wrapped;
      plugin.register(() => {
        if (metadataCache.getFrontmatterPropertyValuesForKey === wrapped) {
          metadataCache.getFrontmatterPropertyValuesForKey = original;
        }
      });
    }
    module2.exports = { registerPlaceholderSuggest: registerPlaceholderSuggest2, EDITOR_CLASS };
  }
});

// src/type-frontmatter-editor.js
var require_type_frontmatter_editor = __commonJS({
  "src/type-frontmatter-editor.js"(exports2, module2) {
    var { MarkdownView, Menu } = require("obsidian");
    var { isPlaceholderToken } = require_frontmatter_placeholders();
    var { EDITOR_CLASS: PLACEHOLDER_SUGGEST_EDITOR_CLASS } = require_placeholder_suggest();
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
      editor.containerEl.addClass(PLACEHOLDER_SUGGEST_EDITOR_CLASS);
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

// src/typ-view.js
var require_typ_view = __commonJS({
  "src/typ-view.js"(exports2, module2) {
    var { ItemView, Menu, Modal, Notice, setIcon, debounce } = require("obsidian");
    var { mountTypeFrontmatterEditor, addBlankProperty } = require_type_frontmatter_editor();
    var { FRONTMATTER_PLACEHOLDERS, DYNAMIC_PLACEHOLDER_INFO } = require_frontmatter_placeholders();
    var { normalizeTypeName, compareTypes, sortTypesByMode: sortTypesByMode2 } = require_type_utils();
    var { typeKeyOf, TYP_PROPERTY } = require_typ_index();
    var VIEW_TYPE_TYP = "fred-typ-view";
    var DEFAULT_TYPE_COLOR = "#888888";
    var DEFAULT_SORT_ORDER2 = "count-desc";
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
          text: `${this.affectedCount} Notiz(en) werden auf ${this.newType} umgestellt. Farbe, Beschreibung und Standard-Frontmatter von ${this.oldType} entfallen.`
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
        this.registerDomEvent(this.contentEl, "keydown", (event) => {
          if (event.key === "Escape" && this.selectedType !== null) this.closeTypeSettings();
        });
        this.render();
      }
      async onClose() {
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
          const { contentEl } = this;
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
        const { contentEl } = this;
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
      // behält seine).
      async mergeType(source, target) {
        const settings = this.plugin.settings;
        const renamed = await renameTypeInNotes(this.plugin, source, target);
        settings.types = settings.types.filter((t) => t !== source);
        delete settings.typeColors[source];
        delete settings.typeDescriptions[source];
        delete settings.typeDefaultFrontmatter[source];
        delete settings.typeFloatingKeys[source];
        delete this.ensureTypeManual()[source];
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

// src/property-rename-sync.js
var require_property_rename_sync = __commonJS({
  "src/property-rename-sync.js"(exports2, module2) {
    var { Notice } = require("obsidian");
    var TYP_PROPERTY = "TYP";
    function sameKey(a, b) {
      return a.toLowerCase() === b.toLowerCase();
    }
    function isEmptyValue(value) {
      return value === null || value === void 0 || value === "";
    }
    function renameInType(settings, type, oldKey, newKey) {
      const defaults = settings.typeDefaultFrontmatter[type];
      if (!defaults) return false;
      const keys = Object.keys(defaults);
      const sourceKey = keys.find((key) => sameKey(key, oldKey));
      if (sourceKey === void 0) return false;
      const targetKey = keys.find((key) => key !== sourceKey && sameKey(key, newKey));
      if (targetKey === void 0 && sourceKey === newKey) return false;
      const next = {};
      for (const key of keys) {
        if (key !== sourceKey) {
          next[key] = defaults[key];
        } else if (targetKey === void 0) {
          next[newKey] = defaults[sourceKey];
        }
      }
      if (targetKey !== void 0 && isEmptyValue(next[targetKey])) next[targetKey] = defaults[sourceKey];
      settings.typeDefaultFrontmatter[type] = next;
      const floating = settings.typeFloatingKeys[type];
      if (floating) {
        const nextFloating = targetKey !== void 0 ? floating.filter((key) => key !== sourceKey) : floating.map((key) => key === sourceKey ? newKey : key);
        if (nextFloating.length > 0) settings.typeFloatingKeys[type] = nextFloating;
        else delete settings.typeFloatingKeys[type];
      }
      return true;
    }
    function renameInGlobalOrder(settings, oldKey, newKey) {
      const order = settings.globalPropertyOrder;
      const source = order.find((entry) => entry.kind === "property" && sameKey(entry.name, oldKey));
      if (!source) return false;
      const target = order.find((entry) => entry !== source && entry.kind === "property" && sameKey(entry.name, newKey));
      if (target) settings.globalPropertyOrder = order.filter((entry) => entry !== source);
      else if (source.name === newKey) return false;
      else source.name = newKey;
      return true;
    }
    async function syncRename(plugin, oldKey, newKey) {
      if (typeof oldKey !== "string" || typeof newKey !== "string") return;
      newKey = newKey.trim();
      if (oldKey === "" || newKey === "" || oldKey === newKey) return;
      if (sameKey(oldKey, TYP_PROPERTY) || sameKey(newKey, TYP_PROPERTY)) return;
      const { settings } = plugin;
      let typeCount = 0;
      for (const type of Object.keys(settings.typeDefaultFrontmatter)) {
        if (renameInType(settings, type, oldKey, newKey)) typeCount++;
      }
      const orderChanged = renameInGlobalOrder(settings, oldKey, newKey);
      if (typeCount === 0 && !orderChanged) return;
      await plugin.saveSettings();
      plugin.refreshTypColors?.();
      const parts = [];
      if (typeCount > 0) parts.push(`${typeCount} TYP${typeCount === 1 ? "" : "en"}`);
      if (orderChanged) parts.push("globaler Reihenfolge");
      new Notice(`TYP-System: \u201E${oldKey}\u201C \u2192 \u201E${newKey}\u201C in ${parts.join(" und ")} umbenannt.`);
    }
    function registerPropertyRenameSync2(plugin) {
      const fileManager = plugin.app.fileManager;
      if (fileManager.__fredTypRenameSyncPatched) return;
      fileManager.__fredTypRenameSyncPatched = true;
      const original = fileManager.renameProperty;
      fileManager.renameProperty = async function(oldKey, newKey, ...rest) {
        const result = await original.call(this, oldKey, newKey, ...rest);
        try {
          await syncRename(plugin, oldKey, newKey);
        } catch (error) {
          console.error("TYP-System: Property-Umbenennung nicht \xFCbernommen", error);
          new Notice(`TYP-System: Umbenennung von \u201E${oldKey}\u201C nicht \xFCbernommen \u2013 ${error.message}`);
        }
        return result;
      };
      plugin.register(() => {
        fileManager.renameProperty = original;
        delete fileManager.__fredTypRenameSyncPatched;
      });
    }
    module2.exports = { registerPropertyRenameSync: registerPropertyRenameSync2 };
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
var { registerPropertyRenameSync } = require_property_rename_sync();
var { normalizeGlobalOrder } = require_frontmatter_sort();
var { resolveFrontmatterPlaceholders, DYNAMIC_PLACEHOLDER_PATTERN } = require_frontmatter_placeholders();
var { pickType: pickTypeModal } = require_type_picker();
var { registerPlaceholderSuggest } = require_placeholder_suggest();
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
    registerPropertyRenameSync(this);
    registerPlaceholderSuggest(this);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL2Zyb250bWF0dGVyLXNvcnQuanMiLCAic3JjL2Zyb250bWF0dGVyLW9yZGVyLWVkaXRvci5qcyIsICJzcmMvc2V0dGluZ3MuanMiLCAic3JjL2NvbW1hbmRzLmpzIiwgInNyYy9mcm9udG1hdHRlci1wbGFjZWhvbGRlcnMuanMiLCAic3JjL3BsYWNlaG9sZGVyLXN1Z2dlc3QuanMiLCAic3JjL3R5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzIiwgInNyYy90eXBlLXV0aWxzLmpzIiwgInNyYy90eXAtaW5kZXguanMiLCAic3JjL3R5cC12aWV3LmpzIiwgInNyYy90eXBlLWNvbG9ycy5qcyIsICJzcmMvZmlsZS1leHBsb3Jlci1jb2xvcnMuanMiLCAic3JjL2dyYXBoLWNvbG9ycy5qcyIsICJzcmMvc2VhcmNoLWNvbG9ycy5qcyIsICJzcmMvcmVjZW50LWZpbGVzLWNvbG9ycy5qcyIsICJzcmMvYmFja2xpbmstY29sb3JzLmpzIiwgInNyYy9ib29rbWFyay1jb2xvcnMuanMiLCAic3JjL2FjdGl2ZS10aXRsZS1jb2xvcnMuanMiLCAic3JjL2xpbmstY29sb3JzLmpzIiwgInNyYy9mcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodC5qcyIsICJzcmMvcHJvcGVydHktcmVuYW1lLXN5bmMuanMiLCAic3JjL3R5cGUtcGlja2VyLmpzIiwgInNyYy9tYWluLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBUWVBfUFJPUEVSVFkgPSBcIlRZUFwiO1xuY29uc3QgU1VCVFlQX1BST1BFUlRZID0gXCJTVUJUWVBcIjtcblxuLy8gV2lyZCBhdWNoIHZvbiBzZXR0aW5ncy5qcyAoRGVmYXVsdCBmXHUwMEZDciBnbG9iYWxQcm9wZXJ0eU9yZGVyKSBzb3dpZSB2b21cbi8vIE9yZGVyLUVkaXRvciBiZW51dHp0IC0gYWxsZSB2aWVyIFBsYXR6aGFsdGVyLUJsXHUwMEY2Y2tlIHNpbmQgZG9ydCBwZXIgVUkgbmljaHRcbi8vIGVudGZlcm5iYXIsIG51ciB2ZXJzY2hpZWJiYXIgKHNpZWhlIGZyb250bWF0dGVyLW9yZGVyLWVkaXRvci5qcykuXG4vLyBcInR5cFZhbHVlXCIgaXN0IGRpZSBUWVAtUHJvcGVydHkgc2VsYnN0LCBcInN1YnR5cFZhbHVlXCIgYW5hbG9nIGRpZSBTVUJUWVAtXG4vLyBQcm9wZXJ0eSwgXCJ0eXBcIiBkaWUgU3RhbmRhcmQtRnJvbnRtYXR0ZXItTGlzdGUgZGVzIFRZUHMgKHNpZWhlXG4vLyB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcyksIFwib3RoZXJcIiBhbGxlcyBcdTAwRENicmlnZS5cbmNvbnN0IERFRkFVTFRfR0xPQkFMX09SREVSID0gW3sga2luZDogXCJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJzdWJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJ0eXBcIiB9LCB7IGtpbmQ6IFwib3RoZXJcIiB9XTtcblxuLy8gU3RlbGx0IHNpY2hlciwgZGFzcyBnZW5hdSBqZSBlaW4gRWludHJhZyBwcm8gUGxhdHpoYWx0ZXItQXJ0IHZvcmhhbmRlbiBpc3QgLVxuLy8gblx1MDBGNnRpZyBmXHUwMEZDciBCZXN0YW5kc2luc3RhbGxhdGlvbmVuLCBkZXJlbiBnZXNwZWljaGVydGUgZ2xvYmFsUHJvcGVydHlPcmRlclxuLy8gbm9jaCBhdXMgZGVyIFplaXQgdm9yIFwiVFlQIGFscyBMaXN0ZW5laW50cmFnXCIgYnp3LiB2b3IgU1VCVFlQIHN0YW1tdCAoVFlQXG4vLyB3YXIgZGF2b3IgaGFydC1jb2RpZXJ0IGltbWVyIGFuIGVyc3RlciBTdGVsbGUsIGthbSBpbiBkZXIgTGlzdGUgc2VsYnN0XG4vLyBuaWNodCB2b3IpLiBGZWhsZW5kZSBFaW50clx1MDBFNGdlIHdlcmRlbiBhbiBzaW5udm9sbGVyIERlZmF1bHQtUG9zaXRpb24gZXJnXHUwMEU0bnp0LFxuLy8gc3RhdHQgZGllIGJlc3RlaGVuZGUsIHZvbSBOdXR6ZXIgcGVyIERyYWcgJiBEcm9wIGVpbnNvcnRpZXJ0ZSBSZWloZW5mb2xnZVxuLy8gYW56dXRhc3Rlbi4gXCJzdWJ0eXBWYWx1ZVwiIGxhbmRldCBkYWJlaSBkaXJla3QgaGludGVyIFwidHlwVmFsdWVcIiAoZ2FyYW50aWVydFxuLy8genUgZGllc2VtIFplaXRwdW5rdCBzY2hvbiB2b3JoYW5kZW4pLCBzdGF0dCB3aWUgZGllIFx1MDBGQ2JyaWdlbiBQbGF0emhhbHRlclxuLy8gcGF1c2NoYWwgYW4gZGVuIFJhbmQuXG5mdW5jdGlvbiBub3JtYWxpemVHbG9iYWxPcmRlcihvcmRlcikge1xuICBjb25zdCByZXN1bHQgPSBBcnJheS5pc0FycmF5KG9yZGVyKSA/IG9yZGVyLmZpbHRlcigoZW50cnkpID0+IGVudHJ5ICYmIHR5cGVvZiBlbnRyeSA9PT0gXCJvYmplY3RcIikgOiBbXTtcbiAgY29uc3QgaGFzS2luZCA9IChraW5kKSA9PiByZXN1bHQuc29tZSgoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IGtpbmQpO1xuICBpZiAoIWhhc0tpbmQoXCJ0eXBWYWx1ZVwiKSkgcmVzdWx0LnVuc2hpZnQoeyBraW5kOiBcInR5cFZhbHVlXCIgfSk7XG4gIGlmICghaGFzS2luZChcInN1YnR5cFZhbHVlXCIpKSB7XG4gICAgY29uc3QgdHlwVmFsdWVJbmRleCA9IHJlc3VsdC5maW5kSW5kZXgoKGVudHJ5KSA9PiBlbnRyeS5raW5kID09PSBcInR5cFZhbHVlXCIpO1xuICAgIHJlc3VsdC5zcGxpY2UodHlwVmFsdWVJbmRleCArIDEsIDAsIHsga2luZDogXCJzdWJ0eXBWYWx1ZVwiIH0pO1xuICB9XG4gIGlmICghaGFzS2luZChcInR5cFwiKSkgcmVzdWx0LnB1c2goeyBraW5kOiBcInR5cFwiIH0pO1xuICBpZiAoIWhhc0tpbmQoXCJvdGhlclwiKSkgcmVzdWx0LnB1c2goeyBraW5kOiBcIm90aGVyXCIgfSk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICogRnJvbnRtYXR0ZXItU29ydGllcnVuZ1xuICogQnJpbmd0IGRpZSBpbiBlaW5lciBOb3RpeiBWT1JIQU5ERU5FTiBQcm9wZXJ0aWVzIGluIGVpbmUgZmVzdGVcbiAqIFJlaWhlbmZvbGdlIC0genVzYW1tZW5nZXNldHp0IGF1cyAoc2llaGUgZ2xvYmFsUHJvcGVydHlPcmRlcik6XG4gKiAgLSBnbG9iYWwgZmVzdCBwb3NpdGlvbmllcnRlbiBFaW56ZWwtUHJvcGVydGllcyAoei4gQi4gY3NzY2xhc3NlcyxcbiAqICAgIGFsaWFzZXM7IEVpbnN0ZWxsdW5nZW4gLT4gVFlQIC0+IEdsb2JhbGUgUHJvcGVydHktUmVpaGVuZm9sZ2UpLFxuICogIC0gZGVyIFRZUC1Qcm9wZXJ0eSBzZWxic3QsXG4gKiAgLSBkZXIgU1VCVFlQLVByb3BlcnR5IHNlbGJzdCxcbiAqICAtIGRlbSBCbG9jayBcIlRZUCBQcm9wZXJ0aWVzXCIgKFN0YW5kYXJkLUZyb250bWF0dGVyLUxpc3RlIGRlc1xuICogICAgamV3ZWlsaWdlbiBUeXBzLCBzaWVoZSB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcyksIHVuZFxuICogIC0gZGVtIEJsb2NrIFwiU29uc3RpZ2UgUHJvcGVydGllc1wiIChhbGxlcyBcdTAwRENicmlnZSwgaW4gYmlzaGVyaWdlclxuICogICAgUmVpaGVuZm9sZ2UpLlxuICogRXJnXHUwMEU0bnp0IGRhYmVpIGtlaW5lIGZlaGxlbmRlbiBTdGFuZGFyZC1Qcm9wZXJ0aWVzIHVuZCBcdTAwRTRuZGVydCBrZWluZVxuICogV2VydGUgLSByZWluZSBVbXNvcnRpZXJ1bmcgZGVyIGJlcmVpdHMgdm9yaGFuZGVuZW4gWmVpbGVuLlxuICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovXG5cbi8vIFN0YW5kYXJkLVByb3BlcnR5LVJlaWhlbmZvbGdlIGVpbmVzIFR5cHMsIGlua2wuIGRlciBkYXJpbiBhbHMgXCJGbG9hdGluZ1xuLy8gUHJvcGVydHlcIiBtYXJraWVydGVuIEtleXMgKHNpZWhlIHR5cGVGbG9hdGluZ0tleXMgaW4gc2V0dGluZ3MuanMpIGFuIGdlbmF1XG4vLyBkZXIgU3RlbGxlLCBhbiBkZXIgc2llIGluIGRlciBMaXN0ZSBzdGVoZW4gLSBvaG5lIFRZUCBzZWxic3QgKGRhcyBpc3QgZG9ydFxuLy8gbnVyIGF1cyBoaXN0b3Jpc2NoZW4gR3JcdTAwRkNuZGVuIGV2dGwuIG5vY2ggZW50aGFsdGVuLCBzaWVoZSBzdHJpcFR5cFByb3BlcnR5KVxuLy8gdW5kIG9obmUgZGllIGxlZXJlIFBsYXR6aGFsdGVyLVplaWxlIGRlcyBFZGl0b3JzIChcIlByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiKS5cbi8vIEZsb2F0aW5nIFByb3BlcnRpZXMgd2VyZGVuIG51ciBuaWNodCBhdXRvbWF0aXNjaCB2b24gZ2V0VHlwZURlZmF1bHRzKClcbi8vIChtYWluLmpzKSBhbiBUZW1wbGF0ZXIgYXVzZ2VsaWVmZXJ0LCBzb2xsZW4gYWJlciB0cm90emRlbSBhbiBpaHJlclxuLy8gTGlzdGVucG9zaXRpb24gbGFuZGVuLCBzb2JhbGQgZWluZSBOb3RpeiBzaWUgZG9jaCB0clx1MDBFNGd0LiBudWxsLCB3ZW5uIGtlaW5cbi8vIFR5cCBcdTAwRkNiZXJnZWJlbiB3dXJkZSBvZGVyIGZcdTAwRkNyIGRlbiBUeXAga2VpbmUgU3RhbmRhcmRsaXN0ZSBnZXBmbGVndCBpc3QuXG5mdW5jdGlvbiBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXBlKSB7XG4gIGlmICghdHlwZSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHN0YW5kYXJkID0gcGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0gPz8ge307XG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhzdGFuZGFyZCkuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIiAmJiBrZXkudG9Mb3dlckNhc2UoKSAhPT0gVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCkpO1xuICByZXR1cm4ga2V5cy5sZW5ndGggPiAwID8ga2V5cyA6IG51bGw7XG59XG5cbi8vIFJlaWhlbmZvbGdlLCBpbiBkZXIgZGllIHZvcmhhbmRlbmVuIFByb3BlcnRpZXMgZWluZXIgTm90aXogc3RlaGVuIHNvbGxlbiAtXG4vLyBiZXN0aW1tdCBrb21wbGV0dCBkdXJjaCBnbG9iYWxPcmRlcjogZWluemVsbmUgUHJvcGVydGllcyBhbiBmZXN0ZXJcbi8vIFBvc2l0aW9uLCBzb3dpZSBkaWUgUGxhdHpoYWx0ZXIgXCJ0eXBWYWx1ZVwiIChkaWUgVFlQLVByb3BlcnR5IHNlbGJzdCksXG4vLyBcInN1YnR5cFZhbHVlXCIgKGRpZSBTVUJUWVAtUHJvcGVydHkgc2VsYnN0KSwgXCJ0eXBcIiAoU3RhbmRhcmRsaXN0ZSBkZXMgVHlwcylcbi8vIHVuZCBcIm90aGVyXCIgKGFsbGVzIFx1MDBEQ2JyaWdlKS5cbi8vXG4vLyBXZWxjaGVyIEJsb2NrIGVpbmUgUHJvcGVydHkgYmVhbnNwcnVjaHQsIHdpcmQgVk9SIGRlbSBlaWdlbnRsaWNoZW4gQXVmYmF1XG4vLyBkZXIgUmVpaGVuZm9sZ2UgZmVzdHN0ZWhlbmQgYmVzdGltbXQgKHBpbm5lZC90eXBCbG9jay9SZXN0IHNpbmQgZGlzanVua3QpIC1cbi8vIG5pY2h0IGVyc3QgYmVpbSBsaW5lYXJlbiBEdXJjaGxhdWYgdm9uIGdsb2JhbE9yZGVyLiBEYXMgbWFjaHQgZGllXG4vLyBCbG9jay1adW9yZG51bmcgdW5hYmhcdTAwRTRuZ2lnIGRhdm9uLCBpbiB3ZWxjaGVyIFJlaWhlbmZvbGdlIGRpZSBCbFx1MDBGNmNrZSBpblxuLy8gZ2xvYmFsT3JkZXIgc3RlaGVuOiBlaW5lIGdsb2JhbCBmZXN0IHBvc2l0aW9uaWVydGUgUHJvcGVydHkgZ2VoXHUwMEY2cnQgaW1tZXIgenVcbi8vIGlocmVtIGVpZ2VuZW4gRWludHJhZyAobmllIHp1c1x1MDBFNHR6bGljaCB6dW0gVHlwLUJsb2NrLCBzZWxic3Qgd2VubiBcIlRZUFxuLy8gUHJvcGVydGllc1wiIHZvcmhlciBpbiBkZXIgTGlzdGUgc3RlaHQpLCB1bmQgXCJTb25zdGlnZSBQcm9wZXJ0aWVzXCIgZW50aFx1MDBFNGx0XG4vLyBpbW1lciBudXIgZWNodGUgUmVzdGJlc3RcdTAwRTRuZGUgKG5pZSB2ZXJzZWhlbnRsaWNoIFByb3BlcnRpZXMsIGRpZSBlaWdlbnRsaWNoXG4vLyBlaW5lbSBzcFx1MDBFNHRlciBpbiBkZXIgTGlzdGUgc3RlaGVuZGVuIEJsb2NrIGdlaFx1MDBGNnJlbikuXG5mdW5jdGlvbiBjb21wdXRlU29ydGVkS2V5cyhleGlzdGluZ0tleXMsIGdsb2JhbE9yZGVyLCB0eXBlRGVmYXVsdEtleXMpIHtcbiAgY29uc3QgbG93ZXJUb0FjdHVhbCA9IG5ldyBNYXAoZXhpc3RpbmdLZXlzLm1hcCgoa2V5KSA9PiBba2V5LnRvTG93ZXJDYXNlKCksIGtleV0pKTtcbiAgY29uc3QgcmVzb2x2ZSA9IChuYW1lKSA9PiBsb3dlclRvQWN0dWFsLmdldChuYW1lLnRvTG93ZXJDYXNlKCkpO1xuXG4gIGNvbnN0IHBpbm5lZCA9IG5ldyBTZXQoXG4gICAgZ2xvYmFsT3JkZXJcbiAgICAgIC5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5raW5kID09PSBcInByb3BlcnR5XCIpXG4gICAgICAubWFwKChlbnRyeSkgPT4gcmVzb2x2ZShlbnRyeS5uYW1lKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgKTtcbiAgY29uc3QgdHlwS2V5ID0gcmVzb2x2ZShUWVBfUFJPUEVSVFkpO1xuICBjb25zdCBzdWJ0eXBLZXkgPSByZXNvbHZlKFNVQlRZUF9QUk9QRVJUWSk7XG4gIGNvbnN0IHR5cEJsb2NrS2V5cyA9IG5ldyBTZXQoXG4gICAgKHR5cGVEZWZhdWx0S2V5cyA/PyBbXSkubWFwKHJlc29sdmUpLmZpbHRlcigoa2V5KSA9PiBrZXkgJiYga2V5ICE9PSB0eXBLZXkgJiYgIXBpbm5lZC5oYXMoa2V5KSlcbiAgKTtcbiAgY29uc3QgY2xhaW1lZCA9IG5ldyBTZXQocGlubmVkKTtcbiAgZm9yIChjb25zdCBrZXkgb2YgdHlwQmxvY2tLZXlzKSBjbGFpbWVkLmFkZChrZXkpO1xuICBpZiAodHlwS2V5KSBjbGFpbWVkLmFkZCh0eXBLZXkpO1xuICBpZiAoc3VidHlwS2V5KSBjbGFpbWVkLmFkZChzdWJ0eXBLZXkpO1xuXG4gIGNvbnN0IHNvcnRlZEtleXMgPSBbXTtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcbiAgY29uc3QgcHVzaCA9IChrZXkpID0+IHtcbiAgICBpZiAoa2V5ICYmICFzZWVuLmhhcyhrZXkpKSB7XG4gICAgICBzb3J0ZWRLZXlzLnB1c2goa2V5KTtcbiAgICAgIHNlZW4uYWRkKGtleSk7XG4gICAgfVxuICB9O1xuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgZ2xvYmFsT3JkZXIpIHtcbiAgICBpZiAoZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiKSBwdXNoKHJlc29sdmUoZW50cnkubmFtZSkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwidHlwVmFsdWVcIikgcHVzaCh0eXBLZXkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwic3VidHlwVmFsdWVcIikgcHVzaChzdWJ0eXBLZXkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwidHlwXCIpIHtcbiAgICAgIGZvciAoY29uc3QgbmFtZSBvZiB0eXBlRGVmYXVsdEtleXMgPz8gW10pIHtcbiAgICAgICAgY29uc3Qga2V5ID0gcmVzb2x2ZShuYW1lKTtcbiAgICAgICAgaWYgKGtleSAmJiB0eXBCbG9ja0tleXMuaGFzKGtleSkpIHB1c2goa2V5KTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwib3RoZXJcIikge1xuICAgICAgZm9yIChjb25zdCBrZXkgb2YgZXhpc3RpbmdLZXlzKSB7XG4gICAgICAgIGlmICghY2xhaW1lZC5oYXMoa2V5KSkgcHVzaChrZXkpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFNpY2hlcmhlaXRzbmV0eiwgZmFsbHMgZ2xvYmFsT3JkZXIgdW52b2xsc3RcdTAwRTRuZGlnIGlzdCAoei4gQi4ga29ycnVwdGVcbiAgLy8gRWluc3RlbGx1bmdlbikgLSBkaWUgVUkgdmVyaGluZGVydCBkYXMgZWlnZW50bGljaCAoc2llaGUgbm9ybWFsaXplR2xvYmFsT3JkZXIpLlxuICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIHB1c2goa2V5KTtcbiAgcmV0dXJuIHNvcnRlZEtleXM7XG59XG5cbi8vIFwicG9zaXRpb25cIiBpc3Qga2VpbiBlY2h0ZXMgUHJvcGVydHksIHNvbmRlcm4gT2JzaWRpYW5zIGVpZ2VuZSBBbmdhYmUgenVyXG4vLyBMYWdlIGRlcyBGcm9udG1hdHRlci1CbG9ja3MgaW5uZXJoYWxiIGRlciBEYXRlaSAobnVyIGltIENhY2hlLU9iamVrdFxuLy8gdm9yaGFuZGVuLCBuaWNodCBpbSB2b24gcHJvY2Vzc0Zyb250TWF0dGVyIGdlbGllZmVydGVuIE9iamVrdCkuXG5mdW5jdGlvbiBjYWNoZWRGcm9udG1hdHRlcktleXMoYXBwLCBmaWxlKSB7XG4gIGNvbnN0IGZyb250bWF0dGVyID0gYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcbiAgaWYgKCFmcm9udG1hdHRlcikgcmV0dXJuIG51bGw7XG4gIHJldHVybiBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJwb3NpdGlvblwiKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc29ydEZpbGVGcm9udG1hdHRlcihhcHAsIGZpbGUsIGdsb2JhbE9yZGVyLCB0eXBlRGVmYXVsdEtleXMpIHtcbiAgLy8gR1x1MDBGQ25zdGlnZXIgVm9yYWItQ2hlY2sgXHUwMEZDYmVyIGRlbiBiZXJlaXRzIGltIFNwZWljaGVyIHZvcmhhbmRlbmVuIE1ldGFkYXRhLVxuICAvLyBDYWNoZSAoa2VpbiBEYXRlaS1adWdyaWZmKTogZGVyIE5vcm1hbGZhbGwgLSBlaW5lIE5vdGl6IGlzdCBzY2hvbiBrb3JyZWt0XG4gIC8vIHNvcnRpZXJ0IC0gbFx1MDBFNHNzdCBzaWNoIHNvIGVya2VubmVuLCBvaG5lIGRpZSBEYXRlaSBcdTAwRkNiZXIgcHJvY2Vzc0Zyb250TWF0dGVyXG4gIC8vIFx1MDBGQ2JlcmhhdXB0IHp1IFx1MDBGNmZmbmVuLiBEYXMgaXN0IGJlaSB3aWVkZXJob2x0ZW4gTFx1MDBFNHVmZW4gXHUwMEZDYmVyIGRlbiBnYW56ZW5cbiAgLy8gVmF1bHQgZGVyIExcdTAwRjZ3ZW5hbnRlaWwgZGVyIE5vdGl6ZW4gdW5kIGRhbWl0IGRlciBlaWdlbnRsaWNoZSBHZXNjaHdpbmRpZy1cbiAgLy8ga2VpdHNnZXdpbm4uIHByb2Nlc3NGcm9udE1hdHRlciBibGVpYnQgdHJvdHpkZW0gZGllIGFsbGVpbmlnZSBRdWVsbGUgZGVyXG4gIC8vIFdhaHJoZWl0IGZcdTAwRkNyIGRlbiB0YXRzXHUwMEU0Y2hsaWNoZW4gU2NocmVpYnZvcmdhbmcgKENhY2hlIGthbm4ga3VyenplaXRpZ1xuICAvLyB2ZXJhbHRldCBzZWluKSAtIGRlciBWb3JhYi1DaGVjayBcdTAwRkNiZXJzcHJpbmd0IG51ciBzaWNoZXIgdW52ZXJcdTAwRTRuZGVydGUgRlx1MDBFNGxsZS5cbiAgY29uc3QgY2FjaGVkS2V5cyA9IGNhY2hlZEZyb250bWF0dGVyS2V5cyhhcHAsIGZpbGUpO1xuICBpZiAoIWNhY2hlZEtleXMgfHwgY2FjaGVkS2V5cy5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBjYWNoZWRTb3J0ZWQgPSBjb21wdXRlU29ydGVkS2V5cyhjYWNoZWRLZXlzLCBnbG9iYWxPcmRlciwgdHlwZURlZmF1bHRLZXlzKTtcbiAgaWYgKGNhY2hlZFNvcnRlZC5ldmVyeSgoa2V5LCBpKSA9PiBrZXkgPT09IGNhY2hlZEtleXNbaV0pKSByZXR1cm4gZmFsc2U7XG5cbiAgbGV0IGNoYW5nZWQgPSBmYWxzZTtcbiAgYXdhaXQgYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZnJvbnRtYXR0ZXIpID0+IHtcbiAgICBjb25zdCBleGlzdGluZ0tleXMgPSBPYmplY3Qua2V5cyhmcm9udG1hdHRlcik7XG4gICAgaWYgKGV4aXN0aW5nS2V5cy5sZW5ndGggPD0gMSkgcmV0dXJuO1xuXG4gICAgY29uc3Qgc29ydGVkS2V5cyA9IGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cyk7XG4gICAgaWYgKHNvcnRlZEtleXMuZXZlcnkoKGtleSwgaSkgPT4ga2V5ID09PSBleGlzdGluZ0tleXNbaV0pKSByZXR1cm47XG5cbiAgICAvLyBJbi1wbGFjZSB1bXNvcnRpZXJlbiAoc2llaGUgS29tbWVudGFyIGluIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzIHp1XG4gICAgLy8gc2F2ZUZyb250bWF0dGVyL3N0cmlwVHlwUHJvcGVydHkpOiBPYmpla3QtSW5zZXJ0aW9uLU9yZGVyIGJlc3RpbW10IGRpZVxuICAgIC8vIHNwXHUwMEU0dGVyZSBZQU1MLVJlaWhlbmZvbGdlLCBkYWhlciBhbGxlIEtleXMgbFx1MDBGNnNjaGVuIHVuZCBpbiBuZXVlclxuICAgIC8vIFJlaWhlbmZvbGdlIHdpZWRlciBlaW5mXHUwMEZDZ2VuLCBzdGF0dCBlaW4gbmV1ZXMgT2JqZWt0IHp1clx1MDBGQ2NrenVnZWJlbi5cbiAgICBjb25zdCBzbmFwc2hvdCA9IHsgLi4uZnJvbnRtYXR0ZXIgfTtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICAgIGZvciAoY29uc3Qga2V5IG9mIHNvcnRlZEtleXMpIGZyb250bWF0dGVyW2tleV0gPSBzbmFwc2hvdFtrZXldO1xuICAgIGNoYW5nZWQgPSB0cnVlO1xuICB9KTtcbiAgcmV0dXJuIGNoYW5nZWQ7XG59XG5cbi8vIFNvcnRpZXJ0IGVpbmUgZWluemVsbmUsIGJlcmVpdHMgYmVrYW5udGUgTm90aXogKHouIEIuIGRpZSBha3RpdmUgRGF0ZWkpLlxuYXN5bmMgZnVuY3Rpb24gc29ydFNpbmdsZUZpbGVGcm9udG1hdHRlcihhcHAsIHBsdWdpbiwgZmlsZSkge1xuICBjb25zdCBnbG9iYWxPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcbiAgLy8gVW5zYXViZXJlIFRZUC1XZXJ0ZSAoTGlzdGUsIFJhbmRsZWVyemVpY2hlbikgaGFiZW4ga2VpbmUgU3RhbmRhcmRsaXN0ZSAtXG4gIC8vIGRhbm4gZ3JlaWZ0IG51ciBkaWUgZ2xvYmFsZSBSZWloZW5mb2xnZSAoc2llaGUgdHlwZUtleU9mIGluIHR5cC1pbmRleC5qcykuXG4gIGNvbnN0IHR5cGUgPSBwbHVnaW4udHlwSW5kZXgudHlwZU9mKGZpbGUpO1xuICBjb25zdCB0eXBlRGVmYXVsdEtleXMgPSBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXBlKTtcbiAgcmV0dXJuIHNvcnRGaWxlRnJvbnRtYXR0ZXIoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwZURlZmF1bHRLZXlzKTtcbn1cblxuLy8gb25seVR5cGU6IG9wdGlvbmFsIC0gYmVzY2hyXHUwMEU0bmt0IGRlbiBMYXVmIGF1ZiBOb3RpemVuIGdlbmF1IGRpZXNlcyBUeXBzLlxuLy8gT2huZSBvbmx5VHlwZSB3ZXJkZW4gYWxsZSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgYXVjaCBvaG5lIFRZUCBvZGVyIG1pdCBlaW5lbSBUeXBcbi8vIG9obmUgZ2VwZmxlZ3RlIFN0YW5kYXJkbGlzdGUgLSBkaWUgZ2xvYmFsIGZlc3QgcG9zaXRpb25pZXJ0ZW4gUHJvcGVydGllc1xuLy8gKHouIEIuIGNzc2NsYXNzZXMpIHNvbGxlbiB1bmFiaFx1MDBFNG5naWcgdm9tIFR5cCB3aXJrZW4ga1x1MDBGNm5uZW4uIEZcdTAwRkNyIE5vdGl6ZW4sIGJlaVxuLy8gZGVuZW4gd2VkZXIgZWluIHBhc3NlbmRlciBUeXAtQmxvY2sgbm9jaCBlaW5lIGRlciBrb25maWd1cmllcnRlblxuLy8gRWluemVsLVByb3BlcnRpZXMgZ3JlaWZ0LCBibGVpYnQgZGllIGJpc2hlcmlnZSBSZWloZW5mb2xnZSB1bnZlclx1MDBFNG5kZXJ0LlxuYXN5bmMgZnVuY3Rpb24gc29ydEFsbEZyb250bWF0dGVyKGFwcCwgcGx1Z2luLCBvbmx5VHlwZSkge1xuICBsZXQgY2hlY2tlZCA9IDA7XG4gIGxldCBjaGFuZ2VkID0gMDtcbiAgY29uc3QgZ2xvYmFsT3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcihwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XG4gIC8vIE51ciBhdXNzYWdla3JcdTAwRTRmdGlnLCB3ZW5uIGVpbiBlaW56ZWxuZXIgVHlwIGVpbmdlZ3Jlbnp0IHd1cmRlIChzb25zdFxuICAvLyB3ZWNoc2VsdCBkZXIgVHlwIHZvbiBEYXRlaSB6dSBEYXRlaSkgLSBmXHUwMEZDciBkaWUgUlx1MDBGQ2NrbWVsZHVuZyBkZXMgQmVmZWhsc1xuICAvLyBcIlRZUCBGcm9udG1hdHRlciBTb3J0aWVydW5nIGFrdHVhbGlzaWVyZW5cIiwgZmFsbHMgZlx1MDBGQ3IgZGVuIGdld1x1MDBFNGhsdGVuIFR5cFxuICAvLyBnYXIga2VpbmUgU3RhbmRhcmQtRnJvbnRtYXR0ZXItTGlzdGUgZ2VwZmxlZ3QgaXN0LlxuICBjb25zdCBoYXNUeXBlRGVmYXVsdHMgPSBvbmx5VHlwZSA/IG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIG9ubHlUeXBlKSAhPT0gbnVsbCA6IG51bGw7XG5cbiAgZm9yIChjb25zdCBmaWxlIG9mIGFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkpIHtcbiAgICBpZiAoIXBsdWdpbi5zZXR0aW5ncy5pbmNsdWRlSWdub3JlZEZpbGVzICYmIGFwcC5tZXRhZGF0YUNhY2hlLmlzVXNlcklnbm9yZWQoZmlsZS5wYXRoKSkgY29udGludWU7XG5cbiAgICBjb25zdCB0eXBlID0gcGx1Z2luLnR5cEluZGV4LnR5cGVPZihmaWxlKTtcbiAgICBpZiAob25seVR5cGUgJiYgdHlwZSAhPT0gb25seVR5cGUpIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgdHlwZURlZmF1bHRLZXlzID0gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwZSk7XG4gICAgY2hlY2tlZCsrO1xuICAgIGlmIChhd2FpdCBzb3J0RmlsZUZyb250bWF0dGVyKGFwcCwgZmlsZSwgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cykpIGNoYW5nZWQrKztcbiAgfVxuXG4gIHJldHVybiB7IGNoZWNrZWQsIGNoYW5nZWQsIGhhc1R5cGVEZWZhdWx0cyB9O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgc29ydEFsbEZyb250bWF0dGVyLFxuICBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyLFxuICBub3JtYWxpemVHbG9iYWxPcmRlcixcbiAgREVGQVVMVF9HTE9CQUxfT1JERVIsXG4gIFRZUF9QUk9QRVJUWSxcbiAgU1VCVFlQX1BST1BFUlRZLFxufTtcbiIsICJjb25zdCB7IHNldEljb24sIE5vdGljZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSwgc29ydEFsbEZyb250bWF0dGVyIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuXG4vLyBBbnplaWdldGV4dCBkZXIgdmllciBuaWNodCBlbnRmZXJuYmFyZW4gUGxhdHpoYWx0ZXItWmVpbGVuIC0gXCJ0eXBWYWx1ZVwiIGlzdFxuLy8gZGllIFRZUC1Qcm9wZXJ0eSBzZWxic3QsIFwic3VidHlwVmFsdWVcIiBhbmFsb2cgZGllIFNVQlRZUC1Qcm9wZXJ0eSwgXCJ0eXBcIlxuLy8gZGllIFN0YW5kYXJkLUZyb250bWF0dGVyLUxpc3RlIGRlcyBUWVBzIChzaWVoZVxuLy8gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLCBcIm90aGVyXCIgYWxsZSBQcm9wZXJ0aWVzLCBkaWUgd2VkZXIgZG9ydCBub2NoXG4vLyBpbiBkaWVzZXIgTGlzdGUgbmFtZW50bGljaCBnZWZcdTAwRkNocnQgd2VyZGVuLiBTaWVoZSBjb21wdXRlU29ydGVkS2V5cyBpblxuLy8gZnJvbnRtYXR0ZXItc29ydC5qcyBmXHUwMEZDciBkaWUgdGF0c1x1MDBFNGNobGljaGUgQXVmbFx1MDBGNnN1bmcgZGllc2VyIEJsXHUwMEY2Y2tlLlxuY29uc3QgUExBQ0VIT0xERVJfTEFCRUxTID0ge1xuICB0eXBWYWx1ZTogXCJUWVBcIixcbiAgc3VidHlwVmFsdWU6IFwiU1VCVFlQXCIsXG4gIHR5cDogXCJUWVAgUHJvcGVydGllc1wiLFxuICBvdGhlcjogXCJTb25zdGlnZSBQcm9wZXJ0aWVzXCIsXG59O1xuXG4vLyBFZGl0b3IgZlx1MDBGQ3IgcGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXI6IGVpbmUgcmVpbmUgTmFtZW5zbGlzdGVcbi8vIChrZWluZSBXZXJ0ZSwgZGFoZXIga2VpbiBlaWdlbmVyIHByaXZhdGUtQVBJLVVtd2VnIFx1MDBGQ2JlciBPYnNpZGlhbnNcbi8vIE1ldGFkYXRhLUVkaXRvci1XaWRnZXQgd2llIGluIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzIG5cdTAwRjZ0aWcpIG1pdFxuLy8gRHJhZy1hbmQtZHJvcC1Tb3J0aWVydW5nLiBEaWUgZHJlaSBQbGF0emhhbHRlci1aZWlsZW4gc2luZCBUZWlsIGRlcnNlbGJlblxuLy8gTGlzdGUsIGxhc3NlbiBzaWNoIHZlcnNjaGllYmVuLCBhYmVyIG5pY2h0IHBlciBVSSBlbnRmZXJuZW4uXG5mdW5jdGlvbiBtb3VudEdsb2JhbE9yZGVyRWRpdG9yKGNvbnRhaW5lckVsLCBwbHVnaW4pIHtcbiAgY29uc3QgaGVhZGVyID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLWhlYWRlclwiIH0pO1xuXG4gIC8vIEVpZ2VuZSBHcnVwcGUgZlx1MDBGQ3IgQnV0dG9uICsgXHUwMERDYmVyc2NocmlmdCwgc3RhdHQgYmVpZGUgYWxzIGdldHJlbm50ZSBLaW5kZXJcbiAgLy8gdm9uIGhlYWRlciBkaXJla3Q6IGJlaSBqdXN0aWZ5LWNvbnRlbnQ6IHNwYWNlLWJldHdlZW4gKHNpZWhlIENTUykgd1x1MDBGQ3JkZVxuICAvLyBlaW4gZHJpdHRlcyBLaW5kIHp3aXNjaGVuIFx1MDBEQ2JlcnNjaHJpZnQgdW5kIFwiK1wiLUJ1dHRvbiBzb25zdCBtaXR0aWcgaW1cbiAgLy8gdmVyYmxlaWJlbmRlbiBQbGF0eiBsYW5kZW4sIHN0YXR0IGRpcmVrdCBuZWJlbiBkZXIgXHUwMERDYmVyc2NocmlmdCB6dSBzaXR6ZW4uXG4gIGNvbnN0IHRpdGxlR3JvdXAgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XG5cbiAgLy8gV2VuZGV0IGRpZSBha3R1ZWxsZSBSZWloZW5mb2xnZSBzb2ZvcnQgYXVmIGRlbiBnZXNhbXRlbiBWYXVsdCBhbiAtIGRlcnNlbGJlXG4gIC8vIExhdWYgd2llIGRlciBCZWZlaGwgXCJGcm9udG1hdHRlciBTb3J0aWVydW5nIEdMT0JBTCBha3R1YWxpc2llcmVuXCJcbiAgLy8gKHNvcnRBbGxGcm9udG1hdHRlciBtaXQgb25seVR5cGUgbnVsbCksIG51ciBkaXJla3QgbmViZW4gZGVyIExpc3RlXG4gIC8vIGVycmVpY2hiYXIgc3RhdHQgXHUwMEZDYmVyIGRpZSBCZWZlaGxzcGFsZXR0ZS5cbiAgY29uc3QgYXBwbHlCdG4gPSB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvblwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkF1ZiBhbGxlIE5vdGl6ZW4gYW53ZW5kZW5cIiB9IH0pO1xuICBzZXRJY29uKGFwcGx5QnRuLCBcInBsYXlcIik7XG4gIGFwcGx5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHsgY2hlY2tlZCwgY2hhbmdlZCB9ID0gYXdhaXQgc29ydEFsbEZyb250bWF0dGVyKHBsdWdpbi5hcHAsIHBsdWdpbiwgbnVsbCk7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICBjaGFuZ2VkID4gMFxuICAgICAgICAgID8gYEZyb250bWF0dGVyIFNvcnRpZXJ1bmc6ICR7Y2hlY2tlZH0gTm90aXplbiBnZXByXHUwMEZDZnQsICR7Y2hhbmdlZH0gc29ydGllcnQuYFxuICAgICAgICAgIDogYEZyb250bWF0dGVyIFNvcnRpZXJ1bmc6ICR7Y2hlY2tlZH0gTm90aXplbiBnZXByXHUwMEZDZnQsIGJlcmVpdHMgYWxsZSBzb3J0aWVydC5gXG4gICAgICApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiW0Zyb250bWF0dGVyIFNvcnRpZXJ1bmddXCIsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoYEZyb250bWF0dGVyIFNvcnRpZXJ1bmcgZmVobGdlc2NobGFnZW46ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG4gIH0pO1xuXG4gIHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IFwiR2xvYmFsZSBQcm9wZXJ0eS1SZWloZW5mb2xnZVwiIH0pO1xuXG4gIGNvbnN0IGFkZEJ0biA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb25cIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJQcm9wZXJ0eSBoaW56dWZcdTAwRkNnZW5cIiB9IH0pO1xuICBzZXRJY29uKGFkZEJ0biwgXCJwbHVzXCIpO1xuXG4gIGNvbnN0IGxpc3RFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLW9yZGVyLWxpc3RcIiB9KTtcblxuICBjb25zdCBvcmRlciA9ICgpID0+IHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyO1xuXG4gIC8vIE5ldWUgWmVpbGUgd2lyZCBlcnN0IGJlaSBlaW5lbSBnXHUwMEZDbHRpZ2VuLCBuaWNodC1sZWVyZW4gTmFtZW4gdGF0c1x1MDBFNGNobGljaCBpblxuICAvLyBwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlciBhdWZnZW5vbW1lbiAodW5kIGRhbWl0IHBvdGVuemllbGxcbiAgLy8gZ2VzcGVpY2hlcnQpIC0gYmlzIGRhaGluIGV4aXN0aWVydCBzaWUgbnVyIGFscyBsb2thbGVyIEVudHd1cmYsIGRlciBiZWltXG4gIC8vIFJlLVJlbmRlciB6dXNcdTAwRTR0emxpY2ggYW5zIEVuZGUgZGVyIGVjaHRlbiBMaXN0ZSBnZWhcdTAwRTRuZ3Qgd2lyZC4gU28gbGFuZGVuXG4gIC8vIGxlZXJlIFByb3BlcnR5LUZlbGRlciBuaWUgaW4gZGVuIEVpbnN0ZWxsdW5nZW4sIHNlbGJzdCB3ZW5uIHp3aXNjaGVuZHVyY2hcbiAgLy8gYXVzIGFuZGVyZW0gQW5sYXNzICh6LiBCLiBWZXJzY2hpZWJlbiBlaW5lciBhbmRlcmVuIFplaWxlKSBnZXNwZWljaGVydCB3aXJkLlxuICBsZXQgZHJhZnRFbnRyeSA9IG51bGw7XG5cbiAgY29uc3QgaXNEdXBsaWNhdGVOYW1lID0gKHZhbHVlLCBvd25FbnRyeSkgPT4ge1xuICAgIGNvbnN0IGxvd2VyID0gdmFsdWUudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAobG93ZXIgPT09IFRZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpIHx8IGxvd2VyID09PSBTVUJUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSkgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuIG9yZGVyKCkuc29tZSgob3RoZXIpID0+IG90aGVyICE9PSBvd25FbnRyeSAmJiBvdGhlci5raW5kID09PSBcInByb3BlcnR5XCIgJiYgb3RoZXIubmFtZS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcik7XG4gIH07XG5cbiAgY29uc3QgcmVuZGVyID0gKCkgPT4ge1xuICAgIGxpc3RFbC5lbXB0eSgpO1xuICAgIGNvbnN0IGVudHJpZXMgPSBkcmFmdEVudHJ5ID8gWy4uLm9yZGVyKCksIGRyYWZ0RW50cnldIDogb3JkZXIoKTtcblxuICAgIGVudHJpZXMuZm9yRWFjaCgoZW50cnksIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBpc0RyYWZ0ID0gZW50cnkgPT09IGRyYWZ0RW50cnk7XG4gICAgICBjb25zdCBpc1BsYWNlaG9sZGVyID0gZW50cnkua2luZCAhPT0gXCJwcm9wZXJ0eVwiO1xuICAgICAgY29uc3Qgcm93Q2xzID1cbiAgICAgICAgXCJmcmVkLW9yZGVyLXJvd1wiICsgKGlzUGxhY2Vob2xkZXIgPyBcIiBpcy1wbGFjZWhvbGRlclwiIDogXCJcIikgKyAoZW50cnkua2luZCA9PT0gXCJ0eXBcIiA/IFwiIGlzLXR5cC1kZWZhdWx0c1wiIDogXCJcIik7XG4gICAgICBjb25zdCByb3cgPSBsaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiByb3dDbHMgfSk7XG5cbiAgICAgIGNvbnN0IGRyYWdIYW5kbGUgPSByb3cuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtb3JkZXItZHJhZ1wiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlZlcnNjaGllYmVuXCIgfSB9KTtcbiAgICAgIHNldEljb24oZHJhZ0hhbmRsZSwgXCJncmlwLXZlcnRpY2FsXCIpO1xuXG4gICAgICBpZiAoaXNQbGFjZWhvbGRlcikge1xuICAgICAgICByb3cuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtb3JkZXItbGFiZWxcIiwgdGV4dDogUExBQ0VIT0xERVJfTEFCRUxTW2VudHJ5LmtpbmRdIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgaW5wdXQgPSByb3cuY3JlYXRlRWwoXCJpbnB1dFwiLCB7XG4gICAgICAgICAgdHlwZTogXCJ0ZXh0XCIsXG4gICAgICAgICAgY2xzOiBcImZyZWQtb3JkZXItbmFtZS1pbnB1dFwiLFxuICAgICAgICAgIGF0dHI6IHsgcGxhY2Vob2xkZXI6IFwiUHJvcGVydHktTmFtZVwiIH0sXG4gICAgICAgIH0pO1xuICAgICAgICBpbnB1dC52YWx1ZSA9IGVudHJ5Lm5hbWU7XG5cbiAgICAgICAgLy8gXCJibHVyXCIgc3RhdHQgXCJjaGFuZ2VcIjogTGV0enRlcmVzIGZldWVydCBiZWkgZWluZW0gbGVlciBnZWJsaWViZW5lblxuICAgICAgICAvLyBGZWxkIGdhciBuaWNodCBlcnN0IChCcm93c2VyIHNlaGVuIGRhcmluIGtlaW5lIFdlcnRcdTAwRTRuZGVydW5nKSAtIGRlclxuICAgICAgICAvLyBFbnR3dXJmIHdcdTAwRkNyZGUgZGFubiBuaWUgYXVmZ2VyXHUwMEU0dW10LiBcImJsdXJcIiBncmVpZnQgenV2ZXJsXHUwMEU0c3NpZyBpblxuICAgICAgICAvLyBiZWlkZW4gRlx1MDBFNGxsZW4gKHVtYmVuZW5uZW4gd2llIGxlZXIgbGFzc2VuKS5cbiAgICAgICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gaW5wdXQudmFsdWUudHJpbSgpO1xuXG4gICAgICAgICAgaWYgKCF2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKGlzRHJhZnQpIHtcbiAgICAgICAgICAgICAgZHJhZnRFbnRyeSA9IG51bGw7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBvcmRlcigpLnNwbGljZShvcmRlcigpLmluZGV4T2YoZW50cnkpLCAxKTtcbiAgICAgICAgICAgICAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVuZGVyKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGlzRHVwbGljYXRlTmFtZSh2YWx1ZSwgaXNEcmFmdCA/IG51bGwgOiBlbnRyeSkpIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoYFwiJHt2YWx1ZX1cIiBpc3QgYmVyZWl0cyBpbiBkZXIgTGlzdGUuYCk7XG4gICAgICAgICAgICBpbnB1dC52YWx1ZSA9IGVudHJ5Lm5hbWU7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZW50cnkubmFtZSA9IHZhbHVlO1xuICAgICAgICAgIGlmIChpc0RyYWZ0KSB7XG4gICAgICAgICAgICBvcmRlcigpLnB1c2goZW50cnkpO1xuICAgICAgICAgICAgZHJhZnRFbnRyeSA9IG51bGw7XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICByZW5kZXIoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcmVtb3ZlQnRuID0gcm93LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLW9yZGVyLXJlbW92ZSBjbGlja2FibGUtaWNvblwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkVudGZlcm5lblwiIH0gfSk7XG4gICAgICAgIHNldEljb24ocmVtb3ZlQnRuLCBcInhcIik7XG4gICAgICAgIHJlbW92ZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmIChpc0RyYWZ0KSB7XG4gICAgICAgICAgICBkcmFmdEVudHJ5ID0gbnVsbDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgb3JkZXIoKS5zcGxpY2Uob3JkZXIoKS5pbmRleE9mKGVudHJ5KSwgMSk7XG4gICAgICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJlbmRlcigpO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gRGVyIEVudHd1cmYgaGF0IG5vY2gga2VpbmVuIFBsYXR6IGluIGRlciBlY2h0ZW4gTGlzdGUgLSBWZXJzY2hpZWJlblxuICAgICAgLy8gZXJnaWJ0IGZcdTAwRkNyIGlobiBrZWluZW4gU2lubiwgYmV2b3IgZXIgXHUwMEZDYmVyaGF1cHQgZWluZW4gTmFtZW4gaGF0LlxuICAgICAgaWYgKGlzRHJhZnQpIHJldHVybjtcblxuICAgICAgcm93LmRyYWdnYWJsZSA9IHRydWU7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdzdGFydFwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLmVmZmVjdEFsbG93ZWQgPSBcIm1vdmVcIjtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLnNldERhdGEoXCJ0ZXh0L3BsYWluXCIsIFN0cmluZyhpbmRleCkpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LmFkZChcImlzLWRyYWdnaW5nXCIpO1xuICAgICAgfSk7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdlbmRcIiwgKCkgPT4gcm93LmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcmFnZ2luZ1wiKSk7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdvdmVyXCIsIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAvLyBPYmVyZSBvZGVyIHVudGVyZSBIXHUwMEU0bGZ0ZSBkZXIgWmVpbGUgZW50c2NoZWlkZXQsIG9iIGRpZSBnZXpvZ2VuZVxuICAgICAgICAvLyBaZWlsZSBkYXZvciBvZGVyIGRhaGludGVyIGxhbmRldCAtIHNvbnN0IGxpZVx1MDBERmUgc2ljaCBuaWUgXCJuYWNoIGdhbnpcbiAgICAgICAgLy8gdW50ZW5cIiBhYmxlZ2VuIChBYmxlZ2VuIGF1ZiBkZXIgbGV0enRlbiBaZWlsZSBoXHUwMEU0dHRlIGltbWVyIG51ciB2b3JcbiAgICAgICAgLy8gaWhyIGVpbmdlZlx1MDBGQ2d0KS5cbiAgICAgICAgY29uc3QgcmVjdCA9IHJvdy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IGV2ZW50LmNsaWVudFkgLSByZWN0LnRvcCA+IHJlY3QuaGVpZ2h0IC8gMjtcbiAgICAgICAgcm93LmNsYXNzTGlzdC50b2dnbGUoXCJpcy1kcm9wLWJlZm9yZVwiLCAhaXNBZnRlcik7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1hZnRlclwiLCBpc0FmdGVyKTtcbiAgICAgIH0pO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnbGVhdmVcIiwgKCkgPT4gcm93LmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcm9wLWJlZm9yZVwiLCBcImlzLWRyb3AtYWZ0ZXJcIikpO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcm9wXCIsIGFzeW5jIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBjb25zdCBpc0FmdGVyID0gcm93LmNsYXNzTGlzdC5jb250YWlucyhcImlzLWRyb3AtYWZ0ZXJcIik7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpO1xuXG4gICAgICAgIGNvbnN0IGZyb21JbmRleCA9IE51bWJlcihldmVudC5kYXRhVHJhbnNmZXIuZ2V0RGF0YShcInRleHQvcGxhaW5cIikpO1xuICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKGZyb21JbmRleCkpIHJldHVybjtcblxuICAgICAgICAvLyBaaWVscG9zaXRpb24gaW0gQXJyYXkgVk9SIGRlbSBFbnRmZXJuZW4gdm9uIGZyb21JbmRleCBnZWRhY2h0IC1cbiAgICAgICAgLy8gXCJuYWNoIGRpZXNlciBaZWlsZVwiIGhlaVx1MDBERnQ6IGRpcmVrdCB2b3IgZGVyIGpld2VpbHMgblx1MDBFNGNoc3Rlbi5cbiAgICAgICAgbGV0IGluc2VydEJlZm9yZSA9IGlzQWZ0ZXIgPyBpbmRleCArIDEgOiBpbmRleDtcbiAgICAgICAgaWYgKGZyb21JbmRleCA8IGluc2VydEJlZm9yZSkgaW5zZXJ0QmVmb3JlIC09IDE7XG5cbiAgICAgICAgY29uc3QgW21vdmVkXSA9IG9yZGVyKCkuc3BsaWNlKGZyb21JbmRleCwgMSk7XG4gICAgICAgIG9yZGVyKCkuc3BsaWNlKGluc2VydEJlZm9yZSwgMCwgbW92ZWQpO1xuICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHJlbmRlcigpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH07XG5cbiAgYWRkQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgaWYgKCFkcmFmdEVudHJ5KSB7XG4gICAgICBkcmFmdEVudHJ5ID0geyBraW5kOiBcInByb3BlcnR5XCIsIG5hbWU6IFwiXCIgfTtcbiAgICAgIHJlbmRlcigpO1xuICAgIH1cbiAgICBjb25zdCBpbnB1dHMgPSBsaXN0RWwucXVlcnlTZWxlY3RvckFsbChcIi5mcmVkLW9yZGVyLW5hbWUtaW5wdXRcIik7XG4gICAgaW5wdXRzW2lucHV0cy5sZW5ndGggLSAxXT8uZm9jdXMoKTtcbiAgfSk7XG5cbiAgcmVuZGVyKCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBtb3VudEdsb2JhbE9yZGVyRWRpdG9yIH07XG4iLCAiY29uc3QgeyBQbHVnaW5TZXR0aW5nVGFiLCBTZXR0aW5nLCBUb2dnbGVDb21wb25lbnQgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgbW91bnRHbG9iYWxPcmRlckVkaXRvciB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItb3JkZXItZWRpdG9yXCIpO1xuY29uc3QgeyBERUZBVUxUX0dMT0JBTF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcblxuY29uc3QgREVGQVVMVF9TRVRUSU5HUyA9IHtcbiAgdHlwZXM6IFtdLFxuICB0eXBlQ29sb3JzOiB7fSxcbiAgdHlwZURlc2NyaXB0aW9uczoge30sXG4gIHR5cGVEZWZhdWx0RnJvbnRtYXR0ZXI6IHt9LFxuICAvLyBLZXlzIGF1cyB0eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdLCBkaWUgYWxzIFwiRmxvYXRpbmcgUHJvcGVydHlcIiBtYXJraWVydFxuICAvLyBzaW5kIChzaWVoZSB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcy90eXAtdmlldy5qcykgLSBUZWlsIGRlcnNlbGJlbiBMaXN0ZVxuICAvLyB1bmQgUmVpaGVuZm9sZ2Ugd2llIGRpZSBcdTAwRkNicmlnZW4gU3RhbmRhcmQtUHJvcGVydGllcyBkZXMgVHlwcyAod2ljaHRpZyBmXHUwMEZDclxuICAvLyBkaWUgRnJvbnRtYXR0ZXItU29ydGllcnVuZywgc2llaGUgb3JkZXJlZERlZmF1bHRLZXlzIGluIGZyb250bWF0dGVyLXNvcnQuanMpLFxuICAvLyBhYmVyIE5JQ0hUIFRlaWwgZGVzIHZvbiBnZXRUeXBlRGVmYXVsdHMoKSAobWFpbi5qcykgc3RhbmRhcmRtXHUwMEU0XHUwMERGaWdcbiAgLy8gZ2VsaWVmZXJ0ZW4gRnJvbnRtYXR0ZXJzIC0gVGVtcGxhdGVyIGxlZ3Qgc2llIGJlaW0gQW5sZWdlbiBlaW5lciBOb3RpeiBhbHNvXG4gIC8vIG5pY2h0IGF1dG9tYXRpc2NoIGFuIChudXIgXHUwMEZDYmVyIGRlbiBleHBsaXppdGVuIGluY2x1ZGVGbG9hdGluZy1QYXJhbWV0ZXIpLlxuICB0eXBlRmxvYXRpbmdLZXlzOiB7fSxcbiAgdHlwZU1hbnVhbDoge30sXG4gIC8vIFNpZWhlIGZyb250bWF0dGVyLW9yZGVyLWVkaXRvci5qcyAvIGZyb250bWF0dGVyLXNvcnQuanM6IFJlaWhlbmZvbGdlIGF1c1xuICAvLyBmZXN0IHBvc2l0aW9uaWVydGVuIEVpbnplbC1Qcm9wZXJ0aWVzIChraW5kOiBcInByb3BlcnR5XCIpIHNvd2llIGRlbiB2aWVyXG4gIC8vIG5pY2h0IGVudGZlcm5iYXJlbiBQbGF0emhhbHRlcm4gXCJ0eXBWYWx1ZVwiIChUWVAtUHJvcGVydHkgc2VsYnN0KSxcbiAgLy8gXCJzdWJ0eXBWYWx1ZVwiIChTVUJUWVAtUHJvcGVydHkgc2VsYnN0KSwgXCJ0eXBcIiAoU3RhbmRhcmRsaXN0ZSBkZXMgVHlwcylcbiAgLy8gdW5kIFwib3RoZXJcIiAoYWxsZXMgXHUwMERDYnJpZ2UpLlxuICBnbG9iYWxQcm9wZXJ0eU9yZGVyOiBERUZBVUxUX0dMT0JBTF9PUkRFUixcbiAgLy8gU2llaGUgYWN0aXZlLXRpdGxlLWNvbG9ycy5qczogd2llIGRlciBUWVAgaW4gZGVyIGdlXHUwMEY2ZmZuZXRlbiBOb3RpeiBtYXJraWVydFxuICAvLyB3aXJkIC0gXCJub25lXCIgKG5pY2h0cyksIFwiZG90XCIgKEZhcmJwdW5rdCBhbSBUaXRlbCkgb2RlciBcImJhZGdlXCIgKEJveCBtaXRcbiAgLy8gVFlQLU5hbWVuLCB3ZWl0ZXIga29uZmlndXJpZXJ0IFx1MDBGQ2JlciBkaWUgZHJlaSBmb2xnZW5kZW4gRWluc3RlbGx1bmdlbiwgZGllXG4gIC8vIG51ciBiZWkgXCJiYWRnZVwiIFx1MDBGQ2JlcmhhdXB0IGVpbmUgUm9sbGUgc3BpZWxlbiBiencuIGluIGRlbiBFaW5zdGVsbHVuZ2VuXG4gIC8vIGFuZ2V6ZWlndCB3ZXJkZW4pLiBVbmFiaFx1MDBFNG5naWcgZGF2b24gdW5kIGJlbGllYmlnIGtvbWJpbmllcmJhcjpcbiAgLy8gY29sb3JWaWV3cy5ub3RlVGl0bGVDb2xvciBmXHUwMEU0cmJ0IGRlbiBUaXRlbHRleHQgc2VsYnN0IGVpbi5cbiAgbm90ZVRpdGxlU3R5bGU6IFwiZG90XCIsXG4gIC8vIE51ciByZWxldmFudCBiZWkgbm90ZVRpdGxlU3R5bGU6IFwiYmFkZ2VcIiAtIG9iIGRpZSBCb3ggZmFyYmlnIChUWVAtRmFyYmUpXG4gIC8vIG9kZXIgbmV1dHJhbCAodGV4dC1tdXRlZCkgZGFyZ2VzdGVsbHQgd2lyZC5cbiAgbm90ZVRpdGxlQmFkZ2VDb2xvcmVkOiB0cnVlLFxuICAvLyBOdXIgcmVsZXZhbnQgYmVpIG5vdGVUaXRsZVN0eWxlOiBcImJhZGdlXCIgLSBcInRpdGxlXCIgKG5lYmVuIGRlbSBJbmxpbmUtVGl0ZWwsXG4gIC8vIG5vcm1hbGUgQXVzcmljaHR1bmcpIG9kZXIgXCJibG9ja1wiIChsaW5rcyBhbSBQcm9wZXJ0eS1CbG9jaywgdW0gOTBcdTAwQjAgZ2VkcmVodCkuXG4gIG5vdGVUaXRsZUJhZGdlUG9zaXRpb246IFwidGl0bGVcIixcbiAgLy8gTnVyIHJlbGV2YW50IGJlaSBub3RlVGl0bGVCYWRnZVBvc2l0aW9uOiBcImJsb2NrXCIgLSBvYiBkaWUgZ2VkcmVodGUgQm94IGFtXG4gIC8vIG9iZXJlbiBvZGVyIHVudGVyZW4gUmFuZCBkZXMgUHJvcGVydHktQmxvY2tzIHNpdHp0LlxuICBub3RlVGl0bGVWZXJ0aWNhbEFsaWduOiBcInRvcFwiLFxuICB0eXBTb3J0T3JkZXI6IFwiY291bnQtZGVzY1wiLFxuICB0eXBMaXN0RGVzY3JpcHRpb25FbmFibGVkOiB0cnVlLFxuICBpbmNsdWRlSWdub3JlZEZpbGVzOiBmYWxzZSxcbiAgZ3JhcGhUYWdDb2xvckVuYWJsZWQ6IGZhbHNlLFxuICBncmFwaFRhZ0NvbG9yOiBcIlwiLFxuICBncmFwaEF0dGFjaG1lbnRDb2xvckVuYWJsZWQ6IGZhbHNlLFxuICBncmFwaEF0dGFjaG1lbnRDb2xvcjogXCJcIixcbiAgY29sb3JWaWV3czoge1xuICAgIGZpbGVFeHBsb3JlcjogdHJ1ZSxcbiAgICBncmFwaDogdHJ1ZSxcbiAgICBzZWFyY2g6IHRydWUsXG4gICAgcmVjZW50RmlsZXM6IHRydWUsXG4gICAgYmFja2xpbmtzOiB0cnVlLFxuICAgIGJvb2ttYXJrczogdHJ1ZSxcbiAgICBmcm9udG1hdHRlckRlZmF1bHRzOiB0cnVlLFxuICAgIHR5cExpc3Q6IHRydWUsXG4gICAgYWxsUHJvcGVydGllczogdHJ1ZSxcbiAgICBub3RlVGl0bGVDb2xvcjogdHJ1ZSxcbiAgICBsaW5rczogdHJ1ZSxcbiAgfSxcbn07XG5cbmNsYXNzIFR5cFN5c3RlbVNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgY29uc3RydWN0b3IoYXBwLCBwbHVnaW4pIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBkaXNwbGF5KCkge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcblxuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDRcIiwgeyB0ZXh0OiBcIlRZUC1MaXN0ZVwiIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkJlc2NocmVpYnVuZ3MtVGV4dGZlbGQgYW56ZWlnZW5cIilcbiAgICAgIC5zZXREZXNjKFwiWmVpZ3QgaW4gZGVyIFRZUC1MaXN0ZSBuZWJlbiBqZWRlbSByZWdpc3RyaWVydGVuIFRZUCBlaW4gVGV4dGZlbGQgenVyIEJlYXJiZWl0dW5nIHNlaW5lciBCZXNjaHJlaWJ1bmcuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBMaXN0RGVzY3JpcHRpb25FbmFibGVkKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBMaXN0RGVzY3JpcHRpb25FbmFibGVkID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIklnbm9yaWVydGUgTm90aXplbiBJTU1FUiBiZXJcdTAwRkNja3NpY2h0aWdlblwiKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgIFwiQmV6aWVodCBOb3RpemVuIGF1cyBPYnNpZGlhbnMgXFxcIkV4Y2x1ZGVkIGZpbGVzXFxcIi1MaXN0ZSAoZG9ydCB0cmFnZW4gYXVjaCBQbHVnaW5zIHdpZSBIaWRlIEZvbGRlcnMgYXVzZ2VibGVuZGV0ZSBPcmRuZXIgZWluKSB3aWVkZXIgaW4gVFlQLVpcdTAwRTRobGVyLCBUWVAtUGlja2VyIHVuZCBkaWUgRnJvbnRtYXR0ZXItU29ydGllcnVuZyBtaXQgZWluLCBzdGF0dCBzaWUgenUgXHUwMEZDYmVyc3ByaW5nZW4uXCJcbiAgICAgIClcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMgPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImg0XCIsIHsgdGV4dDogXCJFaW5mXHUwMEU0cmJ1bmdcIiB9KTtcblxuICAgIGNvbnN0IGNvbG9yVmlld1RvZ2dsZSA9IChrZXksIG5hbWUsIGRlc2MpID0+IHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShuYW1lKVxuICAgICAgICAuc2V0RGVzYyhkZXNjKVxuICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nba2V5XSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW2tleV0gPSB2YWx1ZTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgfSlcbiAgICAgICAgKTtcbiAgICB9O1xuXG4gICAgY29sb3JWaWV3VG9nZ2xlKFwiZmlsZUV4cGxvcmVyXCIsIFwiRGF0ZWktRXhwbG9yZXJcIiwgXCJOb3Rpem5hbWVuIGltIERhdGVpLUV4cGxvcmVyIG5hY2ggVFlQIGVpbmZcdTAwRTRyYmVuLlwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoXCJncmFwaFwiLCBcIkdyYXBoXCIsIFwiS25vdGVuIGltIEdyYXBoIChnbG9iYWwgdW5kIGxva2FsKSBuYWNoIFRZUCBlaW5mXHUwMEU0cmJlbi5cIik7XG4gICAgY29sb3JWaWV3VG9nZ2xlKFwic2VhcmNoXCIsIFwiU3VjaGVcIiwgXCJUcmVmZmVyLVRpdGVsIGluIGRlciBTdWNoZSBuYWNoIFRZUCBlaW5mXHUwMEU0cmJlbi5cIik7XG4gICAgY29sb3JWaWV3VG9nZ2xlKFwicmVjZW50RmlsZXNcIiwgXCJSZWNlbnQgRmlsZXNcIiwgXCJFaW50clx1MDBFNGdlIGltIFJlY2VudC1GaWxlcy1QbHVnaW4gbmFjaCBUWVAgZWluZlx1MDBFNHJiZW4uXCIpO1xuICAgIGNvbG9yVmlld1RvZ2dsZShcbiAgICAgIFwibGlua3NcIixcbiAgICAgIFwiTGlua3MgaW4gTm90aXplblwiLFxuICAgICAgXCJJbnRlcm5lIExpbmtzIGltIE5vdGl6dGV4dCAoTGVzZS1Nb2R1cywgTGl2ZSBQcmV2aWV3LCBIb3Zlci1Wb3JzY2hhdSkgaW4gZGVyIEZhcmJlIGRlcyBUWVBzIGlocmVzIFppZWxzIGRhcnN0ZWxsZW4uIE5pY2h0IGF1ZmdlbFx1MDBGNnN0ZSBMaW5rcyBibGVpYmVuIHVudmVyXHUwMEU0bmRlcnQuXCJcbiAgICApO1xuICAgIGNvbG9yVmlld1RvZ2dsZShcInR5cExpc3RcIiwgXCJUWVAgVmlld1wiLCBcIlR5cC1OYW1lbiBpbiBkZXIgVFlQLVZpZXcgc2VsYnN0IChMaXN0ZSB1bmQgRGV0YWlsYW5zaWNodCkgaW4gaWhyZXIgamV3ZWlsaWdlbiBGYXJiZSBkYXJzdGVsbGVuLlwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoXG4gICAgICBcIm5vdGVUaXRsZUNvbG9yXCIsXG4gICAgICBcIlRpdGVsLVRleHQgZWluZlx1MDBFNHJiZW5cIixcbiAgICAgIFwiRlx1MDBFNHJidCBkZW4gSW5saW5lLVRpdGVsIGRlciBnZVx1MDBGNmZmbmV0ZW4gTm90aXogc2VsYnN0IGluIGRlciBGYXJiZSBpaHJlcyBUWVBzIGVpbiAtIHVuYWJoXHUwMEU0bmdpZyB2b24gZGVyIFRZUC1NYXJraWVydW5nIGRhbmViZW4gKHMuIHUuKSwgYmVpZGVzIGxcdTAwRTRzc3Qgc2ljaCBrb21iaW5pZXJlbi5cIlxuICAgICk7XG5cbiAgICAvLyBQcm9ncmVzc2l2ZSBPZmZlbmxlZ3VuZzogYmVpIG5vdGVUaXRsZVN0eWxlIFwiYmFkZ2VcIiBrb21tZW4gd2VpdGVyZVxuICAgIC8vIFNjaGFsdGVyIGRpcmVrdCBpbiBkaWVzZXIgZWluZW4gU2V0dGluZy1aZWlsZSBkYXp1IChGYXJiZSwgUG9zaXRpb24pLFxuICAgIC8vIGJlaSBQb3NpdGlvbiBcImJsb2NrXCIgbm9jaCBlaW4gZHJpdHRlciAoQXVzcmljaHR1bmcpIC0gamV3ZWlscyBwZXJcbiAgICAvLyB0aGlzLmRpc3BsYXkoKSBuZXUgZ2VyZW5kZXJ0LCBkYW1pdCBudXIgZGllIGdlcmFkZSByZWxldmFudGVuIFNjaGFsdGVyXG4gICAgLy8gZXJzY2hlaW5lbiwgc3RhdHQgcGVybWFuZW50IGFsbGUgYW56dXplaWdlbiBiencuIGVpZ2VuZSBaZWlsZW4genUgYmVsZWdlbi5cbiAgICBjb25zdCBpc0JhZGdlID0gdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGUgPT09IFwiYmFkZ2VcIjtcbiAgICBjb25zdCBpc0Jsb2NrUG9zaXRpb24gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZVBvc2l0aW9uID09PSBcImJsb2NrXCI7XG5cbiAgICAvLyBFaWdlbmUgS2xhc3NlLCBkYW1pdCBkaWUgYmVpIFwiYmFkZ2VcIiB6dXNcdTAwRTR0emxpY2ggYW5nZWhcdTAwRTRuZ3RlbiBTY2hhbHRlclxuICAgIC8vIChzaWVoZSB1bnRlbikgc3RhdHQgbmViZW5laW5hbmRlciAoT2JzaWRpYW5zIFN0YW5kYXJkLUxheW91dCBmXHUwMEZDclxuICAgIC8vIG1laHJlcmUgQ29udHJvbHMgaW4gZWluZXIgU2V0dGluZy1aZWlsZSkgdW50ZXJlaW5hbmRlciBzdGVoZW4gLSBzaWVoZVxuICAgIC8vIC5mcmVkLW5vdGUtdGl0bGUtc2V0dGluZyBpbiBzdHlsZXMuY3NzLlxuICAgIGNvbnN0IG5vdGVUaXRsZVNldHRpbmcgPSBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiVFlQLU1hcmtpZXJ1bmcgaW4gZGVyIE5vdGl6XCIpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgaXNCYWRnZVxuICAgICAgICAgID8gJ1wiQm94IG1pdCBUWVAtTmFtZW5cIiAtIFNjaGFsdGVyOiBmYXJiaWcvbmV1dHJhbCwgYW0gVGl0ZWwvYW0gUHJvcGVydHktQmxvY2sgKGdlZHJlaHQpJyArXG4gICAgICAgICAgICAgIChpc0Jsb2NrUG9zaXRpb24gPyBcIiwgb2Jlbi91bnRlbiBhbSBQcm9wZXJ0eS1CbG9ja1wiIDogXCJcIikgK1xuICAgICAgICAgICAgICBcIi5cIlxuICAgICAgICAgIDogXCJXaWUgZGVyIFRZUCBpbiBkZXIgZ2VcdTAwRjZmZm5ldGVuIE5vdGl6IG1hcmtpZXJ0IHdpcmQuXCJcbiAgICAgIClcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbihcIm5vbmVcIiwgXCJOaWNodHNcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiZG90XCIsIFwiRmFyYnB1bmt0IGFtIFRpdGVsXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImJhZGdlXCIsIFwiQm94IG1pdCBUWVAtTmFtZW5cIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGUpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGUgPSB2YWx1ZTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIGlmIChpc0JhZGdlKSBub3RlVGl0bGVTZXR0aW5nLnNldHRpbmdFbC5hZGRDbGFzcyhcImZyZWQtbm90ZS10aXRsZS1zZXR0aW5nXCIpO1xuXG4gICAgLy8gRWlnZW5lcyBrbGVpbmVzIExhYmVsIGplIFNjaGFsdGVyIHN0YXR0IG51ciBUb29sdGlwIC0gYWRkVG9nZ2xlKCkgYWxsZWluXG4gICAgLy8gaFx1MDBFNG5ndCBudXIgZGVuIG5hY2t0ZW4gU2NoYWx0ZXIgb2huZSBCZXNjaHJpZnR1bmcgYW4sIGRhaGVyIGhpZXIgZWluZVxuICAgIC8vIGVpZ2VuZSBaZWlsZSAoTGFiZWwgKyBUb2dnbGVDb21wb25lbnQpIGRpcmVrdCBpbiBjb250cm9sRWwgZ2ViYXV0LlxuICAgIGNvbnN0IGFkZExhYmVsZWRUb2dnbGUgPSAobGFiZWwsIHRvb2x0aXAsIHZhbHVlLCBvbkNoYW5nZSkgPT4ge1xuICAgICAgY29uc3Qgcm93ID0gbm90ZVRpdGxlU2V0dGluZy5jb250cm9sRWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XG4gICAgICByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLW5vdGUtdGl0bGUtdG9nZ2xlLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xuICAgICAgbmV3IFRvZ2dsZUNvbXBvbmVudChyb3cpLnNldFRvb2x0aXAodG9vbHRpcCkuc2V0VmFsdWUodmFsdWUpLm9uQ2hhbmdlKG9uQ2hhbmdlKTtcbiAgICB9O1xuXG4gICAgaWYgKGlzQmFkZ2UpIHtcbiAgICAgIGFkZExhYmVsZWRUb2dnbGUoXCJGYXJiaWdcIiwgXCJGYXJiaWcgKFRZUC1GYXJiZSkgc3RhdHQgbmV1dHJhbFwiLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUNvbG9yZWQsIGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUNvbG9yZWQgPSB2YWx1ZTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgfSk7XG5cbiAgICAgIGFkZExhYmVsZWRUb2dnbGUoXCJBbSBQcm9wZXJ0eS1CbG9ja1wiLCBcIkFtIFByb3BlcnR5LUJsb2NrIChnZWRyZWh0KSBzdGF0dCBhbSBUaXRlbFwiLCBpc0Jsb2NrUG9zaXRpb24sIGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZVBvc2l0aW9uID0gdmFsdWUgPyBcImJsb2NrXCIgOiBcInRpdGxlXCI7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICB9KTtcblxuICAgICAgaWYgKGlzQmxvY2tQb3NpdGlvbikge1xuICAgICAgICBhZGRMYWJlbGVkVG9nZ2xlKFxuICAgICAgICAgIFwiT2JlbiBzdGF0dCB1bnRlblwiLFxuICAgICAgICAgIFwiT2JlbiBzdGF0dCB1bnRlbiBhbSBQcm9wZXJ0eS1CbG9ja1wiLFxuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVZlcnRpY2FsQWxpZ24gPT09IFwidG9wXCIsXG4gICAgICAgICAgYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVWZXJ0aWNhbEFsaWduID0gdmFsdWUgPyBcInRvcFwiIDogXCJib3R0b21cIjtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgfVxuICAgICAgICApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbG9yVmlld1RvZ2dsZShcbiAgICAgIFwiYmFja2xpbmtzXCIsXG4gICAgICBcIkJhY2tsaW5rc1wiLFxuICAgICAgXCJUcmVmZmVyemVpbGVuIGltIEJhY2tsaW5rcy1QYW5lIHNvd2llIGluIGRlbiBpbSBEb2t1bWVudCBlaW5nZWJldHRldGVuIEJhY2tsaW5rcyAoaW5rbC4gbmljaHQgdmVybGlua3RlciBFcndcdTAwRTRobnVuZ2VuKSBuYWNoIFRZUCBlaW5mXHUwMEU0cmJlbi5cIlxuICAgICk7XG4gICAgY29sb3JWaWV3VG9nZ2xlKFxuICAgICAgXCJib29rbWFya3NcIixcbiAgICAgIFwiQm9va21hcmtzXCIsXG4gICAgICBcIkVpbnRyXHUwMEU0Z2UgaW0gQm9va21hcmtzLVBhbmUsIGRpZSBkaXJla3QgYXVmIGVpbmUgTm90aXogemVpZ2VuLCBuYWNoIFRZUCBlaW5mXHUwMEU0cmJlbi5cIlxuICAgICk7XG4gICAgY29sb3JWaWV3VG9nZ2xlKFxuICAgICAgXCJhbGxQcm9wZXJ0aWVzXCIsXG4gICAgICBcIkFsbCBQcm9wZXJ0aWVzXCIsXG4gICAgICBcIkluIE9ic2lkaWFucyB2YXVsdC13ZWl0ZXIgXFxcIkFsbCBQcm9wZXJ0aWVzXFxcIi1BbnNpY2h0IFByb3BlcnR5LU5hbWVuIGVpbmZcdTAwRTRyYmVuLCBkaWUgaW0gU3RhbmRhcmQtRnJvbnRtYXR0ZXIgZ2VuYXUgZWluZXMgVFlQcyB2b3Jrb21tZW4gKGluIGRlc3NlbiBGYXJiZSkgLSBrb21tZW4gc2llIGJlaSBtZWhyZXJlbiBUWVBzIHZvciwgc3RhdHRkZXNzZW4gZmV0dCBzdGF0dCBlaW5nZWZcdTAwRTRyYnQuXCJcbiAgICApO1xuXG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoNFwiLCB7IHRleHQ6IFwiR3JhcGhcIiB9KTtcblxuICAgIC8vIEVpbiBTZXR0aW5nIHBybyBOb2RlLVR5cCwgZGVuIE9ic2lkaWFucyBHcmFwaC1FbmdpbmUga2VubnQgLSBnbGVpY2hlclxuICAgIC8vIEF1ZmJhdSAoVG9nZ2xlICsgRmFyYndhaGwgKyBadXJcdTAwRkNja3NldHplbikgZlx1MDBGQ3IgamVkZW4sIGRhaGVyIGFscyBIZWxwZXJcbiAgICAvLyBzdGF0dCBkdXBsaXppZXJ0LlxuICAgIGNvbnN0IGdyYXBoQ29sb3JTZXR0aW5nID0gKGVuYWJsZWRLZXksIGNvbG9yS2V5LCBkZWZhdWx0Q29sb3IsIG5hbWUsIGRlc2MpID0+IHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShuYW1lKVxuICAgICAgICAuc2V0RGVzYyhkZXNjKVxuICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzW2VuYWJsZWRLZXldKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzW2VuYWJsZWRLZXldID0gdmFsdWU7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgIH0pXG4gICAgICAgIClcbiAgICAgICAgLmFkZENvbG9yUGlja2VyKChwaWNrZXIpID0+XG4gICAgICAgICAgcGlja2VyLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzW2NvbG9yS2V5XSB8fCBkZWZhdWx0Q29sb3IpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3NbY29sb3JLZXldID0gdmFsdWU7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgIH0pXG4gICAgICAgIClcbiAgICAgICAgLmFkZEV4dHJhQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgYnV0dG9uXG4gICAgICAgICAgICAuc2V0SWNvbihcInJvdGF0ZS1jY3dcIilcbiAgICAgICAgICAgIC5zZXRUb29sdGlwKFwiWnVyXHUwMEZDY2tzZXR6ZW4gYXVmIFN0YW5kYXJkZmFyYmVcIilcbiAgICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3NbY29sb3JLZXldID0gXCJcIjtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICk7XG4gICAgfTtcblxuICAgIGdyYXBoQ29sb3JTZXR0aW5nKFxuICAgICAgXCJncmFwaFRhZ0NvbG9yRW5hYmxlZFwiLFxuICAgICAgXCJncmFwaFRhZ0NvbG9yXCIsXG4gICAgICBcIiM4ODg4ODhcIixcbiAgICAgIFwiVGFnLUZhcmJlXCIsXG4gICAgICBcIkVpZ2VuZSBGYXJiZSBmXHUwMEZDciBUYWctS25vdGVuIGltIEdyYXBoIChnbG9iYWwgdW5kIGxva2FsKSB2ZXJ3ZW5kZW4gc3RhdHQgZGVyIFN0YW5kYXJkZmFyYmUuIEVpZ2VuZSBGYXJiZ3J1cHBlbiBpbSBHcmFwaCBoYWJlbiB3ZWl0ZXJoaW4gVm9ycmFuZy5cIlxuICAgICk7XG4gICAgZ3JhcGhDb2xvclNldHRpbmcoXG4gICAgICBcImdyYXBoQXR0YWNobWVudENvbG9yRW5hYmxlZFwiLFxuICAgICAgXCJncmFwaEF0dGFjaG1lbnRDb2xvclwiLFxuICAgICAgXCIjZTBhYzAwXCIsXG4gICAgICBcIkFuaFx1MDBFNG5nZS1GYXJiZVwiLFxuICAgICAgXCJFaWdlbmUgRmFyYmUgZlx1MDBGQ3IgQW5oYW5nLUtub3RlbiAoTmljaHQtTWFya2Rvd24tRGF0ZWllbiB3aWUgQmlsZGVyIG9kZXIgUERGcykgaW0gR3JhcGggdmVyd2VuZGVuIHN0YXR0IGRlciBTdGFuZGFyZGZhcmJlLlwiXG4gICAgKTtcblxuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDRcIiwgeyB0ZXh0OiBcIlN0YW5kYXJkLUZyb250bWF0dGVyXCIgfSk7XG5cbiAgICBjb2xvclZpZXdUb2dnbGUoXG4gICAgICBcImZyb250bWF0dGVyRGVmYXVsdHNcIixcbiAgICAgIFwiUHJvcGVydHktTmFtZW4gZmV0dCBtYXJraWVyZW5cIixcbiAgICAgIFwiSW4gTm90aXplbiAoRnJvbnRtYXR0ZXIgaW0gRG9rdW1lbnQgc293aWUgUHJvcGVydGllcy1TZWl0ZW5sZWlzdGUpIGRpZSBOYW1lbiBkZXIgUHJvcGVydGllcyBmZXR0IGRhcnN0ZWxsZW4sIGRpZSBpbSBTdGFuZGFyZC1Gcm9udG1hdHRlciBkZXMgamV3ZWlsaWdlbiBUWVBzIGhpbnRlcmxlZ3Qgc2luZC5cIlxuICAgICk7XG5cbiAgICBtb3VudEdsb2JhbE9yZGVyRWRpdG9yKGNvbnRhaW5lckVsLCB0aGlzLnBsdWdpbik7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgIHRleHQ6XG4gICAgICAgICdCZXN0aW1tdCBkaWUgUmVpaGVuZm9sZ2UsIGluIGRlciBkaWUgQmVmZWhsZSBcIkZyb250bWF0dGVyIFNvcnRpZXJ1bmcgYWt0dWFsaXNpZXJlblwiIGRpZSBpbiBlaW5lciBOb3RpeiB2b3JoYW5kZW5lbiBQcm9wZXJ0aWVzIGFub3JkbmVuIChlcmdcdTAwRTRuenQgb2RlciBcdTAwRTRuZGVydCBrZWluZSBXZXJ0ZSkuIEVpbnplbG5lIFByb3BlcnRpZXMgKHouIEIuIGNzc2NsYXNzZXMsIGFsaWFzZXMpIGxhc3NlbiBzaWNoIGZlc3QgcGxhdHppZXJlbiAtIFwiVFlQXCIgaXN0IGRpZSBUWVAtUHJvcGVydHkgc2VsYnN0LCBcIlNVQlRZUFwiIGFuYWxvZyBkaWUgU1VCVFlQLVByb3BlcnR5LCBcIlRZUCBQcm9wZXJ0aWVzXCIgc3RlaHQgZlx1MDBGQ3IgZGllIFN0YW5kYXJkLUZyb250bWF0dGVyLUxpc3RlIGRlcyBqZXdlaWxpZ2VuIFR5cHMsIFwiU29uc3RpZ2UgUHJvcGVydGllc1wiIGZcdTAwRkNyIGFsbGVzIFx1MDBEQ2JyaWdlLiBSZWloZW5mb2xnZSBwZXIgRHJhZyAmIERyb3AgXHUwMEU0bmRlcmJhciwgZGllIHZpZXIgUGxhdHpoYWx0ZXItWmVpbGVuIGxhc3NlbiBzaWNoIG5pY2h0IGVudGZlcm5lbi4nLFxuICAgIH0pO1xuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBERUZBVUxUX1NFVFRJTkdTLCBUeXBTeXN0ZW1TZXR0aW5nVGFiIH07XG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgc29ydEFsbEZyb250bWF0dGVyLCBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuXG5mdW5jdGlvbiByZWdpc3RlckNvbW1hbmRzKHBsdWdpbikge1xuXG4gIC8vIE9ic2lkaWFuIGF3YWl0ZWQgZGVuIGNhbGxiYWNrIGVpbmVyIEJlZmVobHNkZWZpbml0aW9uIG5pY2h0IHVuZCBmXHUwMEU0bmd0IGF1Y2hcbiAgLy8ga2VpbmUgRmVobGVyIGFiIC0gZWluZSBFeGNlcHRpb24gZGFyaW4gd1x1MDBGQ3JkZSBzb25zdCBsYXV0bG9zIHZlcnNjaHdpbmRlblxuICAvLyAobnVyIGVpbiBFaW50cmFnIGluIGRlciBFbnR3aWNrbGVya29uc29sZSwga2VpbmUgc2ljaHRiYXJlIFJcdTAwRkNja21lbGR1bmcpLlxuICAvLyBEaWVzZSBkcmVpIFNvcnRpZXJiZWZlaGxlIGxhdWZlbiBkZXNoYWxiIFx1MDBGQ2JlciBydW5PclJlcG9ydEVycm9yKCksIGRhbWl0XG4gIC8vIGltIEZlaGxlcmZhbGwgdHJvdHpkZW0gaW1tZXIgZWluZSBOb3RpY2UgZXJzY2hlaW50IHN0YXR0IGdhciBrZWluZS5cbiAgY29uc3QgcnVuT3JSZXBvcnRFcnJvciA9IChsYWJlbCwgZm4pID0+IGFzeW5jICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgZm4oKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihgWyR7bGFiZWx9XWAsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoYCR7bGFiZWx9IGZlaGxnZXNjaGxhZ2VuOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuICB9O1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJmcm9udG1hdHRlci1zb3J0aWVydW5nLWFsbGVcIixcbiAgICBuYW1lOiBcIlRZUCAtIEZyb250bWF0dGVyIFNvcnRpZXJ1bmcgR0xPQkFMIGFrdHVhbGlzaWVyZW5cIixcbiAgICBjYWxsYmFjazogcnVuT3JSZXBvcnRFcnJvcihcIkZyb250bWF0dGVyIFNvcnRpZXJ1bmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgeyBjaGVja2VkLCBjaGFuZ2VkIH0gPSBhd2FpdCBzb3J0QWxsRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCBudWxsKTtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIGNoYW5nZWQgPiAwXG4gICAgICAgICAgPyBgRnJvbnRtYXR0ZXIgU29ydGllcnVuZzogJHtjaGVja2VkfSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgJHtjaGFuZ2VkfSBzb3J0aWVydC5gXG4gICAgICAgICAgOiBgRnJvbnRtYXR0ZXIgU29ydGllcnVuZzogJHtjaGVja2VkfSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgYmVyZWl0cyBhbGxlIHNvcnRpZXJ0LmBcbiAgICAgICk7XG4gICAgfSksXG4gIH0pO1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJmcm9udG1hdHRlci1zb3J0aWVydW5nLXR5cFwiLFxuICAgIG5hbWU6IFwiVFlQIC0gRnJvbnRtYXR0ZXIgU29ydGllcnVuZyBmXHUwMEZDciBUWVAgYWt0dWFsaXNpZXJlblwiLFxuICAgIGNhbGxiYWNrOiBydW5PclJlcG9ydEVycm9yKFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBEZXJzZWxiZSBUWVAtUGlja2VyIHdpZSBcdTAwRkNiZXJhbGwgc29uc3QgaW0gUGx1Z2luIChzaWVoZSB0eXBlLXBpY2tlci5qcykgLVxuICAgICAgLy8gemVpZ3QgRmFyYmUsIEJlc2NocmVpYnVuZyB1bmQgTm90aXotQW56YWhsIHN0YXR0IGVpbmVyIHJlaW5lbiBOYW1lbnNsaXN0ZVxuICAgICAgLy8gKHVuZCBtZWxkZXQgc2VsYnN0LCBmYWxscyBlcyBnYXIga2VpbmUgVFlQZW4gZ2lidCkuIGluY2x1ZGVNYW51YWxPZmYgdW5kXG4gICAgICAvLyBpbmNsdWRlVW5yZWdpc3RlcmVkOiB0cnVlLCBkYSBkaWUgU29ydGllcnVuZyB1bmFiaFx1MDBFNG5naWcgZGF2b24gc2lubnZvbGxcbiAgICAgIC8vIGlzdCwgb2IgZWluIFRZUCBtYW51ZWxsIHZlcmdlYmVuIHdlcmRlbiBkYXJmICh6LiBCLiBLT05UQUtULCBFWFRFUk4pXG4gICAgICAvLyBvZGVyIFx1MDBGQ2JlcmhhdXB0IGluIGRlciBUWVAtTGlzdGUgcmVnaXN0cmllcnQgaXN0LlxuICAgICAgY29uc3QgdHlwZSA9IGF3YWl0IHBsdWdpbi5waWNrVHlwZSh7IGluY2x1ZGVNYW51YWxPZmY6IHRydWUsIGluY2x1ZGVVbnJlZ2lzdGVyZWQ6IHRydWUgfSk7XG4gICAgICBpZiAoIXR5cGUpIHJldHVybjtcbiAgICAgIGNvbnN0IHsgY2hlY2tlZCwgY2hhbmdlZCwgaGFzVHlwZURlZmF1bHRzIH0gPSBhd2FpdCBzb3J0QWxsRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCB0eXBlKTtcbiAgICAgIGxldCBtZXNzYWdlID1cbiAgICAgICAgY2hhbmdlZCA+IDBcbiAgICAgICAgICA/IGBGcm9udG1hdHRlciBTb3J0aWVydW5nICR7dHlwZX06ICR7Y2hlY2tlZH0gTm90aXplbiBnZXByXHUwMEZDZnQsICR7Y2hhbmdlZH0gc29ydGllcnQuYFxuICAgICAgICAgIDogYEZyb250bWF0dGVyIFNvcnRpZXJ1bmcgJHt0eXBlfTogJHtjaGVja2VkfSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgYmVyZWl0cyBhbGxlIHNvcnRpZXJ0LmA7XG4gICAgICAvLyBLZWluIEZlaGxlciwgYWJlciBvaG5lIFN0YW5kYXJkLUZyb250bWF0dGVyIGdyZWlmdCBmXHUwMEZDciBkaWVzZW4gVHlwIG51clxuICAgICAgLy8gZGllIGdsb2JhbGUgUmVpaGVuZm9sZ2UgKFRZUCBzZWxic3QsIGZlc3QgcG9zaXRpb25pZXJ0ZSBQcm9wZXJ0aWVzKSAtXG4gICAgICAvLyBvaG5lIGRpZXNlbiBIaW53ZWlzIHdcdTAwRTRyZSB1bmtsYXIsIHdhcnVtIHNpY2ggZ2dmLiBuaWNodHMgZ2VcdTAwRTRuZGVydCBoYXQuXG4gICAgICBpZiAoaGFzVHlwZURlZmF1bHRzID09PSBmYWxzZSkge1xuICAgICAgICBtZXNzYWdlICs9IGAgSGlud2VpczogRlx1MDBGQ3IgJHt0eXBlfSBpc3Qga2VpbiBTdGFuZGFyZC1Gcm9udG1hdHRlciBoaW50ZXJsZWd0IC0gbnVyIGRpZSBnbG9iYWxlIFJlaWhlbmZvbGdlIHd1cmRlIGFuZ2V3ZW5kZXQuYDtcbiAgICAgIH1cbiAgICAgIG5ldyBOb3RpY2UobWVzc2FnZSk7XG4gICAgfSksXG4gIH0pO1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJmcm9udG1hdHRlci1zb3J0aWVydW5nLWFrdGl2ZS1ub3RpelwiLFxuICAgIG5hbWU6IFwiVFlQIC0gRnJvbnRtYXR0ZXIgU29ydGllcnVuZyBkZXIgYWt0aXZlbiBOb3RpeiBha3R1YWxpc2llcmVuXCIsXG4gICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgICAgaWYgKCFmaWxlIHx8IGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIHJldHVybiBmYWxzZTtcbiAgICAgIGlmIChjaGVja2luZykgcmV0dXJuIHRydWU7XG5cbiAgICAgIHJ1bk9yUmVwb3J0RXJyb3IoXCJGcm9udG1hdHRlciBTb3J0aWVydW5nXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgY2hhbmdlZCA9IGF3YWl0IHNvcnRTaW5nbGVGaWxlRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCBmaWxlKTtcbiAgICAgICAgbmV3IE5vdGljZShjaGFuZ2VkID8gYEZyb250bWF0dGVyIHZvbiBcIiR7ZmlsZS5iYXNlbmFtZX1cIiBzb3J0aWVydC5gIDogYEZyb250bWF0dGVyIHZvbiBcIiR7ZmlsZS5iYXNlbmFtZX1cIiB3YXIgYmVyZWl0cyBzb3J0aWVydC5gKTtcbiAgICAgIH0pKCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9LFxuICB9KTtcblxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJDb21tYW5kcyB9O1xuIiwgImNvbnN0IHsgbW9tZW50IH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5cbi8vIEVya2FubnRlIFBsYXR6aGFsdGVyIGZcdTAwRkNyIFdlcnRlIGltIFN0YW5kYXJkLUZyb250bWF0dGVyIGVpbmVzIFRZUHMgKFRZUC1cbi8vIERldGFpbGFuc2ljaHQpLiBBbHMgcmVpbmVyIFRleHQtV2VydCBpbnMgRnJvbnRtYXR0ZXItV2lkZ2V0IGVpbmdldHJhZ2VuXG4vLyAoei4gQi4gYmVpIFwiRGF0dW1cIiBhbHMgV2VydCBcInt7dG9kYXl9fVwiIHN0YXR0IGVpbmVzIGVjaHRlbiBEYXR1bXMpIHVuZCBlcnN0XG4vLyBiZWltIEFicnVmIFx1MDBGQ2JlciBnZXRUeXBlRGVmYXVsdHMoKSBhdWZnZWxcdTAwRjZzdCAoc2llaGUgbWFpbi5qcykgLSBuaWNodCBzY2hvblxuLy8gYmVpbSBTcGVpY2hlcm4sIGRhbWl0IHouIEIuIFwie3t0b2RheX19XCIgYmVpIGplZGVyIG5ldSBhbmdlbGVndGVuIE5vdGl6IGRhc1xuLy8gZGFubiBha3R1ZWxsZSBEYXR1bSBsaWVmZXJ0IHN0YXR0IGRlcyBUYWdlcywgYW4gZGVtIGRlciBEZWZhdWx0IGdlc2V0enQgd3VyZGUuXG5jb25zdCBGUk9OVE1BVFRFUl9QTEFDRUhPTERFUlMgPSBbXG4gIHtcbiAgICB0b2tlbjogXCJ7e3RvZGF5fX1cIixcbiAgICBkZXNjcmlwdGlvbjogXCJIZXV0aWdlcyBEYXR1bSAoSkpKSi1NTS1UVClcIixcbiAgICByZXNvbHZlOiAoKSA9PiBtb21lbnQoKS5mb3JtYXQoXCJZWVlZLU1NLUREXCIpLFxuICB9LFxuICB7XG4gICAgdG9rZW46IFwie3tub3d9fVwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkFrdHVlbGxlcyBEYXR1bSBtaXQgVWhyemVpdCAoSkpKSi1NTS1UVCBISDptbSlcIixcbiAgICByZXNvbHZlOiAoKSA9PiBtb21lbnQoKS5mb3JtYXQoXCJZWVlZLU1NLUREIEhIOm1tXCIpLFxuICB9LFxuICB7XG4gICAgLy8gQW5kZXJzIGFscyB7e3RvZGF5fX0ve3tub3d9fSBuaWNodCBkZXIgQXVmcnVmemVpdHB1bmt0LCBzb25kZXJuIGRhc1xuICAgIC8vIEVyc3RlbGx1bmdzZGF0dW0gZGVyIGpld2VpbGlnZW4gRGF0ZWkgKGZpbGUuc3RhdC5jdGltZSkgLSBicmF1Y2h0IGRhaGVyXG4gICAgLy8gZGllIFppZWwtRGF0ZWkgYWxzIEtvbnRleHQsIHNpZWhlIGZpbGUtUGFyYW1ldGVyIGJlaSByZXNvbHZlKCkgdW5kXG4gICAgLy8gcmVzb2x2ZUZyb250bWF0dGVyUGxhY2Vob2xkZXJzKCkgdW50ZW4uIE9obmUgRGF0ZWkgKHouIEIuIEF1ZnJ1ZiBvaG5lXG4gICAgLy8gZmlsZS1PcHRpb24pIEZhbGxiYWNrIGF1ZiBkZW4gYWt0dWVsbGVuIFplaXRwdW5rdC5cbiAgICB0b2tlbjogXCJ7e2NyZWF0ZWR9fVwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkVyc3RlbGx1bmdzZGF0dW0gZGVyIERhdGVpIChKSkpKLU1NLVRUKVwiLFxuICAgIHJlc29sdmU6IChmaWxlKSA9PiBtb21lbnQoZmlsZT8uc3RhdD8uY3RpbWUgPz8gRGF0ZS5ub3coKSkuZm9ybWF0KFwiWVlZWS1NTS1ERFwiKSxcbiAgfSxcbl07XG5cbi8vIER5bmFtaXNjaGVyIFBsYXR6aGFsdGVyLCB6LiBCLiBcInt7dHAud2FlaGxlQXV0b3JWb3J0cmFnfX1cIiAtIHJ1ZnQgYmVpbVxuLy8gQW5sZWdlbiBlaW5lciBOb3RpeiBkYXMgZ2xlaWNobmFtaWdlIFRlbXBsYXRlci1Ta3JpcHQgKHRwLnVzZXIuPFNrcmlwdG5hbWU+LFxuLy8gc2llaGUgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzLykgYXVmIHVuZCBcdTAwRkNiZXJuaW1tdCBkZXNzZW4gUlx1MDBGQ2NrZ2FiZXdlcnQuXG4vLyBBbmRlcnMgYWxzIGRpZSBleGFrdGVuIFRva2VuIG9iZW4gaGllciBOSUNIVCBhdWZsXHUwMEY2c2JhciAoZGFzIFBsdWdpbiBoYXRcbi8vIGtlaW5lbiBadWdyaWZmIGF1ZiB0cCkgLSBudXIgYWxzIE11c3RlciBlcmtlbm5iYXIsIGRhbWl0IGRpZSBXYXJudW5ncy1cbi8vIFVudGVyZHJcdTAwRkNja3VuZy9FaW5mXHUwMEU0cmJ1bmcgaW0gU3RhbmRhcmQtRnJvbnRtYXR0ZXItRWRpdG9yIHRyb3R6ZGVtIGdyZWlmdC5cbi8vIERpZSBlaWdlbnRsaWNoZSBBdWZsXHUwMEY2c3VuZyBcdTAwRkNiZXJuaW1tdCBUWVAuanMgc2VsYnN0LCB2b3IgZGVtIFNjaHJlaWJlbiBpbnNcbi8vIEZyb250bWF0dGVyIChBdWZydWYtIHVuZCBSXHUwMEZDY2tnYWJlLUtvbnZlbnRpb24gc2llaGUgZG9ydCBiencuIFJFQURNRSkuXG4vLyBTa3JpcHRuYW1lID0gRGF0ZWluYW1lIGluIHRlbXBsYXRlci1zY3JpcHRzLyBvaG5lIFwiLmpzXCIsIGRhaGVyIGF1Y2ggbWl0XG4vLyBVbWxhdXRlbiwgXCItXCIgb2RlciBMZWVyemVpY2hlbiBlcmxhdWJ0IC0gbnVyIGtlaW5lIGdlc2Nod2VpZnRlbiBLbGFtbWVybi5cbmNvbnN0IERZTkFNSUNfUExBQ0VIT0xERVJfUEFUVEVSTiA9IC9eXFx7XFx7dHBcXC4oW157fV0qW157fVxcc11bXnt9XSopXFx9XFx9JC87XG5jb25zdCBEWU5BTUlDX1BMQUNFSE9MREVSX0lORk8gPSB7XG4gIHRva2VuOiBcInt7dHAuPFNrcmlwdG5hbWU+fX1cIixcbiAgZGVzY3JpcHRpb246XG4gICAgXCJSdWZ0IGJlaW0gQW5sZWdlbiB0cC51c2VyLjxTa3JpcHRuYW1lPih0cCwgbmV3RmlsZSwgY3R4KSBhdWYgXHUyMDEzIFJcdTAwRkNja2dhYmU6IFdlcnQgZGllc2VyIFByb3BlcnR5LCBvZGVyIGVpbiBPYmpla3QgbWl0IFdlcnRlbiBmXHUwMEZDciBtZWhyZXJlIFByb3BlcnRpZXMgZGVzIFRZUHNcIixcbn07XG5cbi8vIEtvcGllIHZvbiBmcm9udG1hdHRlciBtaXQgYXVmZ2VsXHUwMEY2c3RlbiBQbGF0emhhbHRlcm4gLSBudXIgZXhha3RlIFdlcnRlXG4vLyAoa2VpbiBFcnNldHplbiBpbm5lcmhhbGIgZWluZXMgbFx1MDBFNG5nZXJlbiBTdHJpbmdzKSwgZGFtaXQgei4gQi4gXCJ7e3RvZGF5fX1cIlxuLy8gYWxzIGxpdGVyYWxlciBUZXh0IGluIGVpbmVtIGFuZGVyZW4gUHJvcGVydHkgdW5hbmdldGFzdGV0IGJsZWlidC4gV2VydGUgaW1cbi8vIGR5bmFtaXNjaGVuIFwie3t0cC48U2tyaXB0bmFtZT59fVwiLU11c3RlciBibGVpYmVuIGhpZXIgYmV3dXNzdCB1bmFuZ2V0YXN0ZXQsXG4vLyBzaWVoZSBLb21tZW50YXIgYmVpIERZTkFNSUNfUExBQ0VIT0xERVJfUEFUVEVSTi4gZmlsZSAob3B0aW9uYWwpIHdpcmQgYW5cbi8vIHJlc29sdmUoKSBkdXJjaGdlcmVpY2h0IC0gbnVyIHZvbiBcInt7Y3JlYXRlZH19XCIgZ2VudXR6dCwgc2llaGUgb2Jlbi5cbmZ1bmN0aW9uIHJlc29sdmVGcm9udG1hdHRlclBsYWNlaG9sZGVycyhmcm9udG1hdHRlciwgZmlsZSkge1xuICBjb25zdCByZXNvbHZlZCA9IHt9O1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhmcm9udG1hdHRlcikpIHtcbiAgICBjb25zdCBwbGFjZWhvbGRlciA9IEZST05UTUFUVEVSX1BMQUNFSE9MREVSUy5maW5kKChwKSA9PiBwLnRva2VuID09PSB2YWx1ZSk7XG4gICAgcmVzb2x2ZWRba2V5XSA9IHBsYWNlaG9sZGVyID8gcGxhY2Vob2xkZXIucmVzb2x2ZShmaWxlKSA6IHZhbHVlO1xuICB9XG4gIHJldHVybiByZXNvbHZlZDtcbn1cblxuZnVuY3Rpb24gaXNQbGFjZWhvbGRlclRva2VuKHZhbHVlKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZTtcbiAgaWYgKEZST05UTUFUVEVSX1BMQUNFSE9MREVSUy5zb21lKChwKSA9PiBwLnRva2VuID09PSB2YWx1ZSkpIHJldHVybiB0cnVlO1xuICByZXR1cm4gRFlOQU1JQ19QTEFDRUhPTERFUl9QQVRURVJOLnRlc3QodmFsdWUpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgRlJPTlRNQVRURVJfUExBQ0VIT0xERVJTLFxuICBEWU5BTUlDX1BMQUNFSE9MREVSX1BBVFRFUk4sXG4gIERZTkFNSUNfUExBQ0VIT0xERVJfSU5GTyxcbiAgcmVzb2x2ZUZyb250bWF0dGVyUGxhY2Vob2xkZXJzLFxuICBpc1BsYWNlaG9sZGVyVG9rZW4sXG59O1xuIiwgImNvbnN0IHsgVEZpbGUsIFZhdWx0LCBkZWJvdW5jZSwgbm9ybWFsaXplUGF0aCB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBGUk9OVE1BVFRFUl9QTEFDRUhPTERFUlMgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXBsYWNlaG9sZGVyc1wiKTtcblxuLy8gTWFya2VyLUtsYXNzZSBhbSBDb250YWluZXIgZGVzIFN0YW5kYXJkLUZyb250bWF0dGVyLUVkaXRvcnMgKGdlc2V0enQgaW5cbi8vIG1vdW50VHlwZUZyb250bWF0dGVyRWRpdG9yLCB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcykgLSBncmVuenQgZGllXG4vLyBQbGF0emhhbHRlci1Wb3JzY2hsXHUwMEU0Z2UgdW50ZW4gYXVmIGRpZXNlbiBFZGl0b3IgZWluLCBlY2h0ZSBOb3RpemVuIGJsZWliZW5cbi8vIHVuYmVyXHUwMEZDaHJ0LlxuY29uc3QgRURJVE9SX0NMQVNTID0gXCJmcmVkLXR5cC1mcm9udG1hdHRlci1lZGl0b3JcIjtcblxuLy8gTnVyIFRlbXBsYXRlci1Ta3JpcHRlIG1pdCBkaWVzZW0gTWFya2VyIGluIGVpbmVtIEtvbW1lbnRhciB3ZXJkZW4gYWxzXG4vLyBcInt7dHAuPFNrcmlwdG5hbWU+fX1cIiB2b3JnZXNjaGxhZ2VuIC0gcmVpbmUgSGlsZnNza3JpcHRlICh6LiBCLlxuLy8gdG9MaXN0SWZNdWx0aXBsZSwgVFlQIHNlbGJzdCkgZXJnZWJlbiBhbHMgU2hvcnRjdXQga2VpbmVuIFNpbm4uXG5jb25zdCBTSE9SVENVVF9NQVJLRVIgPSAvXlxccyooPzpcXC9cXC98XFwvXFwqfFxcKikuKkB0eXAtc2hvcnRjdXRcXGIvbTtcblxuLy8gUGxhdHpoYWx0ZXItVm9yc2NobFx1MDBFNGdlIGltIFdlcnQtRmVsZCBkZXMgU3RhbmRhcmQtRnJvbnRtYXR0ZXItRWRpdG9ycyxcbi8vIHNvYmFsZCBkZXIgV2VydCBtaXQgXCJ7XCIgYmVnaW5udDogZGllIGZlc3RlbiBUb2tlbiAoe3t0b2RheX19IHVzdy4pIHNvd2llXG4vLyBcInt7dHAuPFNrcmlwdG5hbWU+fX1cIiBmXHUwMEZDciBqZWRlcyBtYXJraWVydGUgVGVtcGxhdGVyLVNrcmlwdC5cbi8vXG4vLyBPYnNpZGlhbnMgV2VydC1Wb3JzY2hsXHUwMEU0Z2UgKFRleHQtIHVuZCBMaXN0ZW4tUHJvcGVydGllcykgaG9sZW4gaWhyZVxuLy8gS2FuZGlkYXRlbiBhdXNzY2hsaWVcdTAwREZsaWNoIFx1MDBGQ2JlciBtZXRhZGF0YUNhY2hlLmdldEZyb250bWF0dGVyUHJvcGVydHlWYWx1ZXNGb3JLZXlcbi8vIChrZXkpIHVuZCBmaWx0ZXJuL3NvcnRpZXJlbi9yZW5kZXJuIHNpZSBkYW5hY2ggc2VsYnN0IChmdXp6eSBnZWdlbiBkZW5cbi8vIGdldGlwcHRlbiBUZXh0LCBzaWVoZSBnZXRTdWdnZXN0aW9ucyBkZXIgUHJvcGVydHktV2VydC1TdWdnZXN0LUtsYXNzZSBpbVxuLy8gZ2ViYXV0ZW4gYXBwLmpzKS4gU3RhdHQgZWluZSBlaWdlbmUgU3VnZ2VzdC1Lb21wb25lbnRlIGRhbmViZW56dXNldHplblxuLy8gKGRpZSBtaXQgZGVyIG5hdGl2ZW4ga29ua3VycmllcmVuIHdcdTAwRkNyZGUpLCB3aXJkIGRlc2hhbGIgbnVyIGRpZXNlIGVpbmVcbi8vIE1ldGhvZGUgdW1oXHUwMEZDbGx0OiBMaWVndCBkZXIgRm9rdXMgZ2VyYWRlIGluIGVpbmVtIFdlcnQtRmVsZCBkaWVzZXMgRWRpdG9yc1xuLy8gdW5kIGJlZ2lubnQgZGVyIFdlcnQgbWl0IFwie1wiLCBrb21tZW4gZGllIFBsYXR6aGFsdGVyIHZvcm5lIGRhenUgLSBzb25zdFxuLy8gdW52ZXJcdTAwRTRuZGVydCBkYXMgT3JpZ2luYWwuIERlciBBdWZydWYgcGFzc2llcnQgc3luY2hyb24gYmVpbSBUaXBwZW4sIGRlclxuLy8gRm9rdXMgaXN0IGRhYmVpIHp1dmVybFx1MDBFNHNzaWcgZGFzIEVpbmdhYmVmZWxkIHNlbGJzdC5cbi8vXG4vLyBEaWUgU2tyaXB0bGlzdGUgd2lyZCB2b3JhYiAoYXN5bmNocm9uKSBhdXMgVGVtcGxhdGVycyBTa3JpcHQtT3JkbmVyXG4vLyBnZWxlc2VuIHVuZCBiZWkgXHUwMEM0bmRlcnVuZ2VuIGRhcmluIG5hY2hnZWZcdTAwRkNocnQgLSBkaWUgdW1oXHUwMEZDbGx0ZSBNZXRob2RlIG11c3Ncbi8vIHN5bmNocm9uIGJsZWliZW4gdW5kIGthbm4gRGF0ZWllbiBuaWNodCBlcnN0IGJlaW0gVGlwcGVuIGxlc2VuLlxuZnVuY3Rpb24gcmVnaXN0ZXJQbGFjZWhvbGRlclN1Z2dlc3QocGx1Z2luKSB7XG4gIGNvbnN0IHsgYXBwIH0gPSBwbHVnaW47XG4gIGNvbnN0IG1ldGFkYXRhQ2FjaGUgPSBhcHAubWV0YWRhdGFDYWNoZTtcblxuICBsZXQgc2NyaXB0Rm9sZGVyID0gbnVsbDtcbiAgbGV0IHNob3J0Y3V0U2NyaXB0cyA9IFtdO1xuXG4gIGNvbnN0IGN1cnJlbnRTY3JpcHRGb2xkZXIgPSAoKSA9PiB7XG4gICAgY29uc3QgZm9sZGVyID0gYXBwLnBsdWdpbnMucGx1Z2luc1tcInRlbXBsYXRlci1vYnNpZGlhblwiXT8uc2V0dGluZ3M/LnVzZXJfc2NyaXB0c19mb2xkZXI7XG4gICAgcmV0dXJuIGZvbGRlciA/IG5vcm1hbGl6ZVBhdGgoZm9sZGVyKSA6IG51bGw7XG4gIH07XG5cbiAgY29uc3QgaXNJblNjcmlwdEZvbGRlciA9IChwYXRoKSA9PiAhIXNjcmlwdEZvbGRlciAmJiAhIXBhdGggJiYgcGF0aC5zdGFydHNXaXRoKHNjcmlwdEZvbGRlciArIFwiL1wiKTtcblxuICAvLyBXaWUgVGVtcGxhdGVyIHNlbGJzdDogYWxsZSAuanMtRGF0ZWllbiBpbSBTa3JpcHQtT3JkbmVyIGlua2wuXG4gIC8vIFVudGVyb3JkbmVybiwgU2tyaXB0bmFtZSA9IERhdGVpbmFtZSBvaG5lIEVuZHVuZy5cbiAgYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFNjcmlwdHMoKSB7XG4gICAgY29uc3QgZm9sZGVyUGF0aCA9IGN1cnJlbnRTY3JpcHRGb2xkZXIoKTtcbiAgICBzY3JpcHRGb2xkZXIgPSBmb2xkZXJQYXRoO1xuICAgIGNvbnN0IGZvbGRlciA9IGZvbGRlclBhdGggPyBhcHAudmF1bHQuZ2V0Rm9sZGVyQnlQYXRoKGZvbGRlclBhdGgpIDogbnVsbDtcbiAgICBjb25zdCBmaWxlcyA9IFtdO1xuICAgIGlmIChmb2xkZXIpIHtcbiAgICAgIFZhdWx0LnJlY3Vyc2VDaGlsZHJlbihmb2xkZXIsIChjaGlsZCkgPT4ge1xuICAgICAgICBpZiAoY2hpbGQgaW5zdGFuY2VvZiBURmlsZSAmJiBjaGlsZC5leHRlbnNpb24gPT09IFwianNcIikgZmlsZXMucHVzaChjaGlsZCk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgY29uc3QgbmFtZXMgPSBbXTtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmIChTSE9SVENVVF9NQVJLRVIudGVzdChhd2FpdCBhcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKSkpIG5hbWVzLnB1c2goZmlsZS5iYXNlbmFtZSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYFRZUC1TeXN0ZW06IFRlbXBsYXRlci1Ta3JpcHQgJHtmaWxlLnBhdGh9IG5pY2h0IGxlc2JhcmAsIGUpO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBPcmRuZXIgendpc2NoZW56ZWl0bGljaCBpbiBUZW1wbGF0ZXIgdW1nZXN0ZWxsdDogRXJnZWJuaXMgdmVyd2VyZmVuLFxuICAgIC8vIGRlciBMYXVmIGZcdTAwRkNyIGRlbiBuZXVlbiBPcmRuZXIgaXN0IGJlcmVpdHMgYW5nZXN0b1x1MDBERmVuLlxuICAgIGlmIChmb2xkZXJQYXRoICE9PSBzY3JpcHRGb2xkZXIpIHJldHVybjtcbiAgICBzaG9ydGN1dFNjcmlwdHMgPSBuYW1lcy5zb3J0KChhLCBiKSA9PiBhLmxvY2FsZUNvbXBhcmUoYikpO1xuICB9XG5cbiAgY29uc3Qgc2NoZWR1bGVSZWZyZXNoID0gZGVib3VuY2UocmVmcmVzaFNjcmlwdHMsIDMwMCwgdHJ1ZSk7XG4gIGNvbnN0IG9uRmlsZUNoYW5nZSA9IChmaWxlLCBvbGRQYXRoKSA9PiB7XG4gICAgaWYgKGlzSW5TY3JpcHRGb2xkZXIoZmlsZT8ucGF0aCkgfHwgaXNJblNjcmlwdEZvbGRlcihvbGRQYXRoKSkgc2NoZWR1bGVSZWZyZXNoKCk7XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcImNyZWF0ZVwiLCBvbkZpbGVDaGFuZ2UpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwibW9kaWZ5XCIsIG9uRmlsZUNoYW5nZSkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJkZWxldGVcIiwgb25GaWxlQ2hhbmdlKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcInJlbmFtZVwiLCBvbkZpbGVDaGFuZ2UpKTtcbiAgYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHJlZnJlc2hTY3JpcHRzKTtcblxuICBjb25zdCBwbGFjZWhvbGRlclRva2VucyA9ICgpID0+IFtcbiAgICAuLi5GUk9OVE1BVFRFUl9QTEFDRUhPTERFUlMubWFwKChwKSA9PiBwLnRva2VuKSxcbiAgICAuLi5zaG9ydGN1dFNjcmlwdHMubWFwKChuYW1lKSA9PiBge3t0cC4ke25hbWV9fX1gKSxcbiAgXTtcblxuICBjb25zdCBvcmlnaW5hbCA9IG1ldGFkYXRhQ2FjaGUuZ2V0RnJvbnRtYXR0ZXJQcm9wZXJ0eVZhbHVlc0ZvcktleTtcbiAgY29uc3Qgd3JhcHBlZCA9IGZ1bmN0aW9uICguLi5hcmdzKSB7XG4gICAgY29uc3QgdmFsdWVzID0gb3JpZ2luYWwuYXBwbHkodGhpcywgYXJncyk7XG4gICAgY29uc3QgaW5wdXRFbCA9IGFjdGl2ZURvY3VtZW50LmFjdGl2ZUVsZW1lbnQ7XG4gICAgaWYgKCFpbnB1dEVsPy5jbG9zZXN0Py4oYC4ke0VESVRPUl9DTEFTU31gKSkgcmV0dXJuIHZhbHVlcztcbiAgICBjb25zdCB0ZXh0ID0gdHlwZW9mIGlucHV0RWwudmFsdWUgPT09IFwic3RyaW5nXCIgPyBpbnB1dEVsLnZhbHVlIDogaW5wdXRFbC50ZXh0Q29udGVudCA/PyBcIlwiO1xuICAgIGlmICghdGV4dC50cmltU3RhcnQoKS5zdGFydHNXaXRoKFwie1wiKSkgcmV0dXJuIHZhbHVlcztcblxuICAgIC8vIFRlbXBsYXRlci1PcmRuZXIgaW56d2lzY2hlbiB1bWdlc3RlbGx0OiBmXHUwMEZDciBkZW4gblx1MDBFNGNoc3RlbiBUYXN0ZW5kcnVja1xuICAgIC8vIG5hY2hsYWRlbiwgamV0enQgbm9jaCBtaXQgZGVyIGJpc2hlcmlnZW4gTGlzdGUgYW50d29ydGVuLlxuICAgIGlmIChjdXJyZW50U2NyaXB0Rm9sZGVyKCkgIT09IHNjcmlwdEZvbGRlcikgc2NoZWR1bGVSZWZyZXNoKCk7XG4gICAgY29uc3QgdG9rZW5zID0gcGxhY2Vob2xkZXJUb2tlbnMoKTtcbiAgICByZXR1cm4gWy4uLnRva2VucywgLi4udmFsdWVzLmZpbHRlcigodikgPT4gIXRva2Vucy5pbmNsdWRlcyh2KSldO1xuICB9O1xuICBtZXRhZGF0YUNhY2hlLmdldEZyb250bWF0dGVyUHJvcGVydHlWYWx1ZXNGb3JLZXkgPSB3cmFwcGVkO1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIGlmIChtZXRhZGF0YUNhY2hlLmdldEZyb250bWF0dGVyUHJvcGVydHlWYWx1ZXNGb3JLZXkgPT09IHdyYXBwZWQpIHtcbiAgICAgIG1ldGFkYXRhQ2FjaGUuZ2V0RnJvbnRtYXR0ZXJQcm9wZXJ0eVZhbHVlc0ZvcktleSA9IG9yaWdpbmFsO1xuICAgIH1cbiAgfSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclBsYWNlaG9sZGVyU3VnZ2VzdCwgRURJVE9SX0NMQVNTIH07XG4iLCAiY29uc3QgeyBNYXJrZG93blZpZXcsIE1lbnUgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgaXNQbGFjZWhvbGRlclRva2VuIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1wbGFjZWhvbGRlcnNcIik7XG5jb25zdCB7IEVESVRPUl9DTEFTUzogUExBQ0VIT0xERVJfU1VHR0VTVF9FRElUT1JfQ0xBU1MgfSA9IHJlcXVpcmUoXCIuL3BsYWNlaG9sZGVyLXN1Z2dlc3RcIik7XG5cbmNvbnN0IFRZUF9QUk9QRVJUWSA9IFwiVFlQXCI7XG5cbi8vIERlciBXZXJ0IGRlciBUWVAtUHJvcGVydHkgaXN0IHBlciBEZWZpbml0aW9uIGltbWVyIGRlciBUWVAtTmFtZSBzZWxic3QgLVxuLy8gYWxzIFwiU3RhbmRhcmRcIi1Qcm9wZXJ0eSB3XHUwMEU0cmUgc2llIGFsc28gcmVkdW5kYW50IHVuZCBrXHUwMEY2bm50ZSBiZWkgZWluZXJcbi8vIFVtYmVuZW5udW5nIGRlcyBUWVBzICh1bmJlbWVya3QpIHZvbSB0YXRzXHUwMEU0Y2hsaWNoZW4gTmFtZW4gYWJ3ZWljaGVuLiBTaWVcbi8vIGRhcmYgZGVzaGFsYiBpbiBkaWVzZW0gRWRpdG9yIGdhciBuaWNodCBlcnN0IGFscyBlaWdlbmUgWmVpbGUgYXVmdGF1Y2hlbi5cbi8vIE11dGllcnQgXCJmcm9udG1hdHRlclwiIGluLXBsYWNlIChzdGF0dCBlaW5lIEtvcGllIHp1clx1MDBGQ2NrenVnZWJlbikgLSBPYnNpZGlhbnNcbi8vIFByb3BlcnR5LUVkaXRvciBzY2hlaW50IGJlaW0gc3luY2hyb25pemUoKSBhdWYgZWluZSBzdGFiaWxlIE9iamVrdHJlZmVyZW56XG4vLyBhbmdld2llc2VuIHp1IHNlaW47IGVpbmUgbmV1IGVyemV1Z3RlIEtvcGllIGhhdCBiZWltIGFsbGVyZXJzdGVuIFJlbmRlcm4genVcbi8vIGVpbmVtIFN0YWNrIE92ZXJmbG93IGluIE9ic2lkaWFucyBlaWdlbmVyIHJlbmRlclByb3BlcnR5KCktUGlwZWxpbmUgZ2VmXHUwMEZDaHJ0LlxuZnVuY3Rpb24gc3RyaXBUeXBQcm9wZXJ0eShmcm9udG1hdHRlcikge1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikpIHtcbiAgICBpZiAoa2V5LnRyaW0oKS50b0xvd2VyQ2FzZSgpID09PSBUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSkgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XG4gIH1cbiAgcmV0dXJuIGZyb250bWF0dGVyO1xufVxuXG4vLyBPYnNpZGlhbnMgZWlnZW5lcyBGcm9udG1hdHRlci1XaWRnZXQgKFwiUHJvcGVydGllc1wiKSBpc3Qga2VpbmUgb2ZmaXppZWxsZVxuLy8gUGx1Z2luLUFQSS4gSW50ZXJuIGlzdCBlcyBlaW5lIENvbXBvbmVudC1LbGFzc2UgKGltIGdlYmF1dGVuIGFwcC5qcyB6dVxuLy8gXCJNZXRhZGF0YUVkaXRvclwiIG1pbmlmaXppZXJ0KSwgZGllIHNvd29obCB2b24gamVkZXIgTWFya2Rvd25WaWV3IGFscyBhdWNoIHZvblxuLy8gZGVyIGVpbmdlYmF1dGVuIFwiRmlsZSBQcm9wZXJ0aWVzXCItUGFuZSB2ZXJ3ZW5kZXQgd2lyZCAtIGJlaWRlIGxlZ2VuIHNpY2ggYmVpbVxuLy8gRXJ6ZXVnZW4gdW5jb25kaXRpb25hbCBlaW5lIEluc3RhbnogdW50ZXIgdmlldy5tZXRhZGF0YUVkaXRvciBhbi4gRGllIEtsYXNzZVxuLy8gc2VsYnN0IHdpcmQgbmlyZ2VuZHMgdW50ZXIgZWluZW0gTmFtZW4gZXhwb3J0aWVydCwgaXN0IGFiZXIgXHUwMEZDYmVyIGVpbmVcbi8vIGJlbGllYmlnZSBiZXJlaXRzIHZvcmhhbmRlbmUgSW5zdGFueiBlcnJlaWNoYmFyIChpbnN0YW5jZS5jb25zdHJ1Y3RvcikgdW5kXG4vLyBibGVpYnQgZlx1MDBGQ3IgZGllIERhdWVyIGRlciBPYnNpZGlhbi1TZXNzaW9uIHN0YWJpbCAtIGVpbm1hbGlnZXMgQWJncmVpZmVuIHVuZFxuLy8gWndpc2NoZW5zcGVpY2hlcm4gcmVpY2h0IGRlc2hhbGIgYXVzLlxubGV0IGNhY2hlZEVkaXRvckNsYXNzID0gbnVsbDtcblxuZnVuY3Rpb24gZ2V0TWV0YWRhdGFFZGl0b3JDbGFzcyhhcHApIHtcbiAgaWYgKGNhY2hlZEVkaXRvckNsYXNzKSByZXR1cm4gY2FjaGVkRWRpdG9yQ2xhc3M7XG5cbiAgY29uc3QgYWN0aXZlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gIGlmIChhY3RpdmU/Lm1ldGFkYXRhRWRpdG9yKSB7XG4gICAgY2FjaGVkRWRpdG9yQ2xhc3MgPSBhY3RpdmUubWV0YWRhdGFFZGl0b3IuY29uc3RydWN0b3I7XG4gICAgcmV0dXJuIGNhY2hlZEVkaXRvckNsYXNzO1xuICB9XG4gIGZvciAoY29uc3QgbGVhZiBvZiBhcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgaWYgKGxlYWYudmlldz8ubWV0YWRhdGFFZGl0b3IpIHtcbiAgICAgIGNhY2hlZEVkaXRvckNsYXNzID0gbGVhZi52aWV3Lm1ldGFkYXRhRWRpdG9yLmNvbnN0cnVjdG9yO1xuICAgICAgcmV0dXJuIGNhY2hlZEVkaXRvckNsYXNzO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLy8gQW5hbG9nIHp1IGdldE1ldGFkYXRhRWRpdG9yQ2xhc3Mgb2JlbjogUmVmZXJlbnogYXVmIGRpZSBwcml2YXRlIFByb3BlcnR5LVxuLy8gWmVpbGVuLUtsYXNzZSAoaW0gZ2ViYXV0ZW4gYXBwLmpzIG1pbmlmaXppZXJ0KSwgXHUwMEZDYmVyIGVpbmUgYmVyZWl0c1xuLy8gZ2VyZW5kZXJ0ZSBaZWlsZSBhYmdlZ3JpZmZlbiAoZGVyZW4gLmNvbnN0cnVjdG9yKSAtIHN0YWJpbCBmXHUwMEZDciBkaWUgRGF1ZXJcbi8vIGRlciBTZXNzaW9uLiBcImVkaXRvclwiIChmYWxscyBzY2hvbiB2b3JoYW5kZW4pIHdpcmQgenVlcnN0IHByb2JpZXJ0LCBkYVxuLy8gZGllc2UgS2xhc3NlIGF1c3NjaGxpZVx1MDBERmxpY2ggZlx1MDBGQ3IgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goKSBnZWJyYXVjaHQgd2lyZFxuLy8gdW5kIGluIGFsbGVyIFJlZ2VsIHNjaG9uIGRvcnQgdmVyZlx1MDBGQ2diYXIgaXN0LCBzb2JhbGQgZGVyIFR5cCBtaW5kZXN0ZW5zXG4vLyBlaW5lIFByb3BlcnR5IGhhdC5cbmxldCBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzID0gbnVsbDtcblxuZnVuY3Rpb24gZ2V0UHJvcGVydHlSb3dDbGFzcyhhcHAsIGVkaXRvcikge1xuICBpZiAoY2FjaGVkUHJvcGVydHlSb3dDbGFzcykgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XG4gIGlmIChlZGl0b3I/LnJlbmRlcmVkPy5bMF0pIHtcbiAgICBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzID0gZWRpdG9yLnJlbmRlcmVkWzBdLmNvbnN0cnVjdG9yO1xuICAgIHJldHVybiBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzO1xuICB9XG4gIGNvbnN0IGFjdGl2ZSA9IGFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICBpZiAoYWN0aXZlPy5tZXRhZGF0YUVkaXRvcj8ucmVuZGVyZWQ/LlswXSkge1xuICAgIGNhY2hlZFByb3BlcnR5Um93Q2xhc3MgPSBhY3RpdmUubWV0YWRhdGFFZGl0b3IucmVuZGVyZWRbMF0uY29uc3RydWN0b3I7XG4gICAgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XG4gIH1cbiAgZm9yIChjb25zdCBsZWFmIG9mIGFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICBpZiAobGVhZi52aWV3Py5tZXRhZGF0YUVkaXRvcj8ucmVuZGVyZWQ/LlswXSkge1xuICAgICAgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IGxlYWYudmlldy5tZXRhZGF0YUVkaXRvci5yZW5kZXJlZFswXS5jb25zdHJ1Y3RvcjtcbiAgICAgIHJldHVybiBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLy8gRXJnXHUwMEU0bnp0IGRhcyBSZWNodHNrbGljay1Lb250ZXh0bWVuXHUwMEZDIGVpbmVyIFByb3BlcnR5LVplaWxlIHVtIGVpbmVuIFRvZ2dsZVxuLy8gXCJGbG9hdGluZ1wiIEdBTlogT0JFTiAtIGFiZXIgZXhrbHVzaXYgZlx1MDBGQ3IgWmVpbGVuIGRpZXNlcyBQbHVnaW5zXG4vLyBlaWdlbmVyIFRZUC1EZXRhaWxhbnNpY2h0IChlcmthbm50IGFuIG93bmVyLmZyZWRWaWV3LCBzaWVoZSB1bnRlbiksIG5pZSBpblxuLy8gZWNodGVuIE5vdGl6ZW4uIFVuYWJoXHUwMEU0bmdpZyB2b20gXCIrXCItQnV0dG9uIGxpbmtzIG5lYmVuIGRlbSBub3JtYWxlblxuLy8gKGZyZWRQZW5kaW5nRmxvYXRpbmdBZGQpLCBkZXIgbnVyIGJlaW0gTkVVRU4gQW5sZWdlbiBncmVpZnQgLSBkaWVzZXIgVG9nZ2xlXG4vLyB3aXJrdCBhdWYgSkVERSBiZXJlaXRzIHZvcmhhbmRlbmUgUHJvcGVydHksIGluIGJlaWRlIFJpY2h0dW5nZW4uXG4vL1xuLy8gT2JzaWRpYW5zIFByb3BlcnR5LUtvbnRleHRtZW5cdTAwRkMgaXN0IGtlaW5lIG9mZml6aWVsbGUgRXJ3ZWl0ZXJ1bmdzc3RlbGxlOiBFc1xuLy8gYmF1dCBhdWYgZGVtIERlc2t0b3AgZWluZW4gTkFUSVZFTiBFbGVjdHJvbi1NZW5cdTAwRkMgYXVzIGVpbmVyIGludGVyblxuLy8gZXJ6ZXVndGVuIE1lbnUtSW5zdGFueiB1bmQgemVpZ3Qgc2llIGlubmVyaGFsYiB2b24gc2hvd1Byb3BlcnR5TWVudSgpIGluXG4vLyBlaW5lbSBlaW56aWdlbiBzeW5jaHJvbmVuIEF1ZnJ1ZiBhbiAoa2VpbiBXb3Jrc3BhY2UtRXZlbnQsIGtlaW4gRE9NLVBvcHVwLFxuLy8gZGFzIHNpY2ggbmFjaHRyXHUwMEU0Z2xpY2ggcGVyIERPTS1NYW5pcHVsYXRpb24gZXJ3ZWl0ZXJuIGxpZVx1MDBERmUgLSBhbmRlcnMgYWxzXG4vLyB6LiBCLiBiZWkgXCJmaWxlLW1lbnVcIikuIERlc2hhbGIgaGllciBlaW4gTW9ua2V5LVBhdGNoIGF1ZiBkaWUgcHJpdmF0ZVxuLy8gWmVpbGVuLUtsYXNzZSBzZWxic3QgKHdpZSBzY2hvbiBiZWltIEdyYXBoLVJlbmRlcmVyLCBzaWVoZVxuLy8gZ3JhcGgtY29sb3JzLmpzKSwgYWJlciBzbyBlbmcgd2llIG1cdTAwRjZnbGljaCBnZWhhbHRlbjogZlx1MDBGQ3IgWmVpbGVuIGRpZXNlc1xuLy8gUGx1Z2lucyB3aXJkIGxlZGlnbGljaCwgdW5taXR0ZWxiYXIgYmV2b3IgT2JzaWRpYW4gc2VpbmUgYmVyZWl0cyBmZXJ0aWdcbi8vIGF1ZmdlYmF1dGUgTWVudS1JbnN0YW56IGFuemVpZ3QsIGVpbiBlaW56aWdlciB6dXNcdTAwRTR0emxpY2hlciBhZGRJdGVtKCktQXVmcnVmXG4vLyBkYXp3aXNjaGVuZ2VzY2hvYmVuIChcdTAwRkNiZXIgZWluZW4gbnVyIGZcdTAwRkNyIGRpZXNlbiBlaW5lbiBzeW5jaHJvbmVuIEF1ZnJ1ZlxuLy8gYWt0aXZlbiwgc2ljaCBkYW5hY2ggc2VsYnN0IHdpZWRlciB6dXJcdTAwRkNja3NldHplbmRlbiBQYXRjaCBhdWZcbi8vIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnQgLSBzaWNoZXIsIGRhIEpTIHNpbmdsZS10aHJlYWRlZCBpc3QgdW5kXG4vLyB3XHUwMEU0aHJlbmRkZXNzZW4ga2VpbiB6d2VpdGVzIE1lblx1MDBGQyBhdWZnZWJhdXQgd2VyZGVuIGthbm4pLiBEaWUgZ2VzYW10ZSBcdTAwRkNicmlnZVxuLy8gbmF0aXZlIE1lblx1MDBGQy1Mb2dpayAoVHlwIFx1MDBFNG5kZXJuLCBBdXNzY2huZWlkZW4vS29waWVyZW4vRWluZlx1MDBGQ2dlbiwgRW50ZmVybmVuKVxuLy8gYmxlaWJ0IGRhYmVpIGtvbXBsZXR0IHVuYW5nZXRhc3RldC5cbmZ1bmN0aW9uIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKGFwcCwgZWRpdG9yKSB7XG4gIGNvbnN0IFJvd0NsYXNzID0gZ2V0UHJvcGVydHlSb3dDbGFzcyhhcHAsIGVkaXRvcik7XG4gIGlmICghUm93Q2xhc3MgfHwgUm93Q2xhc3MuX2ZyZWRNZW51UGF0Y2hlZCkgcmV0dXJuO1xuICBSb3dDbGFzcy5fZnJlZE1lbnVQYXRjaGVkID0gdHJ1ZTtcblxuICBjb25zdCBvcmlnaW5hbFNob3dQcm9wZXJ0eU1lbnUgPSBSb3dDbGFzcy5wcm90b3R5cGUuc2hvd1Byb3BlcnR5TWVudTtcbiAgUm93Q2xhc3MucHJvdG90eXBlLnNob3dQcm9wZXJ0eU1lbnUgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICBjb25zdCBvd25lciA9IHRoaXMubWV0YWRhdGFFZGl0b3I/Lm93bmVyO1xuICAgIGlmICghb3duZXI/LmZyZWRWaWV3KSByZXR1cm4gb3JpZ2luYWxTaG93UHJvcGVydHlNZW51LmNhbGwodGhpcywgZXZlbnQpO1xuXG4gICAgY29uc3Qgcm93ID0gdGhpcztcbiAgICBjb25zdCBvcmlnaW5hbFNob3dBdE1vdXNlRXZlbnQgPSBNZW51LnByb3RvdHlwZS5zaG93QXRNb3VzZUV2ZW50O1xuICAgIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnQgPSBmdW5jdGlvbiAobW91c2VFdmVudCkge1xuICAgICAgTWVudS5wcm90b3R5cGUuc2hvd0F0TW91c2VFdmVudCA9IG9yaWdpbmFsU2hvd0F0TW91c2VFdmVudDtcbiAgICAgIGNvbnN0IGlzRmxvYXRpbmcgPSAob3duZXIuZnJlZFZpZXcucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbb3duZXIuZnJlZFR5cGVdID8/IFtdKS5pbmNsdWRlcyhcbiAgICAgICAgcm93LmVudHJ5LmtleVxuICAgICAgKTtcbiAgICAgIC8vIFwidGl0bGVcIiBpc3QgZGllIGVyc3RlIGRlciB2b24gc2hvd1Byb3BlcnR5TWVudSByZWdpc3RyaWVydGVuXG4gICAgICAvLyBTZWN0aW9ucyAoYWRkU2VjdGlvbnMoWy4uLl0pKSB1bmQgYXVmIGRlbSBEZXNrdG9wIHNvbnN0IGxlZXIgKG51clxuICAgICAgLy8gYXVmIE1vYmlsZSBtaXQgZWluZW0gcmVpbmVuIExhYmVsLUVpbnRyYWcgYmVsZWd0KSAtIGxhbmRldCBhbHNvXG4gICAgICAvLyB6dXZlcmxcdTAwRTRzc2lnIGdhbnogb2Jlbi4gXCJwaW4tb2ZmXCIgKGR1cmNoZ2VzdHJpY2hlbmVyIFBpbikgcGFzc3RcbiAgICAgIC8vIGluaGFsdGxpY2ggenUgXCJuaWNodCBmZXN0IHZlcmFua2VydFwiID0gZmxvYXRpbmcsIGluIEFuYWxvZ2llIHp1XG4gICAgICAvLyBcInBpblwiIGZcdTAwRkNyIFwiZml4aWVydFwiIGluIGFuZGVyZW4gQXBwcy5cbiAgICAgIHRoaXMuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgICAgaXRlbVxuICAgICAgICAgIC5zZXRUaXRsZShcIkZsb2F0aW5nXCIpXG4gICAgICAgICAgLnNldEljb24oXCJwaW4tb2ZmXCIpXG4gICAgICAgICAgLnNldENoZWNrZWQoaXNGbG9hdGluZylcbiAgICAgICAgICAuc2V0U2VjdGlvbihcInRpdGxlXCIpXG4gICAgICAgICAgLm9uQ2xpY2soKCkgPT4gdG9nZ2xlRmxvYXRpbmdQcm9wZXJ0eShvd25lci5mcmVkVmlldywgb3duZXIuZnJlZFR5cGUsIHJvdy5lbnRyeS5rZXkpKVxuICAgICAgKTtcbiAgICAgIHJldHVybiBvcmlnaW5hbFNob3dBdE1vdXNlRXZlbnQuY2FsbCh0aGlzLCBtb3VzZUV2ZW50KTtcbiAgICB9O1xuXG4gICAgcmV0dXJuIG9yaWdpbmFsU2hvd1Byb3BlcnR5TWVudS5jYWxsKHRoaXMsIGV2ZW50KTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gdG9nZ2xlRmxvYXRpbmdQcm9wZXJ0eSh2aWV3LCB0eXBlLCBrZXkpIHtcbiAgY29uc3QgZmxvYXRpbmcgPSB2aWV3LnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdID8/IFtdO1xuICBjb25zdCBuZXh0ID0gZmxvYXRpbmcuaW5jbHVkZXMoa2V5KSA/IGZsb2F0aW5nLmZpbHRlcigoaykgPT4gayAhPT0ga2V5KSA6IFsuLi5mbG9hdGluZywga2V5XTtcbiAgaWYgKG5leHQubGVuZ3RoID4gMCkgdmlldy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSA9IG5leHQ7XG4gIGVsc2UgZGVsZXRlIHZpZXcucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV07XG4gIHZpZXcucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAvLyBBa3R1YWxpc2llcnQgZGllIEZldHQtL0t1cnNpdi1NYXJraWVydW5nIHNvZm9ydCAtIHNvd29obCBpbiBkaWVzZXJcbiAgLy8gRGV0YWlsYW5zaWNodCBhbHMgYXVjaCBpbiBiZXJlaXRzIG9mZmVuZW4gTm90aXplbiBkaWVzZXMgVHlwcy5cbiAgdmlldy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG59XG5cbi8vIERhcyBXaWRnZXQgZXJ3YXJ0ZXQgYWxzIHp3ZWl0ZW4gS29uc3RydWt0b3ItUGFyYW1ldGVyIGVpbiBcIm93bmVyXCItT2JqZWt0IC1cbi8vIGRhcyBpc3QgZGllIGVpbnppZ2UgU2Nobml0dHN0ZWxsZSwgXHUwMEZDYmVyIGRpZSBlcyBhbiBlaW5lIERhdGVpIGdlYnVuZGVuIHdpcmQuXG4vLyBTdGF0dCBlaW5lciBlY2h0ZW4gTm90aXogaFx1MDBFNG5nZW4gd2lyIGVzIGhpZXIgYW4gZWluIFBsYWluLU9iamVjdCBpbiBkZW5cbi8vIFBsdWdpbi1TZXR0aW5nczogc2F2ZUZyb250bWF0dGVyKG9iaikgYmVrb21tdCBiZWkgamVkZXIgXHUwMEM0bmRlcnVuZyAoUHJvcGVydHlcbi8vIGhpbnp1Z2VmXHUwMEZDZ3QvdW1iZW5hbm50L2dlbFx1MDBGNnNjaHQsIFdlcnQgZ2VcdTAwRTRuZGVydCwgUmVpaGVuZm9sZ2UgZ2VcdTAwRTRuZGVydCkgZGFzXG4vLyB2b2xsc3RcdTAwRTRuZGlnZSwgYWt0dWVsbGUgUHJvcGVydHktU2V0IFx1MDBGQ2JlcmdlYmVuLiBzaGlmdEZvY3VzQmVmb3JlL0FmdGVyIHN0ZXVlcm5cbi8vIG51ciwgd29oaW4gZGVyIEZva3VzIGJlaW0gVmVybGFzc2VuIGRlcyBXaWRnZXRzIHBlciBQZmVpbHRhc3RlL1RhYiBzcHJpbmd0LFxuLy8gdW5kIGRcdTAwRkNyZmVuIE5vLU9wcyBzZWluLiBnZXRGaWxlKCkgd2lyZCB2b24gamVkZXIgZWluemVsbmVuIFByb3BlcnR5LVplaWxlXG4vLyBiZWltIFJlbmRlcm4gYXVmZ2VydWZlbiAoZlx1MDBGQ3Igc291cmNlUGF0aCwgei4gQi4gYmVpIExpbmstV2VydGVuKSAtIG9obmVcbi8vIGVjaHRlIERhdGVpIGdpYnQgZXMgaGllciBuaWNodHMgU2lubnZvbGxlcyB6dXJcdTAwRkNja3p1Z2ViZW4sIGFiZXIgZGllIE1ldGhvZGVcbi8vIG11c3MgZXhpc3RpZXJlbiwgc29uc3QgY3Jhc2h0IGRhcyBXaWRnZXQgYmVpbSBSZW5kZXJuIGplZGVyIFByb3BlcnR5LlxuLy9cbi8vIEVpbmUgZWluemlnZSBFZGl0b3ItSW5zdGFueiBwcm8gVHlwLCBnZWJ1bmRlbiBhbiB0eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdXG4vLyAtIFN0YW5kYXJkLSB1bmQgRmxvYXRpbmcgUHJvcGVydGllcyAoc2llaGUgdHlwZUZsb2F0aW5nS2V5cyBpbiBzZXR0aW5ncy5qcylcbi8vIHRlaWxlbiBzaWNoIGRpZXNlbGJlIExpc3RlIHVuZCBSZWloZW5mb2xnZSwgbnVyIEZsb2F0aW5nLW1hcmtpZXJ0ZSBLZXlzXG4vLyB3ZXJkZW4gdm9uIGdldFR5cGVEZWZhdWx0cygpIChtYWluLmpzKSBuaWNodCBhdXRvbWF0aXNjaCBhdXNnZWxpZWZlcnQuXG4vLyBlZGl0b3IuZnJlZFBlbmRpbmdGbG9hdGluZ0FkZCB3aXJkIHZvbiB0eXAtdmlldy5qcyB2b3IgYWRkQmxhbmtQcm9wZXJ0eSgpXG4vLyBnZXNldHp0LCB1bSBkaWUgYWxzIG5cdTAwRTRjaHN0ZXMgaGluenVnZWZcdTAwRkNndGUgKGJ6dy4gdW1iZW5hbm50ZSkgUHJvcGVydHkgYWxzXG4vLyBGbG9hdGluZyB6dSBtYXJraWVyZW4gLSBzaWVoZSBzYXZlRnJvbnRtYXR0ZXIgdW50ZW4uXG5mdW5jdGlvbiBtb3VudFR5cGVGcm9udG1hdHRlckVkaXRvcih2aWV3LCBjb250YWluZXJFbCwgdHlwZSkge1xuICBjb25zdCBhcHAgPSB2aWV3LmFwcDtcbiAgY29uc3QgRWRpdG9yQ2xhc3MgPSBnZXRNZXRhZGF0YUVkaXRvckNsYXNzKGFwcCk7XG4gIGlmICghRWRpdG9yQ2xhc3MpIHtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLXVuYXZhaWxhYmxlXCIsXG4gICAgICB0ZXh0OiBcIlp1bSBJbml0aWFsaXNpZXJlbiBkZXMgRWRpdG9ycyBiaXR0ZSB6dWVyc3QgZWlubWFsIGVpbmUgTm90aXogXHUwMEY2ZmZuZW4uXCIsXG4gICAgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBvd25lciA9IHtcbiAgICBhcHAsXG4gICAgLy8gTWFya2VyIGZcdTAwRkNyIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKCkgb2JlbjogaWRlbnRpZml6aWVydCBQcm9wZXJ0eS1cbiAgICAvLyBaZWlsZW4gZGllc2VzIFBsdWdpbi1laWdlbmVuIEVkaXRvcnMgKG5pZSBlaW5lciBlY2h0ZW4gTm90aXopIHVuZFxuICAgIC8vIGxpZWZlcnQgVHlwL1ZpZXcsIGRpZSBkZXIgZ2xvYmFsZSBNZW5cdTAwRkMtUGF0Y2ggcHJvIFplaWxlIGR5bmFtaXNjaFxuICAgIC8vIGJyYXVjaHQgKGRpZSBQYXRjaC1JbnN0YWxsYXRpb24gc2VsYnN0IHBhc3NpZXJ0IG51ciBlaW5tYWwsIHVuYWJoXHUwMEU0bmdpZ1xuICAgIC8vIGRhdm9uLCB3ZWxjaGVyIFR5cCBkYWJlaSBnZXJhZGUgb2ZmZW4gd2FyKS5cbiAgICBmcmVkVHlwZTogdHlwZSxcbiAgICBmcmVkVmlldzogdmlldyxcbiAgICBnZXRGaWxlKCkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSxcbiAgICAvLyBOdXIgZlx1MDBGQ3IgT2JzaWRpYW5zIEhvdmVyLVByZXZpZXcgYmVpIGludGVybmVuIExpbmtzIGlubmVyaGFsYiBlaW5lc1xuICAgIC8vIFByb3BlcnR5LVdlcnRzIChFdmVudCBcImhvdmVyLWxpbmtcIikgLSBiZWxpZWJpZ2VyIFN0cmluZyByZWljaHQuXG4gICAgZ2V0SG92ZXJTb3VyY2UoKSB7XG4gICAgICByZXR1cm4gXCJmcmVkLXR5cC1mcm9udG1hdHRlclwiO1xuICAgIH0sXG4gICAgc2hpZnRGb2N1c0JlZm9yZSgpIHt9LFxuICAgIHNoaWZ0Rm9jdXNBZnRlcigpIHt9LFxuICAgIC8vIE9ic2lkaWFucyBFZGl0b3IgcnVmdCBkaWVzIGdlbmF1IGVpbm1hbCBwcm8gYWJnZXNjaGxvc3NlbmVyIFx1MDBDNG5kZXJ1bmcgYXVmXG4gICAgLy8gKFJlbmFtZSBlcnN0IGJlaW0gQmx1ciBkZXMgS2V5LUlucHV0cywgc2llaGUgaGFuZGxlVXBkYXRlS2V5IGltXG4gICAgLy8gZ2ViYXV0ZW4gYXBwLmpzKSAtIGplZGVyIEF1ZnJ1ZiB0clx1MDBFNGd0IGhpZXIgYWxzbyBtYXhpbWFsIGVpbmVcbiAgICAvLyBoaW56dWdlZlx1MDBGQ2d0ZSB1bmQvb2RlciBlbnRmZXJudGUgKG5pY2h0LWxlZXJlKSBQcm9wZXJ0eSwgbmllIG1laHJlcmVcbiAgICAvLyBnbGVpY2h6ZWl0aWcgYXVcdTAwREZlciBiZWkgZWluZW0gTWVocmZhY2gtTFx1MDBGNnNjaGVuLiBEYXMgbWFjaHQgZGllXG4gICAgLy8gRmxvYXRpbmctTWFya2llcnVuZyB1bnRlbiByb2J1c3QgbmFjaGZcdTAwRkNocmJhciwgb2huZSBad2lzY2hlbnp1c3RcdTAwRTRuZGVcbiAgICAvLyB3XHUwMEU0aHJlbmQgZGVzIFRpcHBlbnMgdmVyZm9sZ2VuIHp1IG1cdTAwRkNzc2VuLlxuICAgIHNhdmVGcm9udG1hdHRlcihmcm9udG1hdHRlcikge1xuICAgICAgLy8gRmFsbHMgaGllciBnZXJhZGUgZWluZSBaZWlsZSBcIlRZUFwiIGVpbmdlZ2ViZW4gd3VyZGU6IG5pY2h0IFx1MDBGQ2Jlcm5laG1lbi5cbiAgICAgIC8vIFNpZSBibGVpYnQgYmlzIHp1bSBuXHUwMEU0Y2hzdGVuIE5ldS1Nb3VudGVuIHNpY2h0YmFyIChrZWluIGVybmV1dGVyXG4gICAgICAvLyBzeW5jaHJvbml6ZSgpLUF1ZnJ1ZiBoaWVyLCBzaWVoZSBLb21tZW50YXIgYW4gc3RyaXBUeXBQcm9wZXJ0eSkuXG4gICAgICBzdHJpcFR5cFByb3BlcnR5KGZyb250bWF0dGVyKTtcblxuICAgICAgY29uc3QgcHJldmlvdXMgPSB2aWV3LnBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdID8/IHt9O1xuICAgICAgY29uc3QgcHJldmlvdXNLZXlzID0gT2JqZWN0LmtleXMocHJldmlvdXMpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIpO1xuICAgICAgY29uc3QgY3VycmVudEtleXMgPSBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIik7XG4gICAgICBjb25zdCByZW1vdmVkS2V5cyA9IHByZXZpb3VzS2V5cy5maWx0ZXIoKGtleSkgPT4gIWN1cnJlbnRLZXlzLmluY2x1ZGVzKGtleSkpO1xuICAgICAgY29uc3QgYWRkZWRLZXlzID0gY3VycmVudEtleXMuZmlsdGVyKChrZXkpID0+ICFwcmV2aW91c0tleXMuaW5jbHVkZXMoa2V5KSk7XG5cbiAgICAgIGxldCBmbG9hdGluZyA9IHZpZXcucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV0gPz8gW107XG4gICAgICBpZiAocmVtb3ZlZEtleXMubGVuZ3RoID09PSAxICYmIGFkZGVkS2V5cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgLy8gVW1iZW5lbm51bmcgZWluZXIgYmVzdGVoZW5kZW4gUHJvcGVydHkgLSBGbG9hdGluZy1NYXJraWVydW5nIHdhbmRlcnQgbWl0IHVtLlxuICAgICAgICBmbG9hdGluZyA9IGZsb2F0aW5nLm1hcCgoa2V5KSA9PiAoa2V5ID09PSByZW1vdmVkS2V5c1swXSA/IGFkZGVkS2V5c1swXSA6IGtleSkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHJlbW92ZWRLZXlzLmxlbmd0aCA+IDApIGZsb2F0aW5nID0gZmxvYXRpbmcuZmlsdGVyKChrZXkpID0+ICFyZW1vdmVkS2V5cy5pbmNsdWRlcyhrZXkpKTtcbiAgICAgICAgaWYgKGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkICYmIGFkZGVkS2V5cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICBmbG9hdGluZyA9IFsuLi5mbG9hdGluZywgYWRkZWRLZXlzWzBdXTtcbiAgICAgICAgICBlZGl0b3IuZnJlZFBlbmRpbmdGbG9hdGluZ0FkZCA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoZmxvYXRpbmcubGVuZ3RoID4gMCkgdmlldy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSA9IGZsb2F0aW5nO1xuICAgICAgZWxzZSBkZWxldGUgdmlldy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXTtcblxuICAgICAgdmlldy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSA9IGZyb250bWF0dGVyO1xuICAgICAgdmlldy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAvLyBEYW1pdCBkaWUgRmV0dC0vS3Vyc2l2LU1hcmtpZXJ1bmcgaW4gYmVyZWl0cyBvZmZlbmVuIE5vdGl6ZW4gZGllc2VzXG4gICAgICAvLyBUeXBzIHNvZm9ydCBtaXR6aWVodCwgd2VubiBzaWNoIGhpZXIgZGllIFByb3BlcnR5LUxpc3RlIFx1MDBFNG5kZXJ0LlxuICAgICAgdmlldy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgfSxcbiAgfTtcblxuICBjb25zdCBlZGl0b3IgPSBuZXcgRWRpdG9yQ2xhc3MoYXBwLCBvd25lcik7XG4gIGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkID0gZmFsc2U7XG4gIC8vIEdyZW56dCBkaWUgUGxhdHpoYWx0ZXItVm9yc2NobFx1MDBFNGdlIChwbGFjZWhvbGRlci1zdWdnZXN0LmpzKSBhdWYgZGllc2VuIEVkaXRvciBlaW4uXG4gIGVkaXRvci5jb250YWluZXJFbC5hZGRDbGFzcyhQTEFDRUhPTERFUl9TVUdHRVNUX0VESVRPUl9DTEFTUyk7XG4gIGNvbnRhaW5lckVsLmFwcGVuZENoaWxkKGVkaXRvci5jb250YWluZXJFbCk7XG4gIHZpZXcuYWRkQ2hpbGQoZWRpdG9yKTtcblxuICBjb25zdCBkZWZhdWx0cyA9IHZpZXcucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0gPz8ge307XG4gIGNvbnN0IGhhZFR5cCA9IE9iamVjdC5rZXlzKGRlZmF1bHRzKS5zb21lKChrZXkpID0+IGtleS50cmltKCkudG9Mb3dlckNhc2UoKSA9PT0gVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCkpO1xuICBzdHJpcFR5cFByb3BlcnR5KGRlZmF1bHRzKTtcbiAgLy8gRWluIGJlaW0gTGFkZW4gbm9jaCB2b3JoYW5kZW5lcyBUWVAgKHouIEIuIGF1cyBlaW5lciBcdTAwRTRsdGVyZW4gUGx1Z2luLVZlcnNpb24pXG4gIC8vIGRhdWVyaGFmdCBlbnRmZXJuZW4sIHN0YXR0IGVzIG51ciBmXHUwMEZDciBkaWVzZSBTZXNzaW9uIHp1IHZlcnN0ZWNrZW4uXG4gIGlmIChoYWRUeXApIHZpZXcucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICBlZGl0b3Iuc3luY2hyb25pemUoZGVmYXVsdHMpO1xuICBtYXJrUGxhY2Vob2xkZXJSb3dzKGVkaXRvci5jb250YWluZXJFbCwgZGVmYXVsdHMpO1xuICAvLyBFcnN0IG5hY2ggZGVtIGVyc3RlbiBzeW5jaHJvbml6ZSgpIHZlcnN1Y2h0IChzaWVoZSBnZXRQcm9wZXJ0eVJvd0NsYXNzKSAtXG4gIC8vIGJlaSBlaW5lbSBub2NoIGdhbnogbGVlcmVuIFR5cCBoaWVyIGVpbiBOby1PcCwgaG9sdCBzaWNoIGFiZXIgc3BcdTAwRTR0ZXN0ZW5zXG4gIC8vIGJlaW0gblx1MDBFNGNoc3RlbiBNb3VudGVuIGVpbmVzIG5pY2h0LWxlZXJlbiBUeXBzIChvZGVyIGF1cyBlaW5lciBvZmZlbmVuXG4gIC8vIE5vdGl6KSBkaWUgYmVuXHUwMEY2dGlndGUgS2xhc3NlbnJlZmVyZW56IGF1dG9tYXRpc2NoIG5hY2guXG4gIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKGFwcCwgZWRpdG9yKTtcbiAgcmV0dXJuIGVkaXRvcjtcbn1cblxuLy8gT2JzaWRpYW5zIGVpZ2VuZXMgXCJUeXBlIG1pc21hdGNoLCBleHBlY3RlZCAuLi5cIi1XYXJuc3ltYm9sIChvcmFuZ2VzIERyZWllY2ssXG4vLyBLbGFzc2UgXCJtZXRhZGF0YS1wcm9wZXJ0eS13YXJuaW5nLWljb25cIiwgZGlyZWt0ZXMgS2luZCB2b24gXCIubWV0YWRhdGEtcHJvcGVydHlcbi8vIFtkYXRhLXByb3BlcnR5LWtleV1cIikgdmVyZ2xlaWNodCBkZW4gZXJ3YXJ0ZXRlbiBtaXQgZGVtIGF1cyBkZW0gV2VydCBlcmthbm50ZW5cbi8vIFR5cCAtIGJlaSBlaW5lbSBQbGF0emhhbHRlciB3aWUgXCJ7e3RvZGF5fX1cIiBpbiBlaW5lciBhbHMgXCJkYXRlXCIgZGVrbGFyaWVydGVuXG4vLyBQcm9wZXJ0eSAoc2llaGUgLm9ic2lkaWFuL3R5cGVzLmpzb24pIHNjaGxcdTAwRTRndCBkYXMgendhbmdzbFx1MDBFNHVmaWcgYW4sIG9id29obCBkZXJcbi8vIFdlcnQgZXJzdCBcdTAwRkNiZXIgZ2V0VHlwZURlZmF1bHRzKCkgYXVmZ2VsXHUwMEY2c3Qgd2lyZC4gT2JzaWRpYW4gYmxlbmRldCBkYXMgSWNvblxuLy8gXHUwMEZDYmVyIElubGluZS1zdHlsZS5kaXNwbGF5IGVpbiAoa2VpbiBoaWRkZW4tQXR0cmlidXQpIC0gZWluZSAhaW1wb3J0YW50LVJlZ2VsXG4vLyBpbiBzdHlsZXMuY3NzIGdld2lubnQgdHJvdHpkZW0gZGFnZWdlbiwgZGllIGJldHJvZmZlbmUgWmVpbGUgYnJhdWNodCBkYWZcdTAwRkNyIG51clxuLy8gZGllc2UgTWFya2VyLUtsYXNzZS5cbmZ1bmN0aW9uIG1hcmtQbGFjZWhvbGRlclJvd3MoY29udGFpbmVyRWwsIGZyb250bWF0dGVyKSB7XG4gIGZvciAoY29uc3Qgcm93IG9mIGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIubWV0YWRhdGEtcHJvcGVydHlcIikpIHtcbiAgICAvLyBkYXRhLXByb3BlcnR5LWtleSBsaWVndCBiZWkgT2JzaWRpYW4ga2xlaW5nZXNjaHJpZWJlbiB2b3IgKHouIEIuIFwiZGF0dW1cIiksXG4gICAgLy8gdW5zZXJlIGZyb250bWF0dGVyLUtleXMgYWJlciB3aWUgZWluZ2V0cmFnZW4gKHouIEIuIFwiRGF0dW1cIikgLSBkYWhlciBoaWVyXG4gICAgLy8gY2FzZS1pbnNlbnNpdGl2IGdlZ2VuIGRpZSBlY2h0ZW4gS2V5cyBhYmdsZWljaGVuIHN0YXR0IGRpcmVrdCB6dSBpbmRpemllcmVuLlxuICAgIGNvbnN0IHJvd0tleSA9IHJvdy5nZXRBdHRyaWJ1dGUoXCJkYXRhLXByb3BlcnR5LWtleVwiKTtcbiAgICBjb25zdCBhY3R1YWxLZXkgPSBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikuZmluZCgoaykgPT4gay50b0xvd2VyQ2FzZSgpID09PSByb3dLZXk/LnRvTG93ZXJDYXNlKCkpO1xuICAgIHJvdy50b2dnbGVDbGFzcyhcImZyZWQtdHlwLXBsYWNlaG9sZGVyLXZhbHVlXCIsIGlzUGxhY2Vob2xkZXJUb2tlbihmcm9udG1hdHRlclthY3R1YWxLZXldKSk7XG4gIH1cbn1cblxuLy8gRWlnZW5lLCBlaW5mYWNoZSBcIlByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiLUZ1bmt0aW9uIHN0YXR0IGRlcyBpbnRlcm5lblxuLy8gZWRpdG9yLmFkZFByb3BlcnR5KCk6IGZcdTAwRkNndCBlaW5lbiBsZWVyZW4gS2V5IG1pdCBXZXJ0IG51bGwgYW4gdW5kIGxcdTAwRTRzc3QgZGFzXG4vLyBXaWRnZXQgZGllIFplaWxlIGdhbnogbm9ybWFsIHJlbmRlcm4gKGRpZXNlbGJlIE9wdGlrIHdpZSBpbiBlaW5lciBlY2h0ZW5cbi8vIE5vdGl6LCBkYSBzeW5jaHJvbml6ZSgpIHVudmVyXHUwMEU0bmRlcnQgT2JzaWRpYW5zIGVpZ2VuZSBSZW5kZXItUGlwZWxpbmVcbi8vIGR1cmNobFx1MDBFNHVmdCkgLSBkZXIgRm9rdXMgc3ByaW5ndCBhbnNjaGxpZVx1MDBERmVuZCBpbnMgS2V5LUZlbGQgZGVyIG5ldWVuIFplaWxlLlxuZnVuY3Rpb24gYWRkQmxhbmtQcm9wZXJ0eShlZGl0b3IpIHtcbiAgaWYgKCFlZGl0b3IpIHJldHVybjtcbiAgY29uc3QgY3VycmVudCA9IGVkaXRvci5zZXJpYWxpemUoKTtcbiAgaWYgKCFjdXJyZW50Lmhhc093blByb3BlcnR5KFwiXCIpKSB7XG4gICAgY3VycmVudFtcIlwiXSA9IG51bGw7XG4gICAgZWRpdG9yLnN5bmNocm9uaXplKGN1cnJlbnQpO1xuICB9XG4gIGVkaXRvci5mb2N1c0tleShcIlwiKTtcbiAgLy8gRGVja3QgZGVuIEZhbGwgYWIsIGRhc3MgbW91bnRUeXBlRnJvbnRtYXR0ZXJFZGl0b3IoKSBiZWkgZWluZW0genUgZGllc2VtXG4gIC8vIFplaXRwdW5rdCBub2NoIGdhbnogbGVlcmVuIFR5cCAodW5kIG9obmUgb2ZmZW5lIE5vdGl6KSBrZWluZSBaZWlsZW4tS2xhc3NlXG4gIC8vIHp1bSBQYXRjaGVuIGZpbmRlbiBrb25udGUgLSBqZXR6dCBleGlzdGllcnQgbWl0IGRlciBnZXJhZGUgYW5nZWxlZ3RlblxuICAvLyBaZWlsZSBnYXJhbnRpZXJ0IG1pbmRlc3RlbnMgZWluZS5cbiAgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goZWRpdG9yLm93bmVyLmFwcCwgZWRpdG9yKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IG1vdW50VHlwZUZyb250bWF0dGVyRWRpdG9yLCBhZGRCbGFua1Byb3BlcnR5IH07XG4iLCAiLy8gUmVpbmUgSGlsZnNmdW5rdGlvbmVuIG9obmUgZWlnZW5lbiBTdGF0ZSBydW5kIHVtIFRZUC1OYW1lbiB1bmQgZGVyZW5cbi8vIFNvcnRpZXJ1bmcuXG5cbi8vIFRZUGVuIHdlcmRlbiBhdXNzY2hsaWVcdTAwREZsaWNoIGluIEdyb1x1MDBERmJ1Y2hzdGFiZW4gYW5nZWxlZ3QvdW1iZW5hbm50IC0gYmVpbVxuLy8gQW5sZWdlbiB3aWUgYmVpbSBVbWJlbmVubmVuLiBCZXRyaWZmdCBudXIgXHUwMEZDYmVyIGRpZSBMaXN0ZSBnZXRpcHB0ZSBOYW1lbixcbi8vIG5pY2h0IFdlcnRlLCBkaWUgei4gQi4gZGlyZWt0IGltIEZyb250bWF0dGVyIGVpbmVyIE5vdGl6IGluIEtsZWluc2NocmVpYnVuZ1xuLy8gc3RlaGVuIChzaWVoZSBcInVucmVnaXN0cmllcnRlXCIgWmVpbGVuIGluIHR5cC12aWV3LmpzKS5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVR5cGVOYW1lKHJhdykge1xuICByZXR1cm4gcmF3LnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xufVxuXG4vLyBGYXJidG9uICgwLTM2MFx1MDBCMCkgYXVzIGVpbmVtIEhleC1Db2RlLCBmXHUwMEZDciBkaWUgU29ydGllcnVuZyBuYWNoIEZhcmJzcGVrdHJ1bVxuLy8gc3RhdHQgbmFjaCBIZXgtU3RyaW5nLiBSb3QgbGllZ3QgYmVpIDBcdTAwQjAvMzYwXHUwMEIwIChLcmVpcykgLSBhdWZzdGVpZ2VuZCBiZWdpbm50XG4vLyBkaWUgU29ydGllcnVuZyBkYW1pdCBiZWkgUm90LCBsXHUwMEU0dWZ0IFx1MDBGQ2JlciBPcmFuZ2UvR2VsYi9Hclx1MDBGQ24vQ3lhbi9CbGF1L01hZ2VudGFcbi8vIHVuZCBsYW5kZXQgd2llZGVyIGJlaSBSb3QuIEFjaHJvbWF0aXNjaGUgRmFyYmVuIChHcmF1L1NjaHdhcnovV2VpXHUwMERGLCBkZWx0YT0wKVxuLy8gaGFiZW4ga2VpbmVuIGRlZmluaWVydGVuIEZhcmJ0b24gLSBkYWZcdTAwRkNyIGxpZWZlcnQgZGllc2UgRnVua3Rpb24gbnVsbCwgZGFtaXRcbi8vIGNvbXBhcmVUeXBlcyBzaWUgdW5hYmhcdTAwRTRuZ2lnIHZvbiBkZXIgU29ydGllcnJpY2h0dW5nIGFucyBFbmRlIHN0ZWxsZW4ga2Fubi5cbmZ1bmN0aW9uIGhleFRvSHVlKGhleCkge1xuICBjb25zdCBtYXRjaCA9IC9eIz8oWzAtOWEtZl17Nn0pJC9pLmV4ZWMoaGV4ID8/IFwiXCIpO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaW50ID0gcGFyc2VJbnQobWF0Y2hbMV0sIDE2KTtcbiAgY29uc3QgciA9ICgoaW50ID4+IDE2KSAmIDI1NSkgLyAyNTU7XG4gIGNvbnN0IGcgPSAoKGludCA+PiA4KSAmIDI1NSkgLyAyNTU7XG4gIGNvbnN0IGIgPSAoaW50ICYgMjU1KSAvIDI1NTtcbiAgY29uc3QgbWF4ID0gTWF0aC5tYXgociwgZywgYik7XG4gIGNvbnN0IG1pbiA9IE1hdGgubWluKHIsIGcsIGIpO1xuICBjb25zdCBkZWx0YSA9IG1heCAtIG1pbjtcbiAgaWYgKGRlbHRhID09PSAwKSByZXR1cm4gbnVsbDtcblxuICBsZXQgaHVlO1xuICBpZiAobWF4ID09PSByKSBodWUgPSAoKGcgLSBiKSAvIGRlbHRhKSAlIDY7XG4gIGVsc2UgaWYgKG1heCA9PT0gZykgaHVlID0gKGIgLSByKSAvIGRlbHRhICsgMjtcbiAgZWxzZSBodWUgPSAociAtIGcpIC8gZGVsdGEgKyA0O1xuICBodWUgKj0gNjA7XG4gIHJldHVybiBodWUgPCAwID8gaHVlICsgMzYwIDogaHVlO1xufVxuXG4vLyBHZW1laW5zYW1lIFNvcnRpZXJsb2dpayBmXHUwMEZDciBUWVAtIHVuZCBTVUJUWVAtTGlzdGVuLiB0eXBlQ29sb3JzIGRhcmYgZWluXG4vLyBsZWVyZXMgT2JqZWt0IHNlaW4gKFNVQlRZUCBoYXQga2VpbmUgZWlnZW5lIEZhcmJlKSAtIGRlciBcImNvbG9yXCItTW9kdXMgd2lyZFxuLy8gZG9ydCBzY2hsaWNodCBuaWUgYXVzZ2V3XHUwMEU0aGx0LlxuZnVuY3Rpb24gY29tcGFyZVR5cGVzKG1vZGUsIGEsIGIsIGNvdW50cywgdHlwZUNvbG9ycykge1xuICBjb25zdCBba2V5LCBkaXJdID0gbW9kZS5zcGxpdChcIi1cIik7XG4gIGxldCBjbXA7XG4gIGlmIChrZXkgPT09IFwiY291bnRcIikge1xuICAgIGNtcCA9IChjb3VudHMuZ2V0KGEpID8/IDApIC0gKGNvdW50cy5nZXQoYikgPz8gMCk7XG4gICAgaWYgKGRpciA9PT0gXCJkZXNjXCIpIGNtcCA9IC1jbXA7XG4gIH0gZWxzZSBpZiAoa2V5ID09PSBcImNvbG9yXCIpIHtcbiAgICBjb25zdCBodWVBID0gaGV4VG9IdWUodHlwZUNvbG9yc1thXSA/PyBudWxsKTtcbiAgICBjb25zdCBodWVCID0gaGV4VG9IdWUodHlwZUNvbG9yc1tiXSA/PyBudWxsKTtcbiAgICAvLyBBY2hyb21hdGlzY2hlIEZhcmJlbiBibGVpYmVuIGltbWVyIGFtIEVuZGUsIGVnYWwgb2IgYXVmLSBvZGVyIGFic3RlaWdlbmRcbiAgICAvLyBzb3J0aWVydCB3aXJkIC0gbnVyIGRpZSBSZWloZW5mb2xnZSBpbm5lcmhhbGIgZGVyIGVjaHRlbiBGYXJidFx1MDBGNm5lIGRyZWh0IHNpY2ggdW0uXG4gICAgaWYgKGh1ZUEgPT09IG51bGwgJiYgaHVlQiA9PT0gbnVsbCkgY21wID0gMDtcbiAgICBlbHNlIGlmIChodWVBID09PSBudWxsKSBjbXAgPSAxO1xuICAgIGVsc2UgaWYgKGh1ZUIgPT09IG51bGwpIGNtcCA9IC0xO1xuICAgIGVsc2Uge1xuICAgICAgY21wID0gaHVlQSAtIGh1ZUI7XG4gICAgICBpZiAoZGlyID09PSBcImRlc2NcIikgY21wID0gLWNtcDtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgY21wID0gYS5sb2NhbGVDb21wYXJlKGIpO1xuICAgIGlmIChkaXIgPT09IFwiZGVzY1wiKSBjbXAgPSAtY21wO1xuICB9XG4gIHJldHVybiBjbXAgfHwgYS5sb2NhbGVDb21wYXJlKGIpO1xufVxuXG4vLyBXZW5kZXQgZGVuIGFrdHVlbGxlbiBTb3J0aWVybW9kdXMgYXVmIGVpbmUgTGlzdGUgdm9uIFRZUGVuIGFuLiBTb25kZXJmYWxsXG4vLyBcIm1hbnVhbFwiIChzaWVoZSBTT1JUX09QVElPTlMgaW4gdHlwLXZpZXcuanMpOiBkb3J0IGJsZWlidCBiZXd1c3N0IGRpZVxuLy8gXHUwMEZDYmVyZ2ViZW5lIFJlaWhlbmZvbGdlIHNlbGJzdCBlcmhhbHRlbiwgc3RhdHQgc2llIHp1IHNvcnRpZXJlbiAtIHNpZSBJU1QgaW5cbi8vIGRpZXNlbSBNb2R1cyBkaWUgZ2VzcGVpY2hlcnRlIFNvcnRpZXJ1bmcgKHBsdWdpbi5zZXR0aW5ncy50eXBlcywgcGVyIERyYWcgJlxuLy8gRHJvcCBpbiB0eXAtdmlldy5qcyB2ZXJzY2hvYmVuKS4gRWluIFZlcmdsZWljaCB6d2VpZXIgVFlQZW4ga1x1MDBGNm5udGUgZGllc2Vcbi8vIFJlaWhlbmZvbGdlIG5pY2h0IGhlcmxlaXRlbiwgY29tcGFyZVR5cGVzIGJsZWlidCBkYWhlciB1bmFuZ2V0YXN0ZXQuIFZvblxuLy8gbWFpbi5qcyAoZ2V0VHlwZXMoKSwgZlx1MDBGQ3IgVGVtcGxhdGVyL1BpY2tlcikgVU5EIHR5cC12aWV3LmpzIGdlbnV0enQsIGRhbWl0XG4vLyBiZWlkZSBkaWVzZWxiZSBSZWloZW5mb2xnZSB6ZWlnZW4uXG5mdW5jdGlvbiBzb3J0VHlwZXNCeU1vZGUodHlwZXMsIG1vZGUsIGNvdW50cywgdHlwZUNvbG9ycykge1xuICBpZiAobW9kZSA9PT0gXCJtYW51YWxcIikgcmV0dXJuIFsuLi50eXBlc107XG4gIHJldHVybiBbLi4udHlwZXNdLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVUeXBlcyhtb2RlLCBhLCBiLCBjb3VudHMsIHR5cGVDb2xvcnMpKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IG5vcm1hbGl6ZVR5cGVOYW1lLCBoZXhUb0h1ZSwgY29tcGFyZVR5cGVzLCBzb3J0VHlwZXNCeU1vZGUgfTtcbiIsICJjb25zdCB7IEV2ZW50cywgVEZpbGUsIGRlYm91bmNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5cbmNvbnN0IFRZUF9QUk9QRVJUWSA9IFwiVFlQXCI7XG5jb25zdCBTVUJUWVBfUFJPUEVSVFkgPSBcIlNVQlRZUFwiO1xuY29uc3QgRU1QVFlfRU5UUlkgPSBPYmplY3QuZnJlZXplKHsgdHlwZUtleTogbnVsbCwgcmF3VHlwZTogbnVsbCwgc3VidHlwZXM6IE9iamVjdC5mcmVlemUoW10pIH0pO1xuXG4vLyBTYW1tZWx0IFx1MDBDNG5kZXJ1bmdlbiBtZWhyZXJlciBEYXRlaWVuICh6LiBCLiBVbWJlbmVubmVuIGVpbmVzIFRZUHMgaW4gdmllbGVuXG4vLyBOb3RpemVuLCBWYXVsdC1TeW5jKSB6dSBlaW5lbSBlaW56aWdlbiBcImNoYW5nZVwiLUV2ZW50LiBPaG5lIHJlc2V0VGltZXIsIGRhbWl0XG4vLyBlaW4gRGF1ZXJzdHJvbSBhbiBcdTAwQzRuZGVydW5nZW4gdHJvdHpkZW0gcmVnZWxtXHUwMEU0XHUwMERGaWcgZHVyY2hnZXJlaWNodCB3aXJkLlxuY29uc3QgRkxVU0hfREVMQVlfTVMgPSAxMDA7XG5cbmZ1bmN0aW9uIHJhd0l0ZW0odmFsdWUpIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBcIlwiO1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiID8gSlNPTi5zdHJpbmdpZnkodmFsdWUpIDogU3RyaW5nKHZhbHVlKTtcbn1cblxuLy8gRWluaGVpdGxpY2hlIEF1c2xlZ3VuZyBlaW5lcyBUWVAtV2VydHMgZlx1MDBGQ3IgZGFzIGdhbnplIFBsdWdpbjogZGVyIFdlcnQgd2lyZFxuLy8gYmV3dXNzdCBOSUNIVCBnZWdsXHUwMEU0dHRldCwgc29uZGVybiBpbiBzZWluZXIgUm9oZm9ybSB6dW0gU2NobFx1MDBGQ3NzZWwgLSBlaW4gVFlQIGlzdFxuLy8gZ2VuYXUgZWluIGVpbnplbG5lciwgc2F1YmVyZXIgV2VydC4gQWxsZXMgYW5kZXJlIChMZWVyemVpY2hlbiBhbSBSYW5kLCBrbGVpblxuLy8gZ2VzY2hyaWViZW4sIExpc3RlIC0gYXVjaCBlaW5lIGVpbmVsZW1lbnRpZ2UpIGVyZ2lidCBlaW5lbiBlaWdlbmVuIFNjaGxcdTAwRkNzc2VsLFxuLy8gZGVyIGluIGtlaW5lbSByZWdpc3RyaWVydGVuIFRZUCBhdWZnZWh0OiBlciBiZWtvbW10IGtlaW5lIEZhcmJlLCB6XHUwMEU0aGx0IG5pY2h0XG4vLyBiZWltIFwicmljaHRpZ2VuXCIgVFlQIG1pdCB1bmQgc3RlaHQgaW4gZGVyIFRZUC1WaWV3IGFscyBlaWdlbmVyLFxuLy8gdW5yZWdpc3RyaWVydGVyIEVpbnRyYWcsIHZvbiB3byBhdXMgZXIgc2ljaCBwZXIgS2xpY2sgYmVyZWluaWdlbiBsXHUwMEU0c3N0XG4vLyAoc2llaGUgcmVnaXN0ZXJUeXBlIGluIHR5cC12aWV3LmpzKS4gTGlzdGVuIGVyc2NoZWluZW4gZGFiZWkgYWxzXG4vLyBcIltBLCBCXVwiIHVuZCBrXHUwMEY2bm5lbiBzbyBuaWUgbWl0IGVpbmVtIEVpbnplbHdlcnQgXCJBLCBCXCIgenVzYW1tZW5mYWxsZW4uXG4vLyBudWxsID0ga2VpbiBUWVAgKGZlaGxlbmQsIGxlZXIsIG51ciBMZWVyemVpY2hlbiwgbGVlcmUgTGlzdGUpLlxuZnVuY3Rpb24gdHlwZUtleU9mKHZhbHVlKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIGNvbnN0IGl0ZW1zID0gdmFsdWUubWFwKHJhd0l0ZW0pO1xuICAgIGlmIChpdGVtcy5ldmVyeSgoaXRlbSkgPT4gaXRlbS50cmltKCkgPT09IFwiXCIpKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gYFske2l0ZW1zLmpvaW4oXCIsIFwiKX1dYDtcbiAgfVxuICBjb25zdCB0ZXh0ID0gcmF3SXRlbSh2YWx1ZSk7XG4gIHJldHVybiB0ZXh0LnRyaW0oKSA9PT0gXCJcIiA/IG51bGwgOiB0ZXh0O1xufVxuXG4vLyBTVUJUWVAgYmxlaWJ0IChhbmRlcnMgYWxzIFRZUCkgRWluemVsd2VydCBvZGVyIExpc3RlLCBnZXRyaW1tdC5cbmZ1bmN0aW9uIHN1YnR5cGVMaXN0KHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gW107XG4gIHJldHVybiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkgPyB2YWx1ZSA6IFt2YWx1ZV0pLm1hcCgodikgPT4gcmF3SXRlbSh2KS50cmltKCkpLmZpbHRlcihCb29sZWFuKTtcbn1cblxuZnVuY3Rpb24gc2FtZUVudHJ5KGEsIGIpIHtcbiAgcmV0dXJuIChcbiAgICAhIWEgJiZcbiAgICAhIWIgJiZcbiAgICBhLnR5cGVLZXkgPT09IGIudHlwZUtleSAmJlxuICAgIGEuc3VidHlwZXMubGVuZ3RoID09PSBiLnN1YnR5cGVzLmxlbmd0aCAmJlxuICAgIGEuc3VidHlwZXMuZXZlcnkoKHYsIGkpID0+IHYgPT09IGIuc3VidHlwZXNbaV0pXG4gICk7XG59XG5cbi8vIFplbnRyYWxlciBUWVAtL1NVQlRZUC1JbmRleCBcdTAwRkNiZXIgYWxsZSBNYXJrZG93bi1EYXRlaWVuIChQZmFkIC0+IFdlcnRlKS5cbi8vXG4vLyBad2VjazogZGllIEZhcmItTW9kdWxlIGhpbmdlbiBiaXNoZXIgYWxsZSBkaXJla3QgYW4gbWV0YWRhdGFDYWNoZSBcImNoYW5nZWRcIlxuLy8gdW5kIFwicmVzb2x2ZWRcIiAtIGJlaWRlIGZldWVybiBiZWkgSkVERVIgXHUwMEM0bmRlcnVuZyBhbiBpcmdlbmRlaW5lciBOb3RpeiAoYmVpbVxuLy8gVGlwcGVuIGV0d2EgYWxsZSB6d2VpIFNla3VuZGVuKSwgdW5kIGplZGVzIE1vZHVsIGZcdTAwRTRyYnRlIGRhcmF1ZmhpbiBzZWluZVxuLy8ga29tcGxldHRlIEFuc2ljaHQgbmV1LCBkb3BwZWx0LiBEZXIgSW5kZXggdmVyZ2xlaWNodCBzdGF0dGRlc3NlbiBqZSBEYXRlaSwgb2Jcbi8vIHNpY2ggVFlQIG9kZXIgU1VCVFlQIHRhdHNcdTAwRTRjaGxpY2ggZ2VcdTAwRTRuZGVydCBoYXQgKGJ6dy4gZWluZSBOb3RpeiBoaW56dWthbS9cbi8vIHdlZ2ZpZWwpLCB1bmQgZmV1ZXJ0IG51ciBkYW5uIHNlaW4gZWlnZW5lcyBcImNoYW5nZVwiLUV2ZW50IChBcmd1bWVudDogU2V0IGRlclxuLy8gYmV0cm9mZmVuZW4gUGZhZGUpLiBOb3JtYWxlcyBTY2hyZWliZW4gbFx1MDBGNnN0IGRhbWl0IGdhciBrZWluIE5ldS1FaW5mXHUwMEU0cmJlbiBtZWhyIGF1cy5cbi8vXG4vLyBadXNcdTAwRTR0emxpY2ggaFx1MDBFNGx0IGVyIGRpZSB2YXVsdC13ZWl0ZW4gWlx1MDBFNGhsdW5nZW4gKFRZUC1MaXN0ZSwgU1VCVFlQLUxpc3RlLFxuLy8gUGlja2VyLCBnZXRUeXBlcygpIGZcdTAwRkNyIFRlbXBsYXRlcikgendpc2NoZW5nZXNwZWljaGVydCwgc3RhdHQgc2llIGJlaSBqZWRlbVxuLy8gQXVmcnVmIHBlciBTY2FuIFx1MDBGQ2JlciBhbGxlIE5vdGl6ZW4gbmV1IHp1IGJlcmVjaG5lbi5cbmNsYXNzIFR5cEluZGV4IGV4dGVuZHMgRXZlbnRzIHtcbiAgY29uc3RydWN0b3IocGx1Z2luKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLmFwcCA9IHBsdWdpbi5hcHA7XG4gICAgdGhpcy5lbnRyaWVzID0gbmV3IE1hcCgpO1xuICAgIHRoaXMuYnVpbHQgPSBmYWxzZTtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIHRoaXMucGVuZGluZ1BhdGhzID0gbmV3IFNldCgpO1xuICAgIHRoaXMuZmx1c2ggPSBkZWJvdW5jZSgoKSA9PiB7XG4gICAgICBjb25zdCBwYXRocyA9IHRoaXMucGVuZGluZ1BhdGhzO1xuICAgICAgdGhpcy5wZW5kaW5nUGF0aHMgPSBuZXcgU2V0KCk7XG4gICAgICB0aGlzLnRyaWdnZXIoXCJjaGFuZ2VcIiwgcGF0aHMpO1xuICAgIH0sIEZMVVNIX0RFTEFZX01TKTtcbiAgfVxuXG4gIHJlZ2lzdGVyKCkge1xuICAgIGNvbnN0IHsgcGx1Z2luLCBhcHAgfSA9IHRoaXM7XG4gICAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJjaGFuZ2VkXCIsIChmaWxlKSA9PiB0aGlzLnVwZGF0ZShmaWxlKSkpO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwiZGVsZXRlZFwiLCAoZmlsZSkgPT4gdGhpcy5yZW1vdmUoZmlsZS5wYXRoKSkpO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcInJlbmFtZVwiLCAoZmlsZSwgb2xkUGF0aCkgPT4gdGhpcy5yZW5hbWUoZmlsZSwgb2xkUGF0aCkpKTtcbiAgICAvLyBcIkV4Y2x1ZGVkIGZpbGVzXCItTGlzdGUgZ2VcdTAwRTRuZGVydCAoc2llaGUgcmVnaXN0ZXJUeXBWaWV3KSAtIGRpZSBFaW50clx1MDBFNGdlXG4gICAgLy8gc2VsYnN0IGJsZWliZW4gZ1x1MDBGQ2x0aWcsIG51ciBkaWUgZGFyYXVzIGdlZmlsdGVydGVuIFpcdTAwRTRobHVuZ2VuIG5pY2h0LlxuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcImNvbmZpZy1jaGFuZ2VkXCIsICgpID0+ICh0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsKSkpO1xuXG4gICAgLy8gQmVpbSBBcHAtU3RhcnQga2FubiBkZXIgZXJzdGUgWnVncmlmZiAobGF6eSwgc2llaGUgZW5zdXJlQnVpbHQpIG5vY2ggdm9yXG4gICAgLy8gZGVtIHZvbGxzdFx1MDBFNG5kaWcgZ2VsYWRlbmVuIE1ldGFkYXRhQ2FjaGUgbGllZ2VuLiBFaW5tYWxpZyBuYWNoIGRlc3NlblxuICAgIC8vIGVyc3RlbSBrb21wbGV0dGVuIEF1ZmxcdTAwRjZzdW5nc2R1cmNobGF1ZiBuZXUgYXVmYmF1ZW47IEFid2VpY2h1bmdlbiBsYW5kZW5cbiAgICAvLyBkYWJlaSB3aWUgamVkZSBhbmRlcmUgXHUwMEM0bmRlcnVuZyBpbSBcImNoYW5nZVwiLUV2ZW50LlxuICAgIGNvbnN0IHJlc29sdmVkUmVmID0gYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJyZXNvbHZlZFwiLCAoKSA9PiB7XG4gICAgICBhcHAubWV0YWRhdGFDYWNoZS5vZmZyZWYocmVzb2x2ZWRSZWYpO1xuICAgICAgdGhpcy5yZWJ1aWxkKCk7XG4gICAgfSk7XG4gICAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocmVzb2x2ZWRSZWYpO1xuXG4gICAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHRoaXMuZmx1c2guY2FuY2VsKCkpO1xuICB9XG5cbiAgcmVhZChmaWxlKSB7XG4gICAgY29uc3QgZnJvbnRtYXR0ZXIgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XG4gICAgY29uc3QgcmF3VHlwZSA9IGZyb250bWF0dGVyPy5bVFlQX1BST1BFUlRZXSA/PyBudWxsO1xuICAgIHJldHVybiB7IHR5cGVLZXk6IHR5cGVLZXlPZihyYXdUeXBlKSwgcmF3VHlwZSwgc3VidHlwZXM6IHN1YnR5cGVMaXN0KGZyb250bWF0dGVyPy5bU1VCVFlQX1BST1BFUlRZXSkgfTtcbiAgfVxuXG4gIGVuc3VyZUJ1aWx0KCkge1xuICAgIGlmICghdGhpcy5idWlsdCkgdGhpcy5yZWJ1aWxkKCk7XG4gIH1cblxuICByZWJ1aWxkKCkge1xuICAgIGNvbnN0IHByZXZpb3VzID0gdGhpcy5lbnRyaWVzO1xuICAgIGNvbnN0IHdhc0J1aWx0ID0gdGhpcy5idWlsdDtcbiAgICB0aGlzLmVudHJpZXMgPSBuZXcgTWFwKCk7XG4gICAgZm9yIChjb25zdCBmaWxlIG9mIHRoaXMuYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKSkgdGhpcy5lbnRyaWVzLnNldChmaWxlLnBhdGgsIHRoaXMucmVhZChmaWxlKSk7XG4gICAgdGhpcy5idWlsdCA9IHRydWU7XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0gbnVsbDtcbiAgICBpZiAoIXdhc0J1aWx0KSByZXR1cm47XG5cbiAgICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgdGhpcy5lbnRyaWVzKSB7XG4gICAgICBpZiAoIXNhbWVFbnRyeShwcmV2aW91cy5nZXQocGF0aCksIGVudHJ5KSkgdGhpcy5wZW5kaW5nUGF0aHMuYWRkKHBhdGgpO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IHBhdGggb2YgcHJldmlvdXMua2V5cygpKSB7XG4gICAgICBpZiAoIXRoaXMuZW50cmllcy5oYXMocGF0aCkpIHRoaXMucGVuZGluZ1BhdGhzLmFkZChwYXRoKTtcbiAgICB9XG4gICAgaWYgKHRoaXMucGVuZGluZ1BhdGhzLnNpemUgPiAwKSB0aGlzLmZsdXNoKCk7XG4gIH1cblxuICBtYXJrQ2hhbmdlZChwYXRoKSB7XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0gbnVsbDtcbiAgICB0aGlzLnBlbmRpbmdQYXRocy5hZGQocGF0aCk7XG4gICAgdGhpcy5mbHVzaCgpO1xuICB9XG5cbiAgdXBkYXRlKGZpbGUpIHtcbiAgICAvLyBWb3IgZGVtIGVyc3RlbiBadWdyaWZmIGdpYnQgZXMgbm9jaCBrZWluZW4gdmVyYWx0ZXRlbiBTdGFuZCAtIGRlclxuICAgIC8vIHNwXHUwMEU0dGVyZSBsYXp5IEF1ZmJhdSBsaWVzdCBvaG5laGluIGZyaXNjaCBhdXMgZGVtIE1ldGFkYXRhQ2FjaGUuXG4gICAgaWYgKCF0aGlzLmJ1aWx0IHx8ICEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSB8fCBmaWxlLmV4dGVuc2lvbiAhPT0gXCJtZFwiKSByZXR1cm47XG4gICAgY29uc3QgbmV4dCA9IHRoaXMucmVhZChmaWxlKTtcbiAgICBpZiAoc2FtZUVudHJ5KHRoaXMuZW50cmllcy5nZXQoZmlsZS5wYXRoKSwgbmV4dCkpIHJldHVybjtcbiAgICB0aGlzLmVudHJpZXMuc2V0KGZpbGUucGF0aCwgbmV4dCk7XG4gICAgdGhpcy5tYXJrQ2hhbmdlZChmaWxlLnBhdGgpO1xuICB9XG5cbiAgcmVtb3ZlKHBhdGgpIHtcbiAgICBpZiAoIXRoaXMuYnVpbHQgfHwgIXRoaXMuZW50cmllcy5kZWxldGUocGF0aCkpIHJldHVybjtcbiAgICB0aGlzLm1hcmtDaGFuZ2VkKHBhdGgpO1xuICB9XG5cbiAgcmVuYW1lKGZpbGUsIG9sZFBhdGgpIHtcbiAgICBpZiAoIXRoaXMuYnVpbHQpIHJldHVybjtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuZW50cmllcy5nZXQob2xkUGF0aCk7XG4gICAgaWYgKGVudHJ5KSB7XG4gICAgICB0aGlzLmVudHJpZXMuZGVsZXRlKG9sZFBhdGgpO1xuICAgICAgdGhpcy5tYXJrQ2hhbmdlZChvbGRQYXRoKTtcbiAgICB9XG4gICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURmlsZSAmJiBmaWxlLmV4dGVuc2lvbiA9PT0gXCJtZFwiKSB7XG4gICAgICB0aGlzLmVudHJpZXMuc2V0KGZpbGUucGF0aCwgZW50cnkgPz8gdGhpcy5yZWFkKGZpbGUpKTtcbiAgICAgIHRoaXMubWFya0NoYW5nZWQoZmlsZS5wYXRoKTtcbiAgICB9XG4gIH1cblxuICBlbnRyeUZvcihmaWxlKSB7XG4gICAgaWYgKCFmaWxlKSByZXR1cm4gRU1QVFlfRU5UUlk7XG4gICAgdGhpcy5lbnN1cmVCdWlsdCgpO1xuICAgIHJldHVybiB0aGlzLmVudHJpZXMuZ2V0KGZpbGUucGF0aCkgPz8gRU1QVFlfRU5UUlk7XG4gIH1cblxuICAvLyBUWVAtU2NobFx1MDBGQ3NzZWwgKHNpZWhlIHR5cGVLZXlPZikgb2RlciBudWxsLiBGXHUwMEZDciBlaW5lbiBzYXViZXJlbiBXZXJ0IGlzdCBkYXNcbiAgLy8gc2NobGljaHQgZGVyIFRZUC1OYW1lIHNlbGJzdC5cbiAgdHlwZU9mKGZpbGUpIHtcbiAgICByZXR1cm4gdGhpcy5lbnRyeUZvcihmaWxlKS50eXBlS2V5O1xuICB9XG5cbiAgLy8gRWluIHRhdHNcdTAwRTRjaGxpY2hlciBGcm9udG1hdHRlci1XZXJ0IHp1IGVpbmVtIFNjaGxcdTAwRkNzc2VsIC0gZlx1MDBGQ3IgQW56ZWlnZSwgU3VjaGVcbiAgLy8gdW5kIE5vcm1hbGlzaWVydW5nIHVucmVnaXN0cmllcnRlciBFaW50clx1MDBFNGdlIChhbGxlIE5vdGl6ZW4gZWluZXMgU2NobFx1MDBGQ3NzZWxzXG4gIC8vIGhhYmVuIHBlciBEZWZpbml0aW9uIGRpZXNlbGJlIFJvaGZvcm0pLlxuICByYXdWYWx1ZU9mKHR5cGVLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5hZ2dyZWdhdGUoKS5yYXdCeUtleS5nZXQodHlwZUtleSk7XG4gIH1cblxuICAvLyBTYXViZXJlciBXZXJ0ID0gRWluemVsd2VydCBvaG5lIExlZXJ6ZWljaGVuIGFtIFJhbmQuIEtsZWluIGdlc2NocmllYmVuZVxuICAvLyBXZXJ0ZSB6XHUwMEU0aGxlbiBoaWVyIGFscyBzYXViZXIgKHNpZSBzaW5kIGVpbiBnXHUwMEZDbHRpZ2VyLCBudXIgbm9jaCBuaWNodFxuICAvLyByZWdpc3RyaWVydGVyIFRZUC1OYW1lKSwgTGlzdGVuIHVuZCBSYW5kbGVlcnplaWNoZW4gbmljaHQuXG4gIGlzQ2xlYW5LZXkodHlwZUtleSkge1xuICAgIGNvbnN0IHJhdyA9IHRoaXMucmF3VmFsdWVPZih0eXBlS2V5KTtcbiAgICByZXR1cm4gcmF3ICE9PSB1bmRlZmluZWQgJiYgIUFycmF5LmlzQXJyYXkocmF3KSAmJiB0eXBlS2V5ID09PSB0eXBlS2V5LnRyaW0oKTtcbiAgfVxuXG4gIC8vIERhdGVpZW4gbWl0IGdlbmF1IGRpZXNlbSBUWVAtU2NobFx1MDBGQ3NzZWwsIHVudGVyIEJlYWNodHVuZyBkZXJcbiAgLy8gXCJJZ25vcmllcnRlIE5vdGl6ZW4gYmVyXHUwMEZDY2tzaWNodGlnZW5cIi1FaW5zdGVsbHVuZy5cbiAgZmlsZXNXaXRoVHlwZSh0eXBlS2V5KSB7XG4gICAgdGhpcy5lbnN1cmVCdWlsdCgpO1xuICAgIGNvbnN0IGluY2x1ZGVJZ25vcmVkID0gISF0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmNsdWRlSWdub3JlZEZpbGVzO1xuICAgIGNvbnN0IGZpbGVzID0gW107XG4gICAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIHRoaXMuZW50cmllcykge1xuICAgICAgaWYgKGVudHJ5LnR5cGVLZXkgIT09IHR5cGVLZXkpIGNvbnRpbnVlO1xuICAgICAgaWYgKCFpbmNsdWRlSWdub3JlZCAmJiB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmlzVXNlcklnbm9yZWQocGF0aCkpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChwYXRoKTtcbiAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUpIGZpbGVzLnB1c2goZmlsZSk7XG4gICAgfVxuICAgIHJldHVybiBmaWxlcztcbiAgfVxuXG4gIC8vIFJlc3Bla3RpZXJ0IHN0YW5kYXJkbVx1MDBFNFx1MDBERmlnIE9ic2lkaWFucyBlaWdlbmUgXCJFeGNsdWRlZCBmaWxlc1wiLUxpc3RlIC0gZG9ydFxuICAvLyB0cmFnZW4gYXVjaCBQbHVnaW5zIHdpZSBIaWRlIEZvbGRlcnMgYXVzZ2VibGVuZGV0ZSBPcmRuZXIgZWluLiBcdTAwRENiZXIgZGllXG4gIC8vIEVpbnN0ZWxsdW5nIFwiSWdub3JpZXJ0ZSBOb3RpemVuIGJlclx1MDBGQ2Nrc2ljaHRpZ2VuXCIgYWJzY2hhbHRiYXIuXG4gIC8vXG4gIC8vIE1laHJmYWNoLVNVQlRZUCAoQXJyYXktV2VydCkgelx1MDBFNGhsdCBmXHUwMEZDciBqZWRlbiBzZWluZXIgU1VCVFlQLUJ1Y2tldHMuIEVpbmVcbiAgLy8gTm90aXogb2huZSBUWVAgaGF0IGtlaW5lbiBTVUJUWVAtS29udGV4dC5cbiAgYWdncmVnYXRlKCkge1xuICAgIHRoaXMuZW5zdXJlQnVpbHQoKTtcbiAgICBjb25zdCBpbmNsdWRlSWdub3JlZCA9ICEhdGhpcy5wbHVnaW4uc2V0dGluZ3MuaW5jbHVkZUlnbm9yZWRGaWxlcztcbiAgICBpZiAodGhpcy5hZ2dyZWdhdGVzPy5pbmNsdWRlSWdub3JlZCA9PT0gaW5jbHVkZUlnbm9yZWQpIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZXM7XG5cbiAgICBjb25zdCBjb3VudHMgPSBuZXcgTWFwKCk7XG4gICAgY29uc3QgcmF3QnlLZXkgPSBuZXcgTWFwKCk7XG4gICAgY29uc3Qgc3VidHlwZXNCeVR5cGUgPSBuZXcgTWFwKCk7XG4gICAgbGV0IG5vVHlwZSA9IDA7XG4gICAgZm9yIChjb25zdCBbcGF0aCwgeyB0eXBlS2V5LCByYXdUeXBlLCBzdWJ0eXBlcyB9XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghaW5jbHVkZUlnbm9yZWQgJiYgdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIGlmICh0eXBlS2V5ID09PSBudWxsKSB7XG4gICAgICAgIG5vVHlwZSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvdW50cy5zZXQodHlwZUtleSwgKGNvdW50cy5nZXQodHlwZUtleSkgPz8gMCkgKyAxKTtcbiAgICAgIGlmICghcmF3QnlLZXkuaGFzKHR5cGVLZXkpKSByYXdCeUtleS5zZXQodHlwZUtleSwgcmF3VHlwZSk7XG4gICAgICBsZXQgYnVja2V0ID0gc3VidHlwZXNCeVR5cGUuZ2V0KHR5cGVLZXkpO1xuICAgICAgaWYgKCFidWNrZXQpIHtcbiAgICAgICAgYnVja2V0ID0geyBjb3VudHM6IG5ldyBNYXAoKSwgbm9TdWJ0eXBlOiAwIH07XG4gICAgICAgIHN1YnR5cGVzQnlUeXBlLnNldCh0eXBlS2V5LCBidWNrZXQpO1xuICAgICAgfVxuICAgICAgaWYgKHN1YnR5cGVzLmxlbmd0aCA9PT0gMCkgYnVja2V0Lm5vU3VidHlwZSsrO1xuICAgICAgZWxzZSBmb3IgKGNvbnN0IHN1YiBvZiBzdWJ0eXBlcykgYnVja2V0LmNvdW50cy5zZXQoc3ViLCAoYnVja2V0LmNvdW50cy5nZXQoc3ViKSA/PyAwKSArIDEpO1xuICAgIH1cbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSB7IGluY2x1ZGVJZ25vcmVkLCBjb3VudHMsIG5vVHlwZSwgcmF3QnlLZXksIHN1YnR5cGVzQnlUeXBlIH07XG4gICAgcmV0dXJuIHRoaXMuYWdncmVnYXRlcztcbiAgfVxuXG4gIC8vIFp3aXNjaGVuZ2VzcGVpY2hlcnQgLSBkaWUgZ2VsaWVmZXJ0ZW4gTWFwcyBuaWNodCB2ZXJcdTAwRTRuZGVybi5cbiAgdHlwZUNvdW50cygpIHtcbiAgICBjb25zdCB7IGNvdW50cywgbm9UeXBlIH0gPSB0aGlzLmFnZ3JlZ2F0ZSgpO1xuICAgIHJldHVybiB7IGNvdW50cywgbm9UeXBlIH07XG4gIH1cblxuICAvLyBUWVAgLT4geyBjb3VudHM6IE1hcChTVUJUWVAgLT4gQW56YWhsKSwgbm9TdWJ0eXBlIH0uIFp3aXNjaGVuZ2VzcGVpY2hlcnQgLVxuICAvLyBuaWNodCB2ZXJcdTAwRTRuZGVybi5cbiAgc3VidHlwZUNvdW50cygpIHtcbiAgICByZXR1cm4gdGhpcy5hZ2dyZWdhdGUoKS5zdWJ0eXBlc0J5VHlwZTtcbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgVHlwSW5kZXgsIHR5cGVLZXlPZiwgVFlQX1BST1BFUlRZIH07XG4iLCAiY29uc3QgeyBJdGVtVmlldywgTWVudSwgTW9kYWwsIE5vdGljZSwgc2V0SWNvbiwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgbW91bnRUeXBlRnJvbnRtYXR0ZXJFZGl0b3IsIGFkZEJsYW5rUHJvcGVydHkgfSA9IHJlcXVpcmUoXCIuL3R5cGUtZnJvbnRtYXR0ZXItZWRpdG9yXCIpO1xuY29uc3QgeyBGUk9OVE1BVFRFUl9QTEFDRUhPTERFUlMsIERZTkFNSUNfUExBQ0VIT0xERVJfSU5GTyB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItcGxhY2Vob2xkZXJzXCIpO1xuY29uc3QgeyBub3JtYWxpemVUeXBlTmFtZSwgY29tcGFyZVR5cGVzLCBzb3J0VHlwZXNCeU1vZGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtdXRpbHNcIik7XG5jb25zdCB7IHR5cGVLZXlPZiwgVFlQX1BST1BFUlRZIH0gPSByZXF1aXJlKFwiLi90eXAtaW5kZXhcIik7XG5cbmNvbnN0IFZJRVdfVFlQRV9UWVAgPSBcImZyZWQtdHlwLXZpZXdcIjtcbmNvbnN0IERFRkFVTFRfVFlQRV9DT0xPUiA9IFwiIzg4ODg4OFwiO1xuY29uc3QgREVGQVVMVF9TT1JUX09SREVSID0gXCJjb3VudC1kZXNjXCI7XG5cbmNvbnN0IFNPUlRfT1BUSU9OUyA9IFtcbiAgLy8gTnV0enQgKGFuZGVycyBhbHMgZGllIFx1MDBGQ2JyaWdlbiBNb2RpKSBrZWluZW4gZWlnZW5lbiBWZXJnbGVpY2gsIHNvbmRlcm4gZGllXG4gIC8vIFJlaWhlbmZvbGdlIHZvbiBwbHVnaW4uc2V0dGluZ3MudHlwZXMgc2VsYnN0IGFscyBTcGVpY2hlcm9ydCAtIHNpZWhlXG4gIC8vIHJlbmRlcigpIHVuZCByZW5kZXJSZWdpc3RlcmVkSXRlbSgpIGZcdTAwRkNyIGRhcyBwZXIgRHJhZyAmIERyb3AgdmVyc2NoaWViYmFyZVxuICAvLyBSZW5kZXJuLCBkYXMgZ2VuYXUgZGFyYXVmIGF1ZmJhdXQuIEJld3Vzc3QgYWxzIGVyc3RlIE9wdGlvbiAoc2llaGVcbiAgLy8gc2hvd1NvcnRNZW51KSAtIGVpZ2VuZSwgb2JlcnN0ZSBHcnVwcGUgaW0gTWVuXHUwMEZDIHN0YXR0IGVpbnNvcnRpZXJ0IHp3aXNjaGVuXG4gIC8vIGRpZSBlaWdlbnRsaWNoZW4gU29ydGllcmtyaXRlcmllbi5cbiAgeyBtb2RlOiBcIm1hbnVhbFwiLCB0aXRsZTogXCJNYW51ZWxsIChEcmFnICYgRHJvcClcIiB9LFxuICB7IG1vZGU6IFwiY291bnQtZGVzY1wiLCB0aXRsZTogXCJIXHUwMEU0dWZpZ2tlaXQgKGFic3RlaWdlbmQpXCIgfSxcbiAgeyBtb2RlOiBcImNvdW50LWFzY1wiLCB0aXRsZTogXCJIXHUwMEU0dWZpZ2tlaXQgKGF1ZnN0ZWlnZW5kKVwiIH0sXG4gIHsgbW9kZTogXCJuYW1lLWFzY1wiLCB0aXRsZTogXCJOYW1lIChBIGJpcyBaKVwiIH0sXG4gIHsgbW9kZTogXCJuYW1lLWRlc2NcIiwgdGl0bGU6IFwiTmFtZSAoWiBiaXMgQSlcIiB9LFxuICB7IG1vZGU6IFwiY29sb3ItYXNjXCIsIHRpdGxlOiBcIkZhcmJlIChSb3QgXHUyMTkyIFZpb2xldHQpXCIgfSxcbiAgeyBtb2RlOiBcImNvbG9yLWRlc2NcIiwgdGl0bGU6IFwiRmFyYmUgKFZpb2xldHQgXHUyMTkyIFJvdClcIiB9LFxuXTtcblxuLy8gU2NocmVpYnQgZGVuIFRZUC1XZXJ0IGFsbGVyIE5vdGl6ZW4gbWl0IGRlbSBTY2hsXHUwMEZDc3NlbCBvbGRLZXkgKHNpZWhlXG4vLyB0eXBlS2V5T2YgaW4gdHlwLWluZGV4LmpzIC0gZlx1MDBGQ3IgZWluZW4gc2F1YmVyZW4gV2VydCBkZXIgVFlQLU5hbWUgc2VsYnN0LFxuLy8gc29uc3QgZGllIFJvaGZvcm0sIHouIEIuIFwiIGJ1Y2hcIiBvZGVyIFwiW1BFUlNPTiwgQlVDSF1cIikgYXVmIGRlbiBFaW56ZWx3ZXJ0XG4vLyBuZXdWYWx1ZSB1bS4gR2VudXR6dCBmXHUwMEZDciByZWdpc3RlclR5cGUoKSAoQmVyZWluaWdlbiksIFVtYmVuZW5uZW4gdW5kXG4vLyBadXNhbW1lbmxlZ2VuLiBEZXIgQWJnbGVpY2ggZXJmb2xndCBleGFrdCBcdTAwRkNiZXIgZGVuIFNjaGxcdTAwRkNzc2VsLCBlaW5lIExpc3RlXG4vLyB3aXJkIGRhYmVpIGFsc28gYWxzIEdhbnplcyBlcnNldHp0IHN0YXR0IG51ciBlaW5lciBpaHJlciBFaW50clx1MDBFNGdlLlxuYXN5bmMgZnVuY3Rpb24gcmVuYW1lVHlwZUluTm90ZXMocGx1Z2luLCBvbGRLZXksIG5ld1ZhbHVlKSB7XG4gIGxldCBjaGFuZ2VkID0gMDtcbiAgZm9yIChjb25zdCBmaWxlIG9mIHBsdWdpbi50eXBJbmRleC5maWxlc1dpdGhUeXBlKG9sZEtleSkpIHtcbiAgICBsZXQgbWF0Y2hlZCA9IGZhbHNlO1xuICAgIGF3YWl0IHBsdWdpbi5hcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKGZpbGUsIChmcm9udG1hdHRlcikgPT4ge1xuICAgICAgaWYgKHR5cGVLZXlPZihmcm9udG1hdHRlcltUWVBfUFJPUEVSVFldKSAhPT0gb2xkS2V5KSByZXR1cm47XG4gICAgICBmcm9udG1hdHRlcltUWVBfUFJPUEVSVFldID0gbmV3VmFsdWU7XG4gICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICB9KTtcbiAgICBpZiAobWF0Y2hlZCkgY2hhbmdlZCsrO1xuICB9XG4gIHJldHVybiBjaGFuZ2VkO1xufVxuXG4vLyBCZXJlaW5pZ3RlIEZvcm0gZWluZXMgUm9od2VydHMgZlx1MDBGQ3IgcmVnaXN0ZXJUeXBlKCk6IEVpbnplbHdlcnQgZ2V0cmltbXQgdW5kXG4vLyBncm9cdTAwREYgZ2VzY2hyaWViZW47IGVpbmUgTGlzdGUgd2lyZCBiZXd1c3N0IE5JQ0hUIGF1ZiBlaW5lbiBpaHJlciBFaW50clx1MDBFNGdlXG4vLyByZWR1emllcnQsIHNvbmRlcm4gYWxzIEdhbnplcyB6dSBlaW5lbSBFaW56ZWx3ZXJ0IFwiQSwgQlwiIChSb2hmb3JtKSAtIGRhcmF1c1xuLy8gbFx1MDBFNHNzdCBzaWNoIGRlciBUWVAgZGFuYWNoIHBlciBVbWJlbmVubmVuIGdlemllbHQgaW4gZWluZW4gYW5kZXJlbiBcdTAwRkNiZXJmXHUwMEZDaHJlblxuLy8gKHNpZWhlIHN0YXJ0RGV0YWlsUmVuYW1lL3Nob3dNZXJnZUNvbmZpcm0pLlxuZnVuY3Rpb24gbm9ybWFsaXplUmF3VHlwZShyYXcpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkge1xuICAgIHJldHVybiByYXdcbiAgICAgIC5tYXAoKHYpID0+IG5vcm1hbGl6ZVR5cGVOYW1lKFN0cmluZyh2ID8/IFwiXCIpKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5qb2luKFwiLCBcIik7XG4gIH1cbiAgcmV0dXJuIG5vcm1hbGl6ZVR5cGVOYW1lKFN0cmluZyhyYXcpKTtcbn1cblxuLy8gQW56ZWlnZSBlaW5lcyB1bnJlZ2lzdHJpZXJ0ZW4gU2NobFx1MDBGQ3NzZWxzOiBSYW5kbGVlcnplaWNoZW4gd1x1MDBFNHJlbiBhbHMgcmVpbmVyXG4vLyBUZXh0IHVuc2ljaHRiYXIsIGRhaGVyIGRhbm4gaW4gQW5mXHUwMEZDaHJ1bmdzemVpY2hlbi4gTGlzdGVuIHRyYWdlbiBpaHJlXG4vLyBlY2tpZ2VuIEtsYW1tZXJuIHNjaG9uIGltIFNjaGxcdTAwRkNzc2VsLlxuZnVuY3Rpb24gZGlzcGxheVR5cGVLZXkodHlwZUtleSkge1xuICByZXR1cm4gdHlwZUtleSAhPT0gdHlwZUtleS50cmltKCkgPyBgXCIke3R5cGVLZXl9XCJgIDogdHlwZUtleTtcbn1cblxuLy8gVFlQLU5hbWUgaW4gRmxpZVx1MDBERnRleHQgKEJlc3RcdTAwRTR0aWd1bmdzLU1vZGFsZSk6IGVpbmdlZlx1MDBFNHJidGVyIE5hbWUsIHdlbm4gXCJUWVBcbi8vIFZpZXcgZWluZlx1MDBFNHJiZW5cIiBha3RpdiBpc3QgKGNvbG9yVmlld3MudHlwTGlzdCksIHNvbnN0IGVpbiBGYXJicHVua3QgZGF2b3Jcbi8vIHBsdXMgbm9ybWFsZXIgVGV4dCAtIGRpZXNlbGJlIFVtc2NoYWx0dW5nIHdpZSBpbSBUWVAtUGlja2VyIChzaWVoZVxuLy8gcmVuZGVyU3VnZ2VzdGlvbiBpbiB0eXBlLXBpY2tlci5qcykgdW5kIGluIGRlciBUWVAtTGlzdGUgc2VsYnN0LiBjb2xvciB3aXJkXG4vLyB2b20gQXVmcnVmZXIgXHUwMEZDYmVyZ2ViZW4gc3RhdHQgaGllciBuYWNoZ2VzY2hsYWdlbiwgZGFtaXQgei4gQi4gYmVpIGVpbmVyXG4vLyBVbWJlbmVubnVuZyBiZXd1c3N0IGZcdTAwRkNyIGFsdCBVTkQgbmV1IGRpZXNlbGJlIChkaWUgZGVzIGFsdGVuIE5hbWVucywgZGllIG5hY2hcbi8vIGRlbSBVbWJlbmVubmVuIGVyaGFsdGVuIGJsZWlidCkgRmFyYmUgdmVyd2VuZGV0IHdlcmRlbiBrYW5uLlxuZnVuY3Rpb24gYXBwZW5kVHlwZU5hbWUocGFyZW50RWwsIHBsdWdpbiwgdHlwZSwgY29sb3IpIHtcbiAgaWYgKHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QpIHtcbiAgICBwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLWlubGluZS1uYW1lXCIsIHRleHQ6IHR5cGUgfSkuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgfSBlbHNlIHtcbiAgICBwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLWlubGluZS1kb3RcIiB9KS5zdHlsZS5iYWNrZ3JvdW5kQ29sb3IgPSBjb2xvcjtcbiAgICBwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLWlubGluZS1uYW1lXCIsIHRleHQ6IHR5cGUgfSk7XG4gIH1cbn1cblxuY2xhc3MgQ29uZmlybURlbGV0ZVR5cGVNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IocGx1Z2luLCB0eXBlLCBvbkNvbmZpcm0pIHtcbiAgICBzdXBlcihwbHVnaW4uYXBwKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLnR5cGUgPSB0eXBlO1xuICAgIHRoaXMub25Db25maXJtID0gb25Db25maXJtO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIHRoaXMubW9kYWxFbC5hZGRDbGFzcyhcImZyZWQtY29uZmlybS1kZWxldGUtbW9kYWxcIik7XG4gICAgY29uc3QgcCA9IGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIik7XG4gICAgcC5hcHBlbmRUZXh0KFwiVHlwIFwiKTtcbiAgICBhcHBlbmRUeXBlTmFtZShwLCB0aGlzLnBsdWdpbiwgdGhpcy50eXBlLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3RoaXMudHlwZV0gPz8gREVGQVVMVF9UWVBFX0NPTE9SKTtcbiAgICBwLmFwcGVuZFRleHQoXCIgd2lya2xpY2ggbFx1MDBGNnNjaGVuP1wiKTtcblxuICAgIGNvbnN0IGJ1dHRvblJvdyA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibW9kYWwtYnV0dG9uLWNvbnRhaW5lclwiIH0pO1xuICAgIGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQWJicmVjaGVuXCIgfSkuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XG5cbiAgICBjb25zdCBjb25maXJtQnRuID0gYnV0dG9uUm93LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcIm1vZC13YXJuaW5nXCIsIHRleHQ6IFwiTFx1MDBGNnNjaGVuXCIgfSk7XG4gICAgY29uZmlybUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgdGhpcy5vbkNvbmZpcm0oKTtcbiAgICB9KTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuXG4vLyBWb3IgZGVtIFwiVW1iZW5lbm5lbiAoaW5rbC4gTm90aXplbiBhbnBhc3NlbilcIi1CdXR0b24gKHNpZWhlIHJlbmRlclR5cGVTZXR0aW5nc1xuLy8gdW5kIHN0YXJ0RGV0YWlsUmVuYW1lKSAtIGltIEdlZ2Vuc2F0eiB6dXIgbm9ybWFsZW4gVW1iZW5lbm51bmcsIGRpZSBudXIgZGllXG4vLyBQbHVnaW4tRWluc3RlbGx1bmdlbiBcdTAwRTRuZGVydCwgc2NocmVpYnQgZGllc2UgVmFyaWFudGUgenVzXHUwMEU0dHpsaWNoIGRlbiBUWVAtV2VydFxuLy8gYWxsZXIgYmV0cm9mZmVuZW4gTm90aXplbiB1bS4gRGFzIGlzdCBlaW4gQnVsay1TY2hyZWlidm9yZ2FuZyBcdTAwRkNiZXJcbi8vIHBvdGVuemllbGwgdmllbGUgRGF0ZWllbiwgZGFoZXIgaGllciBlaW5lIGV4cGxpeml0ZSBCZXN0XHUwMEU0dGlndW5nIGRhdm9yLlxuY2xhc3MgQ29uZmlybVJlbmFtZVR5cGVNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IocGx1Z2luLCBvbGRUeXBlLCBuZXdUeXBlLCBhZmZlY3RlZENvdW50LCBvbkNvbmZpcm0sIG9uQ2FuY2VsKSB7XG4gICAgc3VwZXIocGx1Z2luLmFwcCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5vbGRUeXBlID0gb2xkVHlwZTtcbiAgICB0aGlzLm5ld1R5cGUgPSBuZXdUeXBlO1xuICAgIHRoaXMuYWZmZWN0ZWRDb3VudCA9IGFmZmVjdGVkQ291bnQ7XG4gICAgdGhpcy5vbkNvbmZpcm0gPSBvbkNvbmZpcm07XG4gICAgdGhpcy5vbkNhbmNlbCA9IG9uQ2FuY2VsO1xuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgdGhpcy5tb2RhbEVsLmFkZENsYXNzKFwiZnJlZC1jb25maXJtLWRlbGV0ZS1tb2RhbFwiKTtcbiAgICAvLyBEaWVzZWxiZSBGYXJiZSBmXHUwMEZDciBhbHQgdW5kIG5ldSAoZGllIGRlcyBhbHRlbiBOYW1lbnMpIC0gZGVyIG5ldWUgTmFtZVxuICAgIC8vIGhhdCB2b3IgZGVtIGVpZ2VudGxpY2hlbiBVbWJlbmVubmVuIG5vY2gga2VpbmVuIGVpZ2VuZW4gRWludHJhZyBpblxuICAgIC8vIHR5cGVDb2xvcnMsIFx1MDBGQ2Jlcm5pbW10IGFiZXIgZGllIEZhcmJlIGRlcyBhbHRlbiAoc2llaGUgYXBwbHlSZW5hbWUpLlxuICAgIGNvbnN0IGNvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0aGlzLm9sZFR5cGVdID8/IERFRkFVTFRfVFlQRV9DT0xPUjtcbiAgICBjb25zdCBwID0gY29udGVudEVsLmNyZWF0ZUVsKFwicFwiKTtcbiAgICBwLmFwcGVuZFRleHQoXCJUWVAgXCIpO1xuICAgIGFwcGVuZFR5cGVOYW1lKHAsIHRoaXMucGx1Z2luLCB0aGlzLm9sZFR5cGUsIGNvbG9yKTtcbiAgICBwLmFwcGVuZFRleHQoXCIgaW4gXCIpO1xuICAgIGFwcGVuZFR5cGVOYW1lKHAsIHRoaXMucGx1Z2luLCB0aGlzLm5ld1R5cGUsIGNvbG9yKTtcbiAgICBwLmFwcGVuZFRleHQoYCB1bWJlbmVubmVuIHVuZCAke3RoaXMuYWZmZWN0ZWRDb3VudH0gTm90aXooZW4pIGVudHNwcmVjaGVuZCBhbnBhc3Nlbj9gKTtcblxuICAgIGNvbnN0IGJ1dHRvblJvdyA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibW9kYWwtYnV0dG9uLWNvbnRhaW5lclwiIH0pO1xuICAgIGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQWJicmVjaGVuXCIgfSkuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XG5cbiAgICBjb25zdCBjb25maXJtQnRuID0gYnV0dG9uUm93LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcIm1vZC1jdGFcIiwgdGV4dDogXCJVbWJlbmVubmVuXCIgfSk7XG4gICAgY29uZmlybUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgdGhpcy5vbkNvbmZpcm0oKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIERlY2t0IHNvd29obCBcIkFiYnJlY2hlblwiLUtsaWNrIGFscyBhdWNoIEVzY2FwZS9LbGljayBkYW5lYmVuIGFiIC0gYW5hbG9nXG4gIC8vIHp1bSBDYW5jZWwtSGFuZGxpbmcgaW4gVHlwUGlja2VyTW9kYWwuXG4gIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgICBpZiAoIXRoaXMuY29uZmlybWVkKSB0aGlzLm9uQ2FuY2VsPy4oKTtcbiAgfVxufVxuXG4vLyBVbWJlbmVubmVuIGF1ZiBkZW4gTmFtZW4gZWluZXMgYmVyZWl0cyByZWdpc3RyaWVydGVuIFRZUHMgKHNpZWhlXG4vLyBzdGFydERldGFpbFJlbmFtZSkgLSBzdGF0dCBkaWUgVW1iZW5lbm51bmcgc3RpbGxzY2h3ZWlnZW5kIHp1IHZlcndlcmZlbixcbi8vIGFuYmlldGVuLCBiZWlkZSB6dXNhbW1lbnp1bGVnZW4gKHNpZWhlIG1lcmdlVHlwZSkuIFNjaHJlaWJ0IGltbWVyIGF1Y2ggZGllXG4vLyBOb3RpemVuIHVtLCB1bmFiaFx1MDBFNG5naWcgZGF2b24sIFx1MDBGQ2JlciB3ZWxjaGVuIGRlciBiZWlkZW4gVW1iZW5lbm5lbi1CdXR0b25zIGVzXG4vLyBhdXNnZWxcdTAwRjZzdCB3dXJkZTogZWluIFp1c2FtbWVubGVnZW4gbnVyIGluIGRlbiBFaW5zdGVsbHVuZ2VuIGxpZVx1MDBERmUgZGllXG4vLyBOb3RpemVuIGRlcyBRdWVsbC1UWVBzIGFscyB1bnJlZ2lzdHJpZXJ0ZW4gRWludHJhZyB6dXJcdTAwRkNjay5cbmNsYXNzIENvbmZpcm1NZXJnZVR5cGVNb2RhbCBleHRlbmRzIENvbmZpcm1SZW5hbWVUeXBlTW9kYWwge1xuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgdGhpcy5tb2RhbEVsLmFkZENsYXNzKFwiZnJlZC1jb25maXJtLWRlbGV0ZS1tb2RhbFwiKTtcbiAgICBjb25zdCBzZXR0aW5ncyA9IHRoaXMucGx1Z2luLnNldHRpbmdzO1xuICAgIGNvbnN0IHAgPSBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIpO1xuICAgIHAuYXBwZW5kVGV4dChcIlRZUCBcIik7XG4gICAgYXBwZW5kVHlwZU5hbWUocCwgdGhpcy5wbHVnaW4sIHRoaXMubmV3VHlwZSwgc2V0dGluZ3MudHlwZUNvbG9yc1t0aGlzLm5ld1R5cGVdID8/IERFRkFVTFRfVFlQRV9DT0xPUik7XG4gICAgcC5hcHBlbmRUZXh0KFwiIGV4aXN0aWVydCBiZXJlaXRzLiBcIik7XG4gICAgYXBwZW5kVHlwZU5hbWUocCwgdGhpcy5wbHVnaW4sIHRoaXMub2xkVHlwZSwgc2V0dGluZ3MudHlwZUNvbG9yc1t0aGlzLm9sZFR5cGVdID8/IERFRkFVTFRfVFlQRV9DT0xPUik7XG4gICAgcC5hcHBlbmRUZXh0KFwiIGRhbWl0IHp1c2FtbWVubGVnZW4/XCIpO1xuXG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OlxuICAgICAgICBgJHt0aGlzLmFmZmVjdGVkQ291bnR9IE5vdGl6KGVuKSB3ZXJkZW4gYXVmICR7dGhpcy5uZXdUeXBlfSB1bWdlc3RlbGx0LiBgICtcbiAgICAgICAgYEZhcmJlLCBCZXNjaHJlaWJ1bmcgdW5kIFN0YW5kYXJkLUZyb250bWF0dGVyIHZvbiAke3RoaXMub2xkVHlwZX0gZW50ZmFsbGVuLmAsXG4gICAgfSk7XG5cbiAgICBjb25zdCBidXR0b25Sb3cgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm1vZGFsLWJ1dHRvbi1jb250YWluZXJcIiB9KTtcbiAgICBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkFiYnJlY2hlblwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuXG4gICAgY29uc3QgY29uZmlybUJ0biA9IGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJtb2Qtd2FybmluZ1wiLCB0ZXh0OiBcIlp1c2FtbWVubGVnZW5cIiB9KTtcbiAgICBjb25maXJtQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpcm1lZCA9IHRydWU7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICB0aGlzLm9uQ29uZmlybSgpO1xuICAgIH0pO1xuICB9XG59XG5cbmNsYXNzIFR5cFZpZXcgZXh0ZW5kcyBJdGVtVmlldyB7XG4gIGNvbnN0cnVjdG9yKGxlYWYsIHBsdWdpbikge1xuICAgIHN1cGVyKGxlYWYpO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgZ2V0Vmlld1R5cGUoKSB7XG4gICAgcmV0dXJuIFZJRVdfVFlQRV9UWVA7XG4gIH1cblxuICBnZXREaXNwbGF5VGV4dCgpIHtcbiAgICByZXR1cm4gXCJUWVBcIjtcbiAgfVxuXG4gIGdldEljb24oKSB7XG4gICAgcmV0dXJuIFwic2hhcGVzXCI7XG4gIH1cblxuICBhc3luYyBvbk9wZW4oKSB7XG4gICAgdGhpcy5pc0VkaXRpbmcgPSBmYWxzZTtcbiAgICB0aGlzLnNlbGVjdGVkVHlwZSA9IG51bGw7XG4gICAgdGhpcy5mcm9udG1hdHRlckVkaXRvciA9IG51bGw7XG5cbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIHRoaXMuY29udGVudEVsLmFkZENsYXNzKFwiZnJlZC10eXAtdmlld1wiKTtcblxuICAgIHRoaXMucmVnaXN0ZXJEb21FdmVudCh0aGlzLmNvbnRlbnRFbCwgXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFc2NhcGVcIiAmJiB0aGlzLnNlbGVjdGVkVHlwZSAhPT0gbnVsbCkgdGhpcy5jbG9zZVR5cGVTZXR0aW5ncygpO1xuICAgIH0pO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICBhc3luYyBvbkNsb3NlKCkge31cblxuICBvcGVuU2VhcmNoKHR5cGUpIHtcbiAgICBjb25zdCBnbG9iYWxTZWFyY2ggPSB0aGlzLnBsdWdpbi5hcHAuaW50ZXJuYWxQbHVnaW5zLmdldFBsdWdpbkJ5SWQoXCJnbG9iYWwtc2VhcmNoXCIpO1xuICAgIGlmICghZ2xvYmFsU2VhcmNoKSByZXR1cm47XG4gICAgLy8gXCJrZWluIFR5cFwiIHRyXHUwMEU0ZmUgb2huZSBGaWx0ZXIgYXVjaCBhbGxlIE5pY2h0LU1hcmtkb3duLURhdGVpZW4gKGRpZSBuYXR1cmdlbVx1MDBFNFx1MDBERlxuICAgIC8vIG5pZSBlaW5lIEZyb250bWF0dGVyLVByb3BlcnR5IGhhYmVuIGtcdTAwRjZubmVuKSAtIGRhaGVyIGV4cGxpeml0IGF1ZiAubWQgZWluZ3Jlbnplbi5cbiAgICAvLyBGXHUwMEZDciBlaW5lIExpc3RlICh1bnJlZ2lzdHJpZXJ0ZXIgU2NobFx1MDBGQ3NzZWwgXCJbQSwgQl1cIikgZ2lidCBlcyBrZWluZSBleGFrdGVcbiAgICAvLyBTdWNoc3ludGF4IC0gZGFubiBuYWNoIE5vdGl6ZW4gc3VjaGVuLCBkaWUgYWxsZSBpaHJlIEVpbnRyXHUwMEU0Z2UgdHJhZ2VuLlxuICAgIGNvbnN0IHJhdyA9IHR5cGUgPT09IG51bGwgPyB1bmRlZmluZWQgOiB0aGlzLnBsdWdpbi50eXBJbmRleC5yYXdWYWx1ZU9mKHR5cGUpO1xuICAgIGNvbnN0IHF1ZXJ5ID1cbiAgICAgIHR5cGUgPT09IG51bGxcbiAgICAgICAgPyBgLVtcIiR7VFlQX1BST1BFUlRZfVwiXSBmaWxlOi5tZGBcbiAgICAgICAgOiBBcnJheS5pc0FycmF5KHJhdylcbiAgICAgICAgICA/IHJhdy5tYXAoKHYpID0+IGBbXCIke1RZUF9QUk9QRVJUWX1cIjpcIiR7U3RyaW5nKHYgPz8gXCJcIikudHJpbSgpfVwiXWApLmpvaW4oXCIgXCIpXG4gICAgICAgICAgOiBgW1wiJHtUWVBfUFJPUEVSVFl9XCI6XCIke3R5cGV9XCJdYDtcbiAgICBnbG9iYWxTZWFyY2guaW5zdGFuY2Uub3Blbkdsb2JhbFNlYXJjaChxdWVyeSk7XG4gIH1cblxuICAvLyB0eXBlS2V5IGtvbW10IDE6MSBhdXMgZGVuIHRhdHNcdTAwRTRjaGxpY2hlbiBGcm9udG1hdHRlci1XZXJ0ZW4gKHNpZWhlXG4gIC8vIHVucmVnaXN0ZXJlZFJvd3MgaW4gcmVuZGVyKCkgdW5kIHR5cGVLZXlPZiBpbiB0eXAtaW5kZXguanMpIC0ga2FubiBhbHNvXG4gIC8vIGtsZWluIGdlc2NocmllYmVuIHNlaW4sIFJhbmRsZWVyemVpY2hlbiB0cmFnZW4gb2RlciBlaW5lIExpc3RlIHNlaW4uIFRZUGVuXG4gIC8vIHdlcmRlbiBhYmVyIGltbWVyIGFscyBzYXViZXJlciBFaW56ZWx3ZXJ0IGluIEdyb1x1MDBERmJ1Y2hzdGFiZW4gZ2VmXHUwMEZDaHJ0IC1cbiAgLy8gcmVnaXN0cmllcnQgd2lyZCBkZXNoYWxiIGRpZSBiZXJlaW5pZ3RlIEZvcm0gKHNpZWhlIG5vcm1hbGl6ZVJhd1R5cGUpLCB1bmRcbiAgLy8gZGllIGJldHJvZmZlbmVuIE5vdGl6ZW4gd2VyZGVuIGdsZWljaCBtaXQgdW1nZXNjaHJpZWJlbiwgZGFtaXQgc2llIG5pY2h0XG4gIC8vIHdlaXRlcmhpbiBhbHMgXCJuaWNodCByZWdpc3RyaWVydFwiIGF1ZnRhdWNoZW4uXG4gIGFzeW5jIHJlZ2lzdGVyVHlwZSh0eXBlS2V5KSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgucmF3VmFsdWVPZih0eXBlS2V5KTtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplUmF3VHlwZShyYXcgPT09IHVuZGVmaW5lZCA/IHR5cGVLZXkgOiByYXcpO1xuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuO1xuICAgIGlmICghdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMuaW5jbHVkZXMobm9ybWFsaXplZCkpIHtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzLnB1c2gobm9ybWFsaXplZCk7XG4gICAgfVxuXG4gICAgbGV0IHJlbmFtZWQgPSAwO1xuICAgIGlmIChub3JtYWxpemVkICE9PSB0eXBlS2V5KSB7XG4gICAgICByZW5hbWVkID0gYXdhaXQgcmVuYW1lVHlwZUluTm90ZXModGhpcy5wbHVnaW4sIHR5cGVLZXksIG5vcm1hbGl6ZWQpO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG5cbiAgICBpZiAocmVuYW1lZCA+IDApIHtcbiAgICAgIG5ldyBOb3RpY2UoYFRZUCAke25vcm1hbGl6ZWR9IHJlZ2lzdHJpZXJ0LCAke3JlbmFtZWR9IE5vdGl6KGVuKSBhbmdlcGFzc3QuYCk7XG4gICAgfVxuICB9XG5cbiAgLy8gTmV1ZXMsIGxlZXJlcyBUcmVlLUl0ZW0gYW5sZWdlbiB1bmQgc29mb3J0IGluIGRlbiBFZGl0aWVyLU1vZHVzIHZlcnNldHplbiAtXG4gIC8vIHdpZSBiZWkgT2JzaWRpYW5zIGVpZ2VuZW4gVmlld3MgKHouIEIuIG5ldWUgQm9va21hcmstR3J1cHBlKS5cbiAgc3RhcnRBZGQoKSB7XG4gICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm47XG5cbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcbiAgICBpZiAodGhpcy5zZXBhcmF0b3JFbCkgdGhpcy5saXN0RWwuaW5zZXJ0QmVmb3JlKHRyZWVJdGVtLCB0aGlzLnNlcGFyYXRvckVsKTtcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZVwiIH0pO1xuICAgIGNvbnN0IGlubmVyID0gc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIgfSk7XG5cbiAgICB0aGlzLnN0YXJ0RWRpdGluZyhudWxsLCBzZWxmLCBpbm5lcik7XG4gIH1cblxuICAvLyBXaWUgT2JzaWRpYW5zIGVpZ2VuZSBUcmVlLUl0ZW1zOiBrZWluIHp1c1x1MDBFNHR6bGljaGVzIElucHV0LUVsZW1lbnQsIHNvbmRlcm5cbiAgLy8gZGFzIGJlc3RlaGVuZGUgVGV4dC1FbGVtZW50IHdpcmQgc2VsYnN0IGVkaXRpZXJiYXIgKGNvbnRlbnRlZGl0YWJsZSkuXG4gIC8vIHR5cGUgPT09IG51bGwgXHUyMTkyIG5ldWVyIEVpbnRyYWcsIHNvbnN0IFVtYmVuZW5uZW4gZGVzIFx1MDBGQ2JlcmdlYmVuZW4gVHlwcy5cbiAgc3RhcnRFZGl0aW5nKHR5cGUsIHNlbGYsIGlubmVyKSB7XG4gICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm47XG4gICAgdGhpcy5pc0VkaXRpbmcgPSB0cnVlO1xuXG4gICAgc2VsZi5hZGRDbGFzcyhcImlzLWJlaW5nLXJlbmFtZWRcIik7XG4gICAgaW5uZXIuc2V0QXR0cmlidXRlKFwiY29udGVudGVkaXRhYmxlXCIsIFwidHJ1ZVwiKTtcbiAgICBpbm5lci5zZXRBdHRyaWJ1dGUoXCJzcGVsbGNoZWNrXCIsIFwiZmFsc2VcIik7XG4gICAgaW5uZXIuZm9jdXMoKTtcblxuICAgIGNvbnN0IHJhbmdlID0gaW5uZXIuZG9jLmNyZWF0ZVJhbmdlKCk7XG4gICAgcmFuZ2Uuc2VsZWN0Tm9kZUNvbnRlbnRzKGlubmVyKTtcbiAgICBjb25zdCBzZWxlY3Rpb24gPSBpbm5lci53aW4uZ2V0U2VsZWN0aW9uKCk7XG4gICAgc2VsZWN0aW9uLnJlbW92ZUFsbFJhbmdlcygpO1xuICAgIHNlbGVjdGlvbi5hZGRSYW5nZShyYW5nZSk7XG5cbiAgICBsZXQgZG9uZSA9IGZhbHNlO1xuICAgIGNvbnN0IGZpbmlzaCA9IGFzeW5jIChjb21taXQpID0+IHtcbiAgICAgIGlmIChkb25lKSByZXR1cm47XG4gICAgICBkb25lID0gdHJ1ZTtcbiAgICAgIHRoaXMuaXNFZGl0aW5nID0gZmFsc2U7XG5cbiAgICAgIGNvbnN0IHZhbHVlID0gbm9ybWFsaXplVHlwZU5hbWUoaW5uZXIudGV4dENvbnRlbnQpO1xuICAgICAgaWYgKGNvbW1pdCAmJiB2YWx1ZSAmJiB2YWx1ZSAhPT0gdHlwZSkge1xuICAgICAgICBjb25zdCBleGlzdHMgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5zb21lKFxuICAgICAgICAgICh0KSA9PiB0LnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkgJiYgdCAhPT0gdHlwZVxuICAgICAgICApO1xuICAgICAgICBpZiAoIWV4aXN0cykge1xuICAgICAgICAgIGlmICh0eXBlID09PSBudWxsKSB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5wdXNoKHZhbHVlKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3QgaWR4ID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMuaW5kZXhPZih0eXBlKTtcbiAgICAgICAgICAgIGlmIChpZHggIT09IC0xKSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlc1tpZHhdID0gdmFsdWU7XG4gICAgICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXTtcbiAgICAgICAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXTtcbiAgICAgICAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXTtcbiAgICAgICAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXTtcbiAgICAgICAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodGhpcy5lbnN1cmVUeXBlTWFudWFsKClbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVNYW51YWxbdHlwZV07XG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsW3R5cGVdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICB9O1xuXG4gICAgaW5uZXIuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZmluaXNoKHRydWUpO1xuICAgICAgfSBlbHNlIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZmluaXNoKGZhbHNlKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGlubmVyLmFkZEV2ZW50TGlzdGVuZXIoXCJibHVyXCIsICgpID0+IGZpbmlzaCh0cnVlKSk7XG4gIH1cblxuICBvcGVuVHlwZVNldHRpbmdzKHR5cGUpIHtcbiAgICB0aGlzLnNlbGVjdGVkVHlwZSA9IHR5cGU7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIGNsb3NlVHlwZVNldHRpbmdzKCkge1xuICAgIHRoaXMuc2VsZWN0ZWRUeXBlID0gbnVsbDtcbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgLy8gV2lyZCBhbHMgQ29tcG9uZW50LUNoaWxkIGdlbGFkZW4gKHNpZWhlIG1vdW50VHlwZUZyb250bWF0dGVyRWRpdG9yKSB1bmQgbXVzc1xuICAvLyBkZXNoYWxiIHZvciBqZWRlbSBOZXVhdWZiYXUgZGVyIERldGFpbC1BbnNpY2h0IGV4cGxpeml0IGVudGxhZGVuIHdlcmRlbiAtXG4gIC8vIGNvbnRlbnRFbC5lbXB0eSgpIGFsbGVpbiB3XHUwMEZDcmRlIG51ciBkaWUgRE9NLUVsZW1lbnRlIGVudGZlcm5lbiwgbmljaHQgYWJlclxuICAvLyBkZW4gZGFyYXVmIHJlZ2lzdHJpZXJ0ZW4gbWV0YWRhdGFUeXBlTWFuYWdlci1MaXN0ZW5lciBkZXIgRWRpdG9yLUluc3RhbnouXG4gIGRlc3Ryb3lGcm9udG1hdHRlckVkaXRvcigpIHtcbiAgICBpZiAodGhpcy5mcm9udG1hdHRlckVkaXRvcikge1xuICAgICAgdGhpcy5yZW1vdmVDaGlsZCh0aGlzLmZyb250bWF0dGVyRWRpdG9yKTtcbiAgICAgIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3IgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHJlbmRlcigpIHtcbiAgICAvLyBSZWVudHJhbmN5LUd1YXJkOiByZW5kZXJUeXBlU2V0dGluZ3MoKSBsXHUwMEY2c3QgYW0gRW5kZSBzZWxic3RcbiAgICAvLyBwbHVnaW4ucmVmcmVzaFR5cENvbG9ycygpIGF1cyAoc2llaGUgZG9ydGlnZXIgS29tbWVudGFyKSwgd2FzIHUuIGEuXG4gICAgLy8gXHUwMEZDYmVyIHJlZ2lzdGVyVHlwVmlldyB3aWVkZXJ1bSByZW5kZXIoKSBhdWYgYWxsZW4gVFlQLVZpZXctTGVhdmVzXG4gICAgLy8gYXVmcnVmdCAtIGlua2x1c2l2ZSBkaWVzZW0sIHdcdTAwRTRocmVuZCBlcyBub2NoIG1pdHRlbiBpbiBnZW5hdSBkaWVzZW1cbiAgICAvLyBBdWZydWYgc3RlY2t0LiBPaG5lIEd1YXJkIHJla3Vyc2llcnQgZGFzIHN5bmNocm9uIG9obmUgQWJicnVjaCBiaXNcbiAgICAvLyB6dW0gU3RhY2sgT3ZlcmZsb3csIGJlaSBqZWRlbSBcdTAwRDZmZm5lbi9VbWJlbmVubmVuIGVpbmVzIFRZUHMuXG4gICAgaWYgKHRoaXMuX3JlbmRlcmluZykgcmV0dXJuO1xuICAgIHRoaXMuX3JlbmRlcmluZyA9IHRydWU7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuZGVzdHJveUZyb250bWF0dGVyRWRpdG9yKCk7XG4gICAgICBpZiAodGhpcy5zZWxlY3RlZFR5cGUgIT09IG51bGwpIHtcbiAgICAgICAgdGhpcy5yZW5kZXJUeXBlU2V0dGluZ3ModGhpcy5zZWxlY3RlZFR5cGUpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgICAgY29udGVudEVsLmVtcHR5KCk7XG5cbiAgICAgIGNvbnN0IHsgY291bnRzLCBub1R5cGUgfSA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnR5cGVDb3VudHMoKTtcbiAgICAgIGNvbnN0IHJlZ2lzdGVyZWQgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcztcbiAgICAgIGNvbnN0IHR5cGVDb2xvcnMgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzO1xuICAgICAgY29uc3Qgc29ydE9yZGVyID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwU29ydE9yZGVyID8/IERFRkFVTFRfU09SVF9PUkRFUjtcbiAgICAgIGNvbnN0IGlzTWFudWFsU29ydCA9IHNvcnRPcmRlciA9PT0gXCJtYW51YWxcIjtcbiAgICAgIGNvbnN0IGJ5Q3VycmVudE9yZGVyID0gKGEsIGIpID0+IGNvbXBhcmVUeXBlcyhzb3J0T3JkZXIsIGEsIGIsIGNvdW50cywgdHlwZUNvbG9ycyk7XG5cbiAgICAgIHRoaXMucmVuZGVyTGlzdEhlYWRlcihjb250ZW50RWwpO1xuXG4gICAgICAvLyBcIltLRUlOIFRZUF1cIiBpc3Qga2VpbiBlY2h0ZXIgVHlwIHVuZCBuaW1tdCBhbiBkZXIgU29ydGllcnVuZyBuaWNodCB0ZWlsIC1cbiAgICAgIC8vIHN0ZWh0IHVuYWJoXHUwMEU0bmdpZyB2b24gc2VpbmVyIEFuemFobCBpbW1lciB6dWxldHp0LlxuICAgICAgY29uc3QgdW5yZWdpc3RlcmVkUm93cyA9IFsuLi5jb3VudHMua2V5cygpXVxuICAgICAgICAuZmlsdGVyKCh0eXBlKSA9PiAhcmVnaXN0ZXJlZC5pbmNsdWRlcyh0eXBlKSlcbiAgICAgICAgLnNvcnQoYnlDdXJyZW50T3JkZXIpXG4gICAgICAgIC5tYXAoKHR5cGUpID0+ICh7IHR5cGUsIGNvdW50OiBjb3VudHMuZ2V0KHR5cGUpID8/IDAgfSkpO1xuICAgICAgaWYgKG5vVHlwZSA+IDApIHtcbiAgICAgICAgdW5yZWdpc3RlcmVkUm93cy5wdXNoKHsgdHlwZTogbnVsbCwgY291bnQ6IG5vVHlwZSB9KTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgbGlzdENscyA9IFwiZnJlZC10eXAtbGlzdCBuYXYtZmlsZXMtY29udGFpbmVyXCIgKyAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTGlzdERlc2NyaXB0aW9uRW5hYmxlZCA/IFwiXCIgOiBcIiBmcmVkLXR5cC1saXN0LW5vLWRlc2NyaXB0aW9uXCIpO1xuICAgICAgdGhpcy5saXN0RWwgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBsaXN0Q2xzIH0pO1xuICAgICAgdGhpcy5zZXBhcmF0b3JFbCA9IG51bGw7XG5cbiAgICAgIC8vIHNvcnRUeXBlc0J5TW9kZSgpIGxcdTAwRTRzc3QgaW0gTWFudWVsbC1Nb2R1cyBiZXd1c3N0IGRpZSBSZWloZW5mb2xnZSB2b25cbiAgICAgIC8vIHBsdWdpbi5zZXR0aW5ncy50eXBlcyB1bmFuZ2V0YXN0ZXQgLSBwZXIgRHJhZyAmIERyb3AgaW5cbiAgICAgIC8vIHJlbmRlclJlZ2lzdGVyZWRJdGVtKCkgdW1zb3J0aWVydC4gRGVyIGluZGV4IHdpcmQgZGFmXHUwMEZDciAxOjEgYWxzXG4gICAgICAvLyBQb3NpdGlvbiBpbiBkaWVzZXIgKGluIGRpZXNlbSBNb2R1cyB1bnZlclx1MDBFNG5kZXJ0ZW4pIFJlaWhlbmZvbGdlXG4gICAgICAvLyB3ZWl0ZXJnZWdlYmVuLlxuICAgICAgY29uc3QgcmVnaXN0ZXJlZE9yZGVyID0gc29ydFR5cGVzQnlNb2RlKHJlZ2lzdGVyZWQsIHNvcnRPcmRlciwgY291bnRzLCB0eXBlQ29sb3JzKTtcbiAgICAgIHJlZ2lzdGVyZWRPcmRlci5mb3JFYWNoKCh0eXBlLCBpbmRleCkgPT4ge1xuICAgICAgICB0aGlzLnJlbmRlclJlZ2lzdGVyZWRJdGVtKHR5cGUsIGNvdW50cy5nZXQodHlwZSkgPz8gMCwgeyBkcmFnZ2FibGU6IGlzTWFudWFsU29ydCwgaW5kZXggfSk7XG4gICAgICB9KTtcblxuICAgICAgaWYgKHVucmVnaXN0ZXJlZFJvd3MubGVuZ3RoID4gMCkge1xuICAgICAgICB0aGlzLnNlcGFyYXRvckVsID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXNlcGFyYXRvclwiIH0pO1xuICAgICAgICBmb3IgKGNvbnN0IHJvdyBvZiB1bnJlZ2lzdGVyZWRSb3dzKSB7XG4gICAgICAgICAgaWYgKHJvdy50eXBlID09PSBudWxsKSB0aGlzLnJlbmRlck5vVHlwZUl0ZW0ocm93LmNvdW50KTtcbiAgICAgICAgICBlbHNlIHRoaXMucmVuZGVyVW5yZWdpc3RlcmVkSXRlbShyb3cudHlwZSwgcm93LmNvdW50KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9yZW5kZXJpbmcgPSBmYWxzZTtcbiAgICB9XG4gIH1cblxuICAvLyBXaWUgZGVyIFwiQ2hhbmdlIHNvcnQgb3JkZXJcIi1CdXR0b24gaW4gT2JzaWRpYW5zIFRhZ3MtIGJ6dy4gQWxsLVByb3BlcnRpZXMtVmlldy5cbiAgcmVuZGVyTGlzdEhlYWRlcihjb250ZW50RWwpIHtcbiAgICBjb25zdCBoZWFkZXIgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm5hdi1oZWFkZXJcIiB9KTtcbiAgICBjb25zdCBidXR0b25zQ29udGFpbmVyID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJuYXYtYnV0dG9ucy1jb250YWluZXJcIiB9KTtcblxuICAgIGNvbnN0IGFkZEJ0biA9IGJ1dHRvbnNDb250YWluZXIuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBuYXYtYWN0aW9uLWJ1dHRvblwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJOZXVlbiBUeXAgaGluenVmXHUwMEZDZ2VuXCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKGFkZEJ0biwgXCJwbHVzXCIpO1xuICAgIGFkZEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydEFkZCgpKTtcblxuICAgIGNvbnN0IHNvcnRCdG4gPSBidXR0b25zQ29udGFpbmVyLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gbmF2LWFjdGlvbi1idXR0b25cIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiU29ydGllcnJlaWhlbmZvbGdlIFx1MDBFNG5kZXJuXCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKHNvcnRCdG4sIFwibHVjaWRlLXNvcnQtYXNjXCIpO1xuICAgIHNvcnRCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4gdGhpcy5zaG93U29ydE1lbnUoZXZlbnQpKTtcbiAgfVxuXG4gIHNob3dTb3J0TWVudShldmVudCkge1xuICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xuICAgIGNvbnN0IG1lbnUgPSBuZXcgTWVudSgpO1xuXG4gICAgY29uc3QgYWRkR3JvdXAgPSAoc3RhcnQsIGVuZCkgPT4ge1xuICAgICAgZm9yIChsZXQgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgICAgY29uc3QgeyBtb2RlLCB0aXRsZSB9ID0gU09SVF9PUFRJT05TW2ldO1xuICAgICAgICBtZW51LmFkZEl0ZW0oKGl0ZW0pID0+XG4gICAgICAgICAgaXRlbVxuICAgICAgICAgICAgLnNldFRpdGxlKHRpdGxlKVxuICAgICAgICAgICAgLnNldENoZWNrZWQoY3VycmVudCA9PT0gbW9kZSlcbiAgICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwU29ydE9yZGVyID0gbW9kZTtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICApO1xuICAgICAgfVxuICAgIH07XG5cbiAgICBhZGRHcm91cCgwLCAxKTtcbiAgICBtZW51LmFkZFNlcGFyYXRvcigpO1xuICAgIGFkZEdyb3VwKDEsIDMpO1xuICAgIG1lbnUuYWRkU2VwYXJhdG9yKCk7XG4gICAgYWRkR3JvdXAoMywgNSk7XG4gICAgbWVudS5hZGRTZXBhcmF0b3IoKTtcbiAgICBhZGRHcm91cCg1LCA3KTtcblxuICAgIG1lbnUuc2hvd0F0TW91c2VFdmVudChldmVudCk7XG4gIH1cblxuICByZW5kZXJOb1R5cGVJdGVtKGNvdW50KSB7XG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGUgZnJlZC10eXAtdW5yZWdpc3RlcmVkXCIgfSk7XG4gICAgc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIsIHRleHQ6IFwiW0tFSU4gVFlQXVwiIH0pO1xuICAgIHRoaXMucmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCk7XG5cbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLm9wZW5TZWFyY2gobnVsbCkpO1xuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNvbnRleHRtZW51XCIsIChldmVudCkgPT4ge1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdGhpcy5vcGVuU2VhcmNoKG51bGwpO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gQ2hyb21pdW1zIGlucHV0W3R5cGU9Y29sb3JdIGhhdCBlaW5lbiBlaWdlbmVuIE1pbmRlc3QtU3dhdGNoLCBkZXIgc2ljaCBuaWNodFxuICAvLyB1bnRlciBUZXh0Z3JcdTAwRjZcdTAwREZlIHNrYWxpZXJlbiBsXHUwMEU0c3N0IC0gZGFoZXIgbnVyIGFscyB1bnNpY2h0YmFyZW4gUGlja2VyLVRyaWdnZXJcbiAgLy8gXHUwMEZDYmVyIGRlbSBmcmVpIHNrYWxpZXJiYXJlbiBQdW5rdCBwbGF0emllcmVuLlxuICByZW5kZXJDb2xvclBpY2tlcihwYXJlbnQsIHR5cGUsIG9uQ2hhbmdlLCB7IHNob3dSZXNldCA9IGZhbHNlIH0gPSB7fSkge1xuICAgIGNvbnN0IGN1cnJlbnRDb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gPz8gREVGQVVMVF9UWVBFX0NPTE9SO1xuICAgIGNvbnN0IGNvbG9yV3JhcCA9IHBhcmVudC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtY29sb3Itd3JhcFwiIH0pO1xuICAgIGNvbnN0IGNvbG9yRG90ID0gY29sb3JXcmFwLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1jb2xvci1kb3RcIiB9KTtcbiAgICBjb2xvckRvdC5zdHlsZS5iYWNrZ3JvdW5kQ29sb3IgPSBjdXJyZW50Q29sb3I7XG5cbiAgICBjb25zdCBjb2xvcklucHV0ID0gY29sb3JXcmFwLmNyZWF0ZUVsKFwiaW5wdXRcIiwgeyB0eXBlOiBcImNvbG9yXCIsIGNsczogXCJmcmVkLXR5cC1jb2xvci1pbnB1dFwiIH0pO1xuICAgIGNvbG9ySW5wdXQudmFsdWUgPSBjdXJyZW50Q29sb3I7XG4gICAgY29sb3JJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiBldmVudC5zdG9wUHJvcGFnYXRpb24oKSk7XG5cbiAgICAvLyBcImlucHV0XCIgZmV1ZXJ0IGJlaSBqZWRlciBad2lzY2hlbmZhcmJlLCB3XHUwMEU0aHJlbmQgZGVyIG5hdGl2ZSBQaWNrZXIgbm9jaFxuICAgIC8vIG9mZmVuIGlzdCAtIGhpZXIgbnVyIGxva2FsZSBWb3JzY2hhdSAoUHVua3QsIGdnZi4gTmFtZSB2aWEgb25DaGFuZ2UpLCBvaG5lXG4gICAgLy8gZGllIFx1MDBGQ2JyaWdlbiBWaWV3cyAoRGF0ZWktRXhwbG9yZXIsIEdyYXBoLCAuLi4pIG5ldSB6dSByZW5kZXJuOlxuICAgIC8vIHJlZnJlc2hUeXBDb2xvcnMoKSBsXHUwMEY2c3QgZGFmXHUwMEZDciB1LiBhLiByZW5kZXIoKSBhdWYgZGllc2VyIFRZUC1WaWV3IHNlbGJzdFxuICAgIC8vIGF1cywgd2FzIGRpZXNlcyA8aW5wdXQgdHlwZT1jb2xvcj4gYXVzIGRlbSBET00gZW50ZmVybmVuIHVuZCBkZW4gbmF0aXZlblxuICAgIC8vIFBpY2tlciBkYW1pdCBzb2ZvcnQgc2NobGllXHUwMERGZW4gd1x1MDBGQ3JkZSAtIG5vY2ggYmV2b3IgbWFuIFx1MDBGQ2JlcmhhdXB0IGVpbmUgRmFyYmVcbiAgICAvLyBhdXN3XHUwMEU0aGxlbiBrYW5uIChzY2hvbiBiZWltIGVyc3RlbiBLbGljaywgdm9yIGRlbSBMb3NsYXNzZW4gZGVyIFRhc3RlKS5cbiAgICBjb2xvcklucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb2xvckRvdC5zdHlsZS5iYWNrZ3JvdW5kQ29sb3IgPSBjb2xvcklucHV0LnZhbHVlO1xuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA9IGNvbG9ySW5wdXQudmFsdWU7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIG9uQ2hhbmdlPy4oY29sb3JJbnB1dC52YWx1ZSk7XG4gICAgfSk7XG5cbiAgICAvLyBFcnN0IHdlbm4gZGllIEF1c3dhaGwgYmVzdFx1MDBFNHRpZ3QgdW5kIGRlciBuYXRpdmUgUGlja2VyIGRhZHVyY2ggZ2VzY2hsb3NzZW5cbiAgICAvLyB3aXJkLCBkaWUgXHUwMEZDYnJpZ2VuIFZpZXdzIG5hY2h6aWVoZW4gLSBhbiBkZW0gUHVua3Qga2FubiBlaW4gTmV1LVJlbmRlcm5cbiAgICAvLyBkaWVzZXIgVFlQLVZpZXcgc2VsYnN0IG5pY2h0cyBtZWhyIGthcHV0dCBtYWNoZW4uXG4gICAgY29sb3JJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsICgpID0+IHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpKTtcblxuICAgIGlmIChzaG93UmVzZXQpIHtcbiAgICAgIGNvbnN0IHJlc2V0QnRuID0gcGFyZW50LmNyZWF0ZURpdih7XG4gICAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1jb2xvci1yZXNldFwiLFxuICAgICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkZhcmJlIHp1clx1MDBGQ2Nrc2V0emVuXCIgfSxcbiAgICAgIH0pO1xuICAgICAgc2V0SWNvbihyZXNldEJ0biwgXCJyb3RhdGUtY2N3XCIpO1xuICAgICAgcmVzZXRCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV07XG4gICAgICAgIGNvbG9ySW5wdXQudmFsdWUgPSBERUZBVUxUX1RZUEVfQ09MT1I7XG4gICAgICAgIGNvbG9yRG90LnN0eWxlLmJhY2tncm91bmRDb2xvciA9IERFRkFVTFRfVFlQRV9DT0xPUjtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICBvbkNoYW5nZT8uKERFRkFVTFRfVFlQRV9DT0xPUik7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gY29sb3JXcmFwO1xuICB9XG5cbiAgLy8gRlx1MDBFNG5ndCBCZXN0YW5kc2luc3RhbGxhdGlvbmVuIGFiLCBkZXJlbiBzZXR0aW5ncy1PYmpla3Qgc2Nob24gdm9yIEVpbmZcdTAwRkNocnVuZ1xuICAvLyB2b24gdHlwZU1hbnVhbCBnZWxhZGVuIHd1cmRlICh6LiBCLiBsYXVmZW5kZSBTZXNzaW9uIHZvciBlaW5lbSB2b2xsc3RcdTAwRTRuZGlnZW5cbiAgLy8gUGx1Z2luLVJlbG9hZCBuYWNoIEhvdC1SZWxvYWQpIC0gb2huZSBkYXMgd1x1MDBGQ3JkZSBqZWRlciBadWdyaWZmIHVudGVuIG1pdFxuICAvLyBcIkNhbm5vdCByZWFkIHByb3BlcnRpZXMgb2YgdW5kZWZpbmVkXCIgYWJicmVjaGVuIHVuZCBkYWJlaSBkZW4gZ2VzYW10ZW5cbiAgLy8gcmVzdGxpY2hlbiByZW5kZXJUeXBlU2V0dGluZ3MoKS1BdWZydWYgKEZhcmJlLCBCZXNjaHJlaWJ1bmcsIEZyb250bWF0dGVyKVxuICAvLyBtaXQgc2ljaCByZWlcdTAwREZlbiwgZGEgZGVyIEZlaGxlciBzeW5jaHJvbiBtaXR0ZW4gaW4gZGVyIEZ1bmt0aW9uIGF1ZnRyaXR0LlxuICBlbnN1cmVUeXBlTWFudWFsKCkge1xuICAgIGlmICghdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbCkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbCA9IHt9O1xuICAgIHJldHVybiB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsO1xuICB9XG5cbiAgLy8gTmFjaGdlYmF1dCB3aWUgT2JzaWRpYW5zIGVpZ2VuZXIgVG9nZ2xlQ29tcG9uZW50IChjaGVja2JveC1jb250YWluZXIgK1xuICAvLyB2ZXJzdGVja3RlcyBpbnB1dFt0eXBlPWNoZWNrYm94XSksIGRhIHdpciBoaWVyIGRpcmVrdCBpbSBET00gc3RhdHQgXHUwMEZDYmVyXG4gIC8vIGRpZSBTZXR0aW5nLUFQSSBiYXVlbi4gU3RhbmRhcmRtXHUwMEU0XHUwMERGaWcgYW4gLSBkYWhlciB3aXJkICh3aWUgYmVpIGRlbiBhbmRlcmVuXG4gIC8vIHR5cGVYeHgtRGljdHMpIG51ciBkaWUgQWJ3ZWljaHVuZyB2b20gRGVmYXVsdCBnZXNwZWljaGVydCwgaGllciBhbHNvIG51clxuICAvLyBcImF1c1wiIChmYWxzZSk7IGZlaGxlbmRlciBFaW50cmFnIGJ6dy4gdHJ1ZSBiZWRldXRlbiBcImFuXCIuIFN0ZXVlcnQsIG9iIGVpblxuICAvLyBUWVAgaW4gZ2V0VHlwZXMoKSAoc2llaGUgbWFpbi5qcykgZXhwb3J0aWVydCB3aXJkLCBzaWVoZSBkb3J0aWdlciBLb21tZW50YXIuXG4gIHJlbmRlck1hbnVhbFRvZ2dsZShwYXJlbnQsIHR5cGUpIHtcbiAgICBjb25zdCBjdXJyZW50ID0gdGhpcy5lbnN1cmVUeXBlTWFudWFsKClbdHlwZV0gIT09IGZhbHNlO1xuICAgIGNvbnN0IHRvZ2dsZUVsID0gcGFyZW50LmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2hlY2tib3gtY29udGFpbmVyXCIgKyAoY3VycmVudCA/IFwiIGlzLWVuYWJsZWRcIiA6IFwiXCIpLFxuICAgICAgYXR0cjogeyB0YWJpbmRleDogXCIwXCIsIHJvbGU6IFwiY2hlY2tib3hcIiwgXCJhcmlhLWNoZWNrZWRcIjogU3RyaW5nKGN1cnJlbnQpIH0sXG4gICAgfSk7XG4gICAgdG9nZ2xlRWwuY3JlYXRlRWwoXCJpbnB1dFwiLCB7IHR5cGU6IFwiY2hlY2tib3hcIiB9KTtcblxuICAgIGNvbnN0IHRvZ2dsZSA9IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG5leHQgPSAhdG9nZ2xlRWwuaGFzQ2xhc3MoXCJpcy1lbmFibGVkXCIpO1xuICAgICAgdG9nZ2xlRWwudG9nZ2xlQ2xhc3MoXCJpcy1lbmFibGVkXCIsIG5leHQpO1xuICAgICAgdG9nZ2xlRWwuc2V0QXR0cmlidXRlKFwiYXJpYS1jaGVja2VkXCIsIFN0cmluZyhuZXh0KSk7XG4gICAgICBpZiAobmV4dCkgZGVsZXRlIHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3R5cGVdO1xuICAgICAgZWxzZSB0aGlzLmVuc3VyZVR5cGVNYW51YWwoKVt0eXBlXSA9IGZhbHNlO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgfTtcblxuICAgIHRvZ2dsZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCB0b2dnbGUpO1xuICAgIHRvZ2dsZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiIHx8IGV2ZW50LmtleSA9PT0gXCIgXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgdG9nZ2xlKCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdG9nZ2xlRWw7XG4gIH1cblxuICByZW5kZXJSZWdpc3RlcmVkSXRlbSh0eXBlLCBjb3VudCwgeyBkcmFnZ2FibGUgPSBmYWxzZSwgaW5kZXggPSAtMSB9ID0ge30pIHtcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZVwiIH0pO1xuXG4gICAgbGV0IG5hbWVFbDtcbiAgICB0aGlzLnJlbmRlckNvbG9yUGlja2VyKHNlbGYsIHR5cGUsIChuZXdDb2xvcikgPT4ge1xuICAgICAgaWYgKG5hbWVFbCAmJiB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QpIG5hbWVFbC5zdHlsZS5jb2xvciA9IG5ld0NvbG9yO1xuICAgIH0pO1xuXG4gICAgbmFtZUVsID0gc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIsIHRleHQ6IHR5cGUgfSk7XG4gICAgY29uc3QgY29sb3IgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QgPyB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdIDogbnVsbDtcbiAgICBpZiAoY29sb3IpIG5hbWVFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuXG4gICAgLy8gRWNodGVzIFRleHQtSW5wdXQgc3RhdHQgbnVyIEFuemVpZ2U6IGRpcmVrdCBpbiBkZXIgTGlzdGUgYmVhcmJlaXRiYXIsIG9obmVcbiAgICAvLyBkYWZcdTAwRkNyIGVyc3QgZGllIERldGFpbGFuc2ljaHQgXHUwMEY2ZmZuZW4genUgbVx1MDBGQ3NzZW4uIGNsaWNrIGhpZXIgbXVzcyBkaWUgWmVpbGVcbiAgICAvLyBzZWxic3QgZ2V6aWVsdCBOSUNIVCBhdXNsXHUwMEY2c2VuIChzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAuLi4pIHVudGVuXG4gICAgLy8gXHUwMEY2ZmZuZXQgc29uc3QgZGllIERldGFpbGFuc2ljaHQpLCBkYWhlciBzdG9wUHJvcGFnYXRpb24uIFx1MDBEQ2JlciBkaWUgRWluc3RlbGx1bmdcbiAgICAvLyBcIkJlc2NocmVpYnVuZ3MtVGV4dGZlbGQgYW56ZWlnZW5cIiBrb21wbGV0dCBhdXNzdGVsbGJhci5cbiAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTGlzdERlc2NyaXB0aW9uRW5hYmxlZCkge1xuICAgICAgY29uc3QgZGVzY0lucHV0ID0gc2VsZi5jcmVhdGVFbChcImlucHV0XCIsIHtcbiAgICAgICAgdHlwZTogXCJ0ZXh0XCIsXG4gICAgICAgIGNsczogXCJmcmVkLXR5cC1saXN0LWRlc2NyaXB0aW9uLWlucHV0XCIsXG4gICAgICB9KTtcbiAgICAgIGRlc2NJbnB1dC52YWx1ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gPz8gXCJcIjtcbiAgICAgIGRlc2NJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiBldmVudC5zdG9wUHJvcGFnYXRpb24oKSk7XG4gICAgICBkZXNjSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gZGVzY0lucHV0LnZhbHVlLnRyaW0oKTtcbiAgICAgICAgaWYgKHZhbHVlKSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdID0gdmFsdWU7XG4gICAgICAgIGVsc2UgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcblxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuICAgICAgdGhpcy5vcGVuVHlwZVNldHRpbmdzKHR5cGUpO1xuICAgIH0pO1xuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNvbnRleHRtZW51XCIsIChldmVudCkgPT4ge1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdGhpcy5vcGVuU2VhcmNoKHR5cGUpO1xuICAgIH0pO1xuXG4gICAgLy8gTnVyIGltIE1hbnVlbGwtU29ydGllcm1vZHVzIGFrdGl2IChzaWVoZSByZW5kZXIoKSkgLSBkaWUgZ2FuemUgWmVpbGUgaXN0XG4gICAgLy8gZGFubiBwZXIgRHJhZyAmIERyb3AgdmVyc2NoaWViYmFyIChlaW4gRHJhZywgZGVyIGF1ZiBkZW0gRmFyYnB1bmt0IG9kZXJcbiAgICAvLyBpbSBCZXNjaHJlaWJ1bmdzZmVsZCBiZWdpbm50LCBncmVpZnQgdHJvdHpkZW0gbmljaHQgLSBkaWVzZSBFbGVtZW50ZVxuICAgIC8vIG5laG1lbiBkZW4gTW91c2Vkb3duIHNlbGJzdCBmXHUwMEZDciBGYXJiLS9UZXh0YXVzd2FobCkuIFZlcnNjaG9iZW4gd2lyZFxuICAgIC8vIGRpcmVrdCBpbiBwbHVnaW4uc2V0dGluZ3MudHlwZXMgLSBkaWVzZWxiZSBMaXN0ZSwgZGllIGltIE1hbnVlbGwtTW9kdXNcbiAgICAvLyB1bnNvcnRpZXJ0IGFscyBBbnplaWdlcmVpaGVuZm9sZ2UgZGllbnQgKHNpZWhlIHJlbmRlcigpKS5cbiAgICBpZiAoZHJhZ2dhYmxlKSB7XG4gICAgICBzZWxmLmRyYWdnYWJsZSA9IHRydWU7XG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnc3RhcnRcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgIGV2ZW50LmRhdGFUcmFuc2Zlci5lZmZlY3RBbGxvd2VkID0gXCJtb3ZlXCI7XG4gICAgICAgIGV2ZW50LmRhdGFUcmFuc2Zlci5zZXREYXRhKFwidGV4dC9wbGFpblwiLCBTdHJpbmcoaW5kZXgpKTtcbiAgICAgICAgc2VsZi5jbGFzc0xpc3QuYWRkKFwiaXMtZHJhZ2dpbmdcIik7XG4gICAgICB9KTtcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdlbmRcIiwgKCkgPT4gc2VsZi5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJhZ2dpbmdcIikpO1xuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ292ZXJcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGNvbnN0IHJlY3QgPSBzZWxmLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICBjb25zdCBpc0FmdGVyID0gZXZlbnQuY2xpZW50WSAtIHJlY3QudG9wID4gcmVjdC5oZWlnaHQgLyAyO1xuICAgICAgICBzZWxmLmNsYXNzTGlzdC50b2dnbGUoXCJpcy1kcm9wLWJlZm9yZVwiLCAhaXNBZnRlcik7XG4gICAgICAgIHNlbGYuY2xhc3NMaXN0LnRvZ2dsZShcImlzLWRyb3AtYWZ0ZXJcIiwgaXNBZnRlcik7XG4gICAgICB9KTtcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdsZWF2ZVwiLCAoKSA9PiBzZWxmLmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcm9wLWJlZm9yZVwiLCBcImlzLWRyb3AtYWZ0ZXJcIikpO1xuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJvcFwiLCBhc3luYyAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IHNlbGYuY2xhc3NMaXN0LmNvbnRhaW5zKFwiaXMtZHJvcC1hZnRlclwiKTtcbiAgICAgICAgc2VsZi5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpO1xuXG4gICAgICAgIGNvbnN0IGZyb21JbmRleCA9IE51bWJlcihldmVudC5kYXRhVHJhbnNmZXIuZ2V0RGF0YShcInRleHQvcGxhaW5cIikpO1xuICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKGZyb21JbmRleCkgfHwgZnJvbUluZGV4ID09PSBpbmRleCkgcmV0dXJuO1xuXG4gICAgICAgIGxldCBpbnNlcnRCZWZvcmUgPSBpc0FmdGVyID8gaW5kZXggKyAxIDogaW5kZXg7XG4gICAgICAgIGlmIChmcm9tSW5kZXggPCBpbnNlcnRCZWZvcmUpIGluc2VydEJlZm9yZSAtPSAxO1xuXG4gICAgICAgIGNvbnN0IHR5cGVzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXM7XG4gICAgICAgIGNvbnN0IFttb3ZlZF0gPSB0eXBlcy5zcGxpY2UoZnJvbUluZGV4LCAxKTtcbiAgICAgICAgdHlwZXMuc3BsaWNlKGluc2VydEJlZm9yZSwgMCwgbW92ZWQpO1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJlbmRlclVucmVnaXN0ZXJlZEl0ZW0odHlwZSwgY291bnQpIHtcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZSBmcmVkLXR5cC11bnJlZ2lzdGVyZWRcIiB9KTtcbiAgICBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiwgdGV4dDogZGlzcGxheVR5cGVLZXkodHlwZSkgfSk7XG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcblxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMucmVnaXN0ZXJUeXBlKHR5cGUpKTtcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMub3BlblNlYXJjaCh0eXBlKTtcbiAgICB9KTtcbiAgfVxuXG4gIHJlbmRlclR5cGVTZXR0aW5ncyh0eXBlKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG5cbiAgICBjb25zdCBoZWFkZXIgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1oZWFkZXJcIiB9KTtcbiAgICBjb25zdCBiYWNrQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1iYWNrXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiWnVyXHUwMEZDY2tcIiB9IH0pO1xuICAgIHNldEljb24oYmFja0J0biwgXCJhcnJvdy1sZWZ0XCIpO1xuICAgIGJhY2tCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2VUeXBlU2V0dGluZ3MoKSk7XG5cbiAgICBjb25zdCB0aXRsZUVsID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtdGl0bGVcIiwgdGV4dDogdHlwZSB9KTtcbiAgICBjb25zdCB0aXRsZUNvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0ID8gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA6IG51bGw7XG4gICAgaWYgKHRpdGxlQ29sb3IpIHRpdGxlRWwuc3R5bGUuY29sb3IgPSB0aXRsZUNvbG9yO1xuXG4gICAgY29uc3QgeyBjb3VudHMgfSA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnR5cGVDb3VudHMoKTtcbiAgICBoZWFkZXIuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtY291bnRcIiwgdGV4dDogU3RyaW5nKGNvdW50cy5nZXQodHlwZSkgPz8gMCkgfSk7XG5cbiAgICAvLyBMaW5rcyBuZWJlbiBkZW0gbm9ybWFsZW4gVW1iZW5lbm5lbi1CdXR0b24sIGhlcnZvcmdlaG9iZW4gKEFremVudGZhcmJlLFxuICAgIC8vIHNpZWhlIHN0eWxlcy5jc3MpIC0gaW0gR2VnZW5zYXR6IHp1IGRpZXNlbSBzY2hyZWlidCBkaWVzZSBWYXJpYW50ZSBiZWltXG4gICAgLy8gVW1iZW5lbm5lbiB6dXNcdTAwRTR0emxpY2ggZGVuIFRZUC1XZXJ0IGFsbGVyIGJldHJvZmZlbmVuIE5vdGl6ZW4gdW0gKG5hY2hcbiAgICAvLyBCZXN0XHUwMEU0dGlndW5nLCBzaWVoZSBzdGFydERldGFpbFJlbmFtZS9Db25maXJtUmVuYW1lVHlwZU1vZGFsKS5cbiAgICBjb25zdCByZW5hbWVXaXRoTm90ZXNCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1kZXRhaWwtcmVuYW1lLW5vdGVzXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlVtYmVuZW5uZW4gKGlua2wuIE5vdGl6ZW4gYW5wYXNzZW4pXCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKHJlbmFtZVdpdGhOb3Rlc0J0biwgXCJwZW5jaWxcIik7XG4gICAgcmVuYW1lV2l0aE5vdGVzQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0RGV0YWlsUmVuYW1lKHR5cGUsIHRpdGxlRWwsIHsgdXBkYXRlTm90ZXM6IHRydWUgfSkpO1xuXG4gICAgY29uc3QgcmVuYW1lQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1kZXRhaWwtcmVuYW1lXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiVW1iZW5lbm5lblwiIH0gfSk7XG4gICAgc2V0SWNvbihyZW5hbWVCdG4sIFwicGVuY2lsXCIpO1xuICAgIHJlbmFtZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydERldGFpbFJlbmFtZSh0eXBlLCB0aXRsZUVsKSk7XG5cbiAgICBjb25zdCBkZWxldGVCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1kZWxldGVcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJMXHUwMEY2c2NoZW5cIiB9IH0pO1xuICAgIHNldEljb24oZGVsZXRlQnRuLCBcInRyYXNoXCIpO1xuICAgIGRlbGV0ZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zaG93RGVsZXRlQ29uZmlybSh0eXBlKSk7XG5cbiAgICBjb25zdCBib2R5ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtYm9keVwiIH0pO1xuXG4gICAgY29uc3QgZGVzY1NlY3Rpb24gPSBib2R5LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXNjcmlwdGlvbi1zZWN0aW9uXCIgfSk7XG5cbiAgICBjb25zdCBvcHRpb25zSGVhZGVyID0gZGVzY1NlY3Rpb24uY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLWhlYWRlciBmcmVkLXR5cC1vcHRpb25zLWhlYWRlclwiIH0pO1xuICAgIGNvbnN0IG1hbnVhbFRvZ2dsZVdyYXAgPSBvcHRpb25zSGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1tYW51YWwtdG9nZ2xlXCIgfSk7XG4gICAgbWFudWFsVG9nZ2xlV3JhcC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IFwiTWFudWVsbGVyIFRZUFwiIH0pO1xuICAgIHRoaXMucmVuZGVyTWFudWFsVG9nZ2xlKG1hbnVhbFRvZ2dsZVdyYXAsIHR5cGUpO1xuXG4gICAgY29uc3QgY29sb3JSb3cgPSBvcHRpb25zSGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtY29sb3Itcm93XCIgfSk7XG4gICAgdGhpcy5yZW5kZXJDb2xvclBpY2tlcihcbiAgICAgIGNvbG9yUm93LFxuICAgICAgdHlwZSxcbiAgICAgIChuZXdDb2xvcikgPT4ge1xuICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSB0aXRsZUVsLnN0eWxlLmNvbG9yID0gbmV3Q29sb3I7XG4gICAgICB9LFxuICAgICAgeyBzaG93UmVzZXQ6IHRydWUgfVxuICAgICk7XG5cbiAgICBjb25zdCBkZXNjSGVhZGVyID0gZGVzY1NlY3Rpb24uY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLWhlYWRlclwiIH0pO1xuICAgIGRlc2NIZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IFwiQmVzY2hyZWlidW5nXCIgfSk7XG5cbiAgICBjb25zdCBkZXNjSW5wdXQgPSBkZXNjU2VjdGlvbi5jcmVhdGVFbChcInRleHRhcmVhXCIsIHtcbiAgICAgIGNsczogXCJmcmVkLXR5cC1kZXNjcmlwdGlvbi1pbnB1dFwiLFxuICAgICAgYXR0cjogeyByb3dzOiBcIjJcIiB9LFxuICAgIH0pO1xuICAgIGRlc2NJbnB1dC52YWx1ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gPz8gXCJcIjtcbiAgICBkZXNjSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZSA9IGRlc2NJbnB1dC52YWx1ZS50cmltKCk7XG4gICAgICBpZiAodmFsdWUpIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gPSB2YWx1ZTtcbiAgICAgIGVsc2UgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IHNlY3Rpb25IZWFkZXIgPSBib2R5LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci1oZWFkZXJcIiB9KTtcbiAgICBzZWN0aW9uSGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZVwiLCB0ZXh0OiBcIlN0YW5kYXJkLUZyb250bWF0dGVyXCIgfSk7XG5cbiAgICAvLyBCZWlkZSBCdXR0b25zIGhcdTAwRTRuZ2VuIGFuIGRlcnNlbGJlbiBFZGl0b3ItSW5zdGFueiAtIEZsb2F0aW5nIFByb3BlcnRpZXNcbiAgICAvLyAoc2llaGUgdHlwZUZsb2F0aW5nS2V5cyBpbiBzZXR0aW5ncy5qcykgc2luZCBUZWlsIGRlcnNlbGJlbiBMaXN0ZSB1bmRcbiAgICAvLyBSZWloZW5mb2xnZSB3aWUgZGllIFx1MDBGQ2JyaWdlbiBQcm9wZXJ0aWVzIGRpZXNlcyBUeXBzICh3aWNodGlnIGZcdTAwRkNyIGRpZVxuICAgIC8vIEZyb250bWF0dGVyLVNvcnRpZXJ1bmcpLCBsYW5kZW4gYWxzbyBhbiBnZW5hdSBkZXIgU3RlbGxlLCBhbiBkaWUgc2llIHBlclxuICAgIC8vIERyYWcgJiBEcm9wIGVpbnNvcnRpZXJ0IHdlcmRlbiwgc3RhdHQgZmVzdCBhbnMgRW5kZSBlaW5lciB6d2VpdGVuIExpc3RlLlxuICAgIGNvbnN0IGFkZEJ1dHRvbnMgPSBzZWN0aW9uSGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci1hZGQtZ3JvdXBcIiB9KTtcblxuICAgIC8vIExpbmtzIG5lYmVuIGRlbSBub3JtYWxlbiBCdXR0b24sIGhlcnZvcmdlaG9iZW4gKEFremVudGZhcmJlLCB3aWVcbiAgICAvLyByZW5hbWVXaXRoTm90ZXNCdG4gb2JlbikgLSBtYXJraWVydCBkaWUgYWxzIG5cdTAwRTRjaHN0ZXMgaGluenVnZWZcdTAwRkNndGUgKGJ6dy5cbiAgICAvLyBiaXMgenVtIG5cdTAwRTRjaHN0ZW4gU3BlaWNoZXJuIHVtYmVuYW5udGUpIFByb3BlcnR5IGFscyBGbG9hdGluZywgc3RhdHQgc2llXG4gICAgLy8gYWxzIG5vcm1hbGUgU3RhbmRhcmQtUHJvcGVydHkgYW56dWxlZ2VuIChzaWVoZSBlZGl0b3IuZnJlZFBlbmRpbmdGbG9hdGluZ0FkZFxuICAgIC8vIGluIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKS4gRmxvYXRpbmcgUHJvcGVydGllcyB3ZXJkZW4gTklDSFRcbiAgICAvLyBhdXRvbWF0aXNjaCBiZWkgbmV1ZW4gTm90aXplbiBhbmdlbGVndCAoc2llaGUgZ2V0VHlwZURlZmF1bHRzKCkgaW5cbiAgICAvLyBtYWluLmpzKSB1bmQgZG9ydCwgc29iYWxkIGRvY2ggdm9yaGFuZGVuLCBrdXJzaXYgc3RhdHQgZmV0dCBkYXJnZXN0ZWxsdFxuICAgIC8vIChzaWVoZSBmcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodC5qcykuXG4gICAgY29uc3QgYWRkRmxvYXRpbmdQcm9wZXJ0eUJ0biA9IGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1mcm9udG1hdHRlci1hZGQtZmxvYXRpbmdcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiRmxvYXRpbmcgUHJvcGVydHkgaGluenVmXHUwMEZDZ2VuXCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKGFkZEZsb2F0aW5nUHJvcGVydHlCdG4sIFwicGx1c1wiKTtcbiAgICBhZGRGbG9hdGluZ1Byb3BlcnR5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5mcm9udG1hdHRlckVkaXRvcikgdGhpcy5mcm9udG1hdHRlckVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkID0gdHJ1ZTtcbiAgICAgIGFkZEJsYW5rUHJvcGVydHkodGhpcy5mcm9udG1hdHRlckVkaXRvcik7XG4gICAgfSk7XG5cbiAgICBjb25zdCBhZGRQcm9wZXJ0eUJ0biA9IGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1mcm9udG1hdHRlci1hZGRcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUHJvcGVydHkgaGluenVmXHUwMEZDZ2VuXCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKGFkZFByb3BlcnR5QnRuLCBcInBsdXNcIik7XG4gICAgYWRkUHJvcGVydHlCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIGlmICh0aGlzLmZyb250bWF0dGVyRWRpdG9yKSB0aGlzLmZyb250bWF0dGVyRWRpdG9yLmZyZWRQZW5kaW5nRmxvYXRpbmdBZGQgPSBmYWxzZTtcbiAgICAgIGFkZEJsYW5rUHJvcGVydHkodGhpcy5mcm9udG1hdHRlckVkaXRvcik7XG4gICAgfSk7XG5cbiAgICB0aGlzLmZyb250bWF0dGVyRWRpdG9yID0gbW91bnRUeXBlRnJvbnRtYXR0ZXJFZGl0b3IodGhpcywgYm9keSwgdHlwZSk7XG5cbiAgICB0aGlzLnJlbmRlclBsYWNlaG9sZGVyTGlzdChib2R5KTtcbiAgICAvLyBGZXR0LU1hcmtpZXJ1bmcgKHNpZWhlIGZyb250bWF0dGVyLWRlZmF1bHQtaGlnaGxpZ2h0LmpzKSByZWFnaWVydCBudXIgYXVmXG4gICAgLy8gTWV0YWRhdGVuLS9MYXlvdXQtRXZlbnRzIC0gZGFzIFx1MDBENmZmbmVuIGRpZXNlciBEZXRhaWxhbnNpY2h0IHNlbGJzdCBsXHUwMEY2c3RcbiAgICAvLyBrZWlucyBkYXZvbiBhdXMsIGRhaGVyIGhpZXIgZGlyZWt0IG5hY2ggZGVtIE1vdW50ZW4gYW5zdG9cdTAwREZlbi4gQmV3dXNzdFxuICAgIC8vIG51ciBkaWVzZXIgZWluZSwgZ2V6aWVsdGUgUmVmcmVzaCBzdGF0dCBkZXMgdm9sbGVuIHJlZnJlc2hUeXBDb2xvcnMoKS1cbiAgICAvLyBCXHUwMEZDbmRlbHM6IGRhcyB3XHUwMEZDcmRlIHUuIGEuIGF1Y2ggcmVuZGVyKCkgYXVmIGRpZXNlbSAoZ2VyYWRlIGVyc3QgbWl0dGVuXG4gICAgLy8gaW0gZWlnZW5lbiByZW5kZXIoKS1EdXJjaGxhdWYgYmVmaW5kbGljaGVuKSBWaWV3IGVybmV1dCBhdXNsXHUwMEY2c2VuLlxuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodD8uKCk7XG4gIH1cblxuICBzaG93RGVsZXRlQ29uZmlybSh0eXBlKSB7XG4gICAgbmV3IENvbmZpcm1EZWxldGVUeXBlTW9kYWwodGhpcy5wbHVnaW4sIHR5cGUsIGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMuZmlsdGVyKCh0KSA9PiB0ICE9PSB0eXBlKTtcbiAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdO1xuICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XG4gICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXTtcbiAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdO1xuICAgICAgZGVsZXRlIHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3R5cGVdO1xuICAgICAgLy8gVm9yIHJlZnJlc2hUeXBDb2xvcnMoKSB6dXJcdTAwRkNjayB6dXIgTGlzdGUsIGF1cyBkZW1zZWxiZW4gR3J1bmQgd2llIGJlaW1cbiAgICAgIC8vIFVtYmVuZW5uZW46IHJlZnJlc2hUeXBDb2xvcnMoKSByZW5kZXJ0ICh1LiBhLiBcdTAwRkNiZXIgcmVnaXN0ZXJUeXBWaWV3KVxuICAgICAgLy8gc3luY2hyb24gbmV1IC0gc3RcdTAwRkNuZGUgc2VsZWN0ZWRUeXBlIG5vY2ggYXVmIGRlbSBnZXJhZGUgZ2VsXHUwMEY2c2NodGVuXG4gICAgICAvLyBUeXAsIHdcdTAwRkNyZGUgZGVzc2VuIGpldHp0IGRhdGVubG9zZSBEZXRhaWxhbnNpY2h0IGt1cnogZXJuZXV0IGdlcmVuZGVydC5cbiAgICAgIHRoaXMuY2xvc2VUeXBlU2V0dGluZ3MoKTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgfSkub3BlbigpO1xuICB9XG5cbiAgLy8gV2llIHN0YXJ0RWRpdGluZygpLCBhYmVyIGF1ZiBkZW0gZnJlaXN0ZWhlbmRlbiBUaXRlbC1FbGVtZW50IGRlciBEZXRhaWwtQW5zaWNodFxuICAvLyBzdGF0dCBhdWYgZWluZW0gVHJlZS1JdGVtIC0gdW5kIG1pdCByZXN1bHRpZXJlbmRlbSBzZWxlY3RlZFR5cGUtV2VjaHNlbCBzdGF0dFxuICAvLyBlaW5lcyBzY2hsaWNodGVuIFJlLVJlbmRlcnMgZGVyIExpc3RlLiB1cGRhdGVOb3RlczogdHJ1ZSAoendlaXRlciwgaGVydm9yLVxuICAvLyBnZWhvYmVuZXIgQnV0dG9uKSBzY2hyZWlidCBuYWNoIEJlc3RcdTAwRTR0aWd1bmcgenVzXHUwMEU0dHpsaWNoIGRlbiBUWVAtV2VydCBhbGxlclxuICAvLyBiZXRyb2ZmZW5lbiBOb3RpemVuIHVtIChzaWVoZSByZW5hbWVUeXBlSW5Ob3RlcyksIHN0YXR0IG51ciBkaWUgUGx1Z2luLVxuICAvLyBFaW5zdGVsbHVuZ2VuIHp1IG1pZ3JpZXJlbi5cbiAgc3RhcnREZXRhaWxSZW5hbWUodHlwZSwgdGl0bGVFbCwgeyB1cGRhdGVOb3RlcyA9IGZhbHNlIH0gPSB7fSkge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuICAgIHRoaXMuaXNFZGl0aW5nID0gdHJ1ZTtcblxuICAgIHRpdGxlRWwuYWRkQ2xhc3MoXCJpcy1iZWluZy1yZW5hbWVkXCIpO1xuICAgIHRpdGxlRWwuc2V0QXR0cmlidXRlKFwiY29udGVudGVkaXRhYmxlXCIsIFwidHJ1ZVwiKTtcbiAgICB0aXRsZUVsLnNldEF0dHJpYnV0ZShcInNwZWxsY2hlY2tcIiwgXCJmYWxzZVwiKTtcbiAgICB0aXRsZUVsLmZvY3VzKCk7XG5cbiAgICBjb25zdCByYW5nZSA9IHRpdGxlRWwuZG9jLmNyZWF0ZVJhbmdlKCk7XG4gICAgcmFuZ2Uuc2VsZWN0Tm9kZUNvbnRlbnRzKHRpdGxlRWwpO1xuICAgIGNvbnN0IHNlbGVjdGlvbiA9IHRpdGxlRWwud2luLmdldFNlbGVjdGlvbigpO1xuICAgIHNlbGVjdGlvbi5yZW1vdmVBbGxSYW5nZXMoKTtcbiAgICBzZWxlY3Rpb24uYWRkUmFuZ2UocmFuZ2UpO1xuXG4gICAgLy8gTWlncmllcnQgbnVyIGRpZSBQbHVnaW4tRWluc3RlbGx1bmdlbiAoTGlzdGUsIEZhcmJlLCBCZXNjaHJlaWJ1bmcsXG4gICAgLy8gU3RhbmRhcmQtRnJvbnRtYXR0ZXIsIE1hbnVlbGxlci1UWVAtU2NoYWx0ZXIpIGF1ZiBkZW4gbmV1ZW4gTmFtZW4gLVxuICAgIC8vIHJcdTAwRkNocnQga2VpbmUgTm90aXplbiBhbi4gR2VtZWluc2FtIGdlbnV0enQgdm9uIGJlaWRlbiBVbWJlbmVubmVuLVBmYWRlbi5cbiAgICBjb25zdCBhcHBseVJlbmFtZSA9IGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgY29uc3QgaWR4ID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMuaW5kZXhPZih0eXBlKTtcbiAgICAgIGlmIChpZHggIT09IC0xKSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlc1tpZHhdID0gdmFsdWU7XG4gICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXTtcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV07XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXTtcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXTtcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV07XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXTtcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV07XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5lbnN1cmVUeXBlTWFudWFsKClbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVNYW51YWxbdHlwZV07XG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsW3R5cGVdO1xuICAgICAgfVxuICAgICAgLy8gVm9yIHJlZnJlc2hUeXBDb2xvcnMoKSBzZXR6ZW46IGRhcyBydWZ0ICh1LiBhLiBcdTAwRkNiZXIgZGVuIGluXG4gICAgICAvLyByZWdpc3RlclR5cFZpZXcgenVyXHUwMEZDY2tnZWdlYmVuZW4gUmVmcmVzaCkgc3luY2hyb24gcmVuZGVyKCkgYXVmIC1cbiAgICAgIC8vIHN0XHUwMEZDbmRlIHNlbGVjdGVkVHlwZSBub2NoIGF1ZiBkZW0gYWx0ZW4gKGJlcmVpdHMgbWlncmllcnRlbixcbiAgICAgIC8vIGRhaGVyIGpldHp0IGRhdGVuLWxvc2VuKSBOYW1lbiwgd1x1MDBGQ3JkZSBrdXJ6emVpdGlnIGdlbmF1IGRlciBBbHQtXG4gICAgICAvLyBOYW1lIG1pdCBsZWVyZW4gRGF0ZW4gZ2VyZW5kZXJ0LlxuICAgICAgdGhpcy5zZWxlY3RlZFR5cGUgPSB2YWx1ZTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgfTtcblxuICAgIGxldCBkb25lID0gZmFsc2U7XG4gICAgY29uc3QgZmluaXNoID0gYXN5bmMgKGNvbW1pdCkgPT4ge1xuICAgICAgaWYgKGRvbmUpIHJldHVybjtcbiAgICAgIGRvbmUgPSB0cnVlO1xuICAgICAgdGhpcy5pc0VkaXRpbmcgPSBmYWxzZTtcblxuICAgICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVUeXBlTmFtZSh0aXRsZUVsLnRleHRDb250ZW50KTtcbiAgICAgIGlmICghY29tbWl0IHx8ICF2YWx1ZSB8fCB2YWx1ZSA9PT0gdHlwZSkge1xuICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMuZmluZChcbiAgICAgICAgKHQpID0+IHQudG9Mb3dlckNhc2UoKSA9PT0gdmFsdWUudG9Mb3dlckNhc2UoKSAmJiB0ICE9PSB0eXBlXG4gICAgICApO1xuICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgIHRoaXMuc2hvd01lcmdlQ29uZmlybSh0eXBlLCBleGlzdGluZyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKCF1cGRhdGVOb3Rlcykge1xuICAgICAgICBhd2FpdCBhcHBseVJlbmFtZSh2YWx1ZSk7XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgLy8gQnVsay1TY2hyZWlidm9yZ2FuZyBcdTAwRkNiZXIgcG90ZW56aWVsbCB2aWVsZSBEYXRlaWVuIC0gdm9yaGVyIGJlc3RcdTAwRTR0aWdlblxuICAgICAgLy8gbGFzc2VuLCBzdGF0dCBzb2ZvcnQgenUgc3BlaWNoZXJuLlxuICAgICAgY29uc3QgeyBjb3VudHMgfSA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnR5cGVDb3VudHMoKTtcbiAgICAgIG5ldyBDb25maXJtUmVuYW1lVHlwZU1vZGFsKFxuICAgICAgICB0aGlzLnBsdWdpbixcbiAgICAgICAgdHlwZSxcbiAgICAgICAgdmFsdWUsXG4gICAgICAgIGNvdW50cy5nZXQodHlwZSkgPz8gMCxcbiAgICAgICAgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IGFwcGx5UmVuYW1lKHZhbHVlKTtcbiAgICAgICAgICBjb25zdCByZW5hbWVkID0gYXdhaXQgcmVuYW1lVHlwZUluTm90ZXModGhpcy5wbHVnaW4sIHR5cGUsIHZhbHVlKTtcbiAgICAgICAgICBuZXcgTm90aWNlKGBUWVAgJHt2YWx1ZX06ICR7cmVuYW1lZH0gTm90aXooZW4pIGFuZ2VwYXNzdC5gKTtcbiAgICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgICB9LFxuICAgICAgICAoKSA9PiB0aGlzLnJlbmRlcigpXG4gICAgICApLm9wZW4oKTtcbiAgICB9O1xuXG4gICAgdGl0bGVFbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIikge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgZmluaXNoKHRydWUpO1xuICAgICAgfSBlbHNlIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIpIHtcbiAgICAgICAgLy8gc3RvcFByb3BhZ2F0aW9uLCBzb25zdCBncmVpZnQgenVzXHUwMEU0dHpsaWNoIGRlciBFc2NhcGUtSGFuZGxlciBkZXJcbiAgICAgICAgLy8gZ2VzYW10ZW4gRGV0YWlsLUFuc2ljaHQgdW5kIHZlcmxcdTAwRTRzc3Qgc2llIGdsZWljaCBtaXQuXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICBmaW5pc2goZmFsc2UpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgdGl0bGVFbC5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCAoKSA9PiBmaW5pc2godHJ1ZSkpO1xuICB9XG5cbiAgc2hvd01lcmdlQ29uZmlybShzb3VyY2UsIHRhcmdldCkge1xuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBlQ291bnRzKCk7XG4gICAgbmV3IENvbmZpcm1NZXJnZVR5cGVNb2RhbChcbiAgICAgIHRoaXMucGx1Z2luLFxuICAgICAgc291cmNlLFxuICAgICAgdGFyZ2V0LFxuICAgICAgY291bnRzLmdldChzb3VyY2UpID8/IDAsXG4gICAgICAoKSA9PiB0aGlzLm1lcmdlVHlwZShzb3VyY2UsIHRhcmdldCksXG4gICAgICAoKSA9PiB0aGlzLnJlbmRlcigpXG4gICAgKS5vcGVuKCk7XG4gIH1cblxuICAvLyBMZWd0IHNvdXJjZSBpbiB0YXJnZXQgYXVmOiBOb3RpemVuIHdlcmRlbiBhdWYgdGFyZ2V0IHVtZ2VzY2hyaWViZW4sXG4gIC8vIHNvdXJjZSB2ZXJzY2h3aW5kZXQgYXVzIGRlciBUWVAtTGlzdGUgc2FtdCBlaWdlbmVyIEVpbnN0ZWxsdW5nZW4gKHRhcmdldFxuICAvLyBiZWhcdTAwRTRsdCBzZWluZSkuXG4gIGFzeW5jIG1lcmdlVHlwZShzb3VyY2UsIHRhcmdldCkge1xuICAgIGNvbnN0IHNldHRpbmdzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3M7XG4gICAgY29uc3QgcmVuYW1lZCA9IGF3YWl0IHJlbmFtZVR5cGVJbk5vdGVzKHRoaXMucGx1Z2luLCBzb3VyY2UsIHRhcmdldCk7XG5cbiAgICBzZXR0aW5ncy50eXBlcyA9IHNldHRpbmdzLnR5cGVzLmZpbHRlcigodCkgPT4gdCAhPT0gc291cmNlKTtcbiAgICBkZWxldGUgc2V0dGluZ3MudHlwZUNvbG9yc1tzb3VyY2VdO1xuICAgIGRlbGV0ZSBzZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3NvdXJjZV07XG4gICAgZGVsZXRlIHNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbc291cmNlXTtcbiAgICBkZWxldGUgc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1tzb3VyY2VdO1xuICAgIGRlbGV0ZSB0aGlzLmVuc3VyZVR5cGVNYW51YWwoKVtzb3VyY2VdO1xuXG4gICAgLy8gVm9yIHJlZnJlc2hUeXBDb2xvcnMoKSBzZXR6ZW4sIGF1cyBkZW1zZWxiZW4gR3J1bmQgd2llIGluIGFwcGx5UmVuYW1lLlxuICAgIHRoaXMuc2VsZWN0ZWRUeXBlID0gdGFyZ2V0O1xuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgIG5ldyBOb3RpY2UoYFRZUCAke3NvdXJjZX0gbWl0ICR7dGFyZ2V0fSB6dXNhbW1lbmdlbGVndCwgJHtyZW5hbWVkfSBOb3RpeihlbikgYW5nZXBhc3N0LmApO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICByZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KSB7XG4gICAgY29uc3QgZmxhaXJPdXRlciA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1mbGFpci1vdXRlclwiIH0pO1xuICAgIGZsYWlyT3V0ZXIuY3JlYXRlU3Bhbih7IGNsczogXCJ0cmVlLWl0ZW0tZmxhaXJcIiwgdGV4dDogU3RyaW5nKGNvdW50KSB9KTtcbiAgfVxuXG4gIC8vIFJlaW4gaW5mb3JtYXRpdiwgdW50ZXIgZGVtIFN0YW5kYXJkLUZyb250bWF0dGVyLUVkaXRvcjogZGVyIEhpbndlaXN0ZXh0XG4gIC8vIGVya2xcdTAwRTRydCBkZW4gRmxvYXRpbmctUHJvcGVydHktVG9nZ2xlIChSZWNodHNrbGljayBhdWYgZWluZSBQcm9wZXJ0eSBvYmVuLFxuICAvLyBzaWVoZSBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCBpbiB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcyksIGRpZSBMaXN0ZVxuICAvLyBkYXJ1bnRlciBkaWUgUGxhdHpoYWx0ZXIsIGRpZSBhbHMgV2VydCBlaW5lciBQcm9wZXJ0eSBlaW5nZXRyYWdlbiB3ZXJkZW5cbiAgLy8ga1x1MDBGNm5uZW4gKHouIEIuIGJlaSBcIkRhdHVtXCIgZGVyIFRleHQgXCJ7e3RvZGF5fX1cIikgLSBnZXRUeXBlRGVmYXVsdHMoKVxuICAvLyAobWFpbi5qcykgbFx1MDBGNnN0IHNpZSBiZWkgamVkZW0gQWJydWYgZnJpc2NoIGF1Ziwgc2llaGVcbiAgLy8gZnJvbnRtYXR0ZXItcGxhY2Vob2xkZXJzLmpzLiBCZXd1c3N0IG9obmUgZWlnZW5lIFx1MDBEQ2JlcnNjaHJpZnQsIGRhIGRpcmVrdFxuICAvLyB1bnRlciBkZXIgUHJvcGVydHktTGlzdGUgb2huZWhpbiBrbGFyIGlzdCwgd29yYXVmIHNpY2ggYmVpZGVzIGJlemllaHQuXG4gIHJlbmRlclBsYWNlaG9sZGVyTGlzdChwYXJlbnQpIHtcbiAgICBjb25zdCBzZWN0aW9uID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1wbGFjZWhvbGRlci1zZWN0aW9uXCIgfSk7XG4gICAgY29uc3QgbGlzdCA9IHNlY3Rpb24uY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXBsYWNlaG9sZGVyLWxpc3RcIiB9KTtcbiAgICBmb3IgKGNvbnN0IHsgdG9rZW4sIGRlc2NyaXB0aW9uIH0gb2YgWy4uLkZST05UTUFUVEVSX1BMQUNFSE9MREVSUywgRFlOQU1JQ19QTEFDRUhPTERFUl9JTkZPXSkge1xuICAgICAgY29uc3Qgcm93ID0gbGlzdC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtcGxhY2Vob2xkZXItcm93XCIgfSk7XG4gICAgICByb3cuY3JlYXRlRWwoXCJjb2RlXCIsIHsgY2xzOiBcImZyZWQtdHlwLXBsYWNlaG9sZGVyLXRva2VuXCIsIHRleHQ6IHRva2VuIH0pO1xuICAgICAgcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGxhY2Vob2xkZXItZGVzY1wiLCB0ZXh0OiBkZXNjcmlwdGlvbiB9KTtcbiAgICB9XG4gICAgc2VjdGlvbi5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZyZWQtdHlwLXBsYWNlaG9sZGVyLWhpbnRcIixcbiAgICAgIHRleHQ6IFwiWW91IGNhbiBjaGFuZ2UgYSBwcm9wZXJ0eSB0byBmbG9hdGluZyBpbiB0aGUgcmlnaHQtY2xpY2sgbWVudS5cIixcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlclR5cFZpZXcocGx1Z2luKSB7XG4gIHBsdWdpbi5yZWdpc3RlclZpZXcoVklFV19UWVBFX1RZUCwgKGxlYWYpID0+IG5ldyBUeXBWaWV3KGxlYWYsIHBsdWdpbikpO1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJ0eXAtdmlldy1vZWZmbmVuXCIsXG4gICAgbmFtZTogXCJUWVAgLSBUWVAtVmlldyBcdTAwRjZmZm5lblwiLFxuICAgIGNhbGxiYWNrOiAoKSA9PiBhY3RpdmF0ZVR5cFZpZXcocGx1Z2luKSxcbiAgfSk7XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcInR5cC1wcm9wZXJ0eS1oaW56dWZ1ZWdlblwiLFxuICAgIG5hbWU6IFwiVFlQIC0gU3RhbmRhcmQtUHJvcGVydHkgaGluenVmXHUwMEZDZ2VuXCIsXG4gICAgY2FsbGJhY2s6ICgpID0+IGFkZFR5cFByb3BlcnR5Q29tbWFuZChwbHVnaW4pLFxuICB9KTtcblxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwidHlwLWhpbnp1ZnVlZ2VuXCIsXG4gICAgbmFtZTogXCJUWVAgLSBOZXVlbiBUWVAgaGluenVmXHUwMEZDZ2VuXCIsXG4gICAgY2FsbGJhY2s6ICgpID0+IGFkZFR5cENvbW1hbmQocGx1Z2luKSxcbiAgfSk7XG5cbiAgLy8gQmVpbSBIb3QtUmVsb2FkIGJsZWlidCBkZXIgYWx0ZSBMZWFmIGFscyBPYmpla3QgdW5hbmdldGFzdGV0IGJlc3RlaGVuIChudXJcbiAgLy8gdW5zZXIgUGx1Z2luLU1vZHVsIHdpcmQgbmV1IGdlbGFkZW4pLCBhYmVyIFwiaW5zdGFuY2VvZiBUeXBWaWV3XCIgc2NobFx1MDBFNGd0IGdlZ2VuXG4gIC8vIGRpZSBuZXUgZ2VsYWRlbmUgS2xhc3NlIGZlaGwuIGFwcC5qcyBzZWxic3QgYmVzdGltbXQgZ2V0Vmlld1R5cGUoKSByZWluIGF1c1xuICAvLyBsZWFmLnZpZXcgLSBkYXMgcmVpY2h0IHp1ciBFcmtlbm51bmcgYWxzbyBuaWNodC4gYXBwIHNlbGJzdCBcdTAwRkNiZXJsZWJ0IGRlblxuICAvLyBIb3QtUmVsb2FkIGRhZ2VnZW4gdW52ZXJcdTAwRTRuZGVydCwgZGFoZXIgZGllIExlYWYtUmVmZXJlbnogZGlyZWt0IGRvcnQgYWJsZWdlbi5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiBhY3RpdmF0ZVR5cFZpZXcocGx1Z2luLCBmYWxzZSwgZmFsc2UpKTtcblxuICBjb25zdCByZWZyZXNoID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFX1RZUCkpIHtcbiAgICAgIGxlYWYudmlldz8ucmVuZGVyPy4oKTtcbiAgICB9XG4gIH07XG5cbiAgLy8gWlx1MDBFNGhsZXIgKExpc3RlIHVuZCBQaWNrZXIsIHNpZWhlIHR5cEluZGV4LnR5cGVDb3VudHMoKSkgc29uc3QgbnVyIHNvIGFrdHVlbGxcbiAgLy8gd2llIGJlaW0gbGV0enRlbiBSZW5kZXIgZGllc2VyIFZpZXcgLSBqZWRlIFRZUC1yZWxldmFudGUgXHUwMEM0bmRlcnVuZyBhbmRlcnN3b1xuICAvLyAobmV1ZS9nZWxcdTAwRjZzY2h0ZSBOb3RpeiwgVFlQIG9kZXIgU1VCVFlQIHVtZ2V0cmFnZW4pIGxpZVx1MDBERmUgc2llIHNvbnN0IHZlcmFsdGVuLFxuICAvLyBiaXMgaXJnZW5kZWluIGFuZGVyZXIgR3J1bmQgKHouIEIuIGVpbmUgRWluc3RlbGx1bmcpIHp1Zlx1MDBFNGxsaWcgZWluZW4gUmVmcmVzaFxuICAvLyBhdXNsXHUwMEY2c3QuIERhcyBcImNoYW5nZVwiLUV2ZW50IGRlcyBJbmRleCBmZXVlcnQgbnVyIGJlaSBnZW5hdSBzb2xjaGVuXG4gIC8vIFx1MDBDNG5kZXJ1bmdlbiwgbmljaHQgYmVpIGplZGVtIEF1dG9zYXZlLVRpY2suIFRyb3R6ZGVtIGRlYm91bmNlZCwgZGEgZGFzXG4gIC8vIFJlbmRlcm4gZGVyIExpc3RlIHZlcmdsZWljaHN3ZWlzZSB0ZXVlciBpc3QgLSByZXNldFRpbWVyOnRydWUgc2FtbWVsdCBlaW5lXG4gIC8vIFx1MDBDNG5kZXJ1bmdzc2VyaWUgKHouIEIuIEJ1bGstSW1wb3J0KSB6dSBlaW5lbSBlaW56aWdlbiBSZWZyZXNoLlxuICBjb25zdCBkZWJvdW5jZWRSZWZyZXNoID0gZGVib3VuY2UocmVmcmVzaCwgNTAwLCB0cnVlKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIGRlYm91bmNlZFJlZnJlc2gpKTtcbiAgLy8gXHUwMEM0bmRlcnQgZGllIFwiRXhjbHVkZWQgZmlsZXNcIi1MaXN0ZSBzZWxic3QgKHouIEIuIEhpZGUgRm9sZGVycyBiZWltIEF1cy0vXG4gIC8vIEVpbmJsZW5kZW4gZWluZXMgT3JkbmVycykgLSBPYnNpZGlhbnMgZWlnZW5lciBNZXRhZGF0YUNhY2hlIGxhdXNjaHQgaW50ZXJuXG4gIC8vIGViZW5mYWxscyBnZW5hdSBhdWYgZGllc2VzIEV2ZW50LCB1bSBzZWluZSBJZ25vcmUtRmlsdGVyIG5ldSB6dSBsYWRlbi5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC52YXVsdC5vbihcImNvbmZpZy1jaGFuZ2VkXCIsIGRlYm91bmNlZFJlZnJlc2gpKTtcblxuICAvLyBGXHUwMEZDciBwbHVnaW4ucmVmcmVzaFR5cENvbG9ycyAoei4gQi4gbmFjaCBVbXNjaGFsdGVuIGRlciBcIlRZUC1MaXN0ZVxuICAvLyBlaW5mXHUwMEU0cmJlblwiLUVpbnN0ZWxsdW5nKSAtIHJlbmRlcnQgZGllIExpc3RlIChiencuIGJsZWlidCBpbiBkZXJcbiAgLy8gRGV0YWlsYW5zaWNodCwgcmVuZGVyKCkgYnJhbmNoJ3Qgc2VsYnN0KSBuZXUuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG4vLyBjcmVhdGVJZk1pc3Npbmc6IGZhbHNlIGJlaW0gYXV0b21hdGlzY2hlbiBvbkxheW91dFJlYWR5LUF1ZnJ1ZiAoc2llaGVcbi8vIHJlZ2lzdGVyVHlwVmlldykgLSBkZXIgc29sbCBhdXNzY2hsaWVcdTAwREZsaWNoIGVpbmVuIGJlaW0gSG90LVJlbG9hZCB2ZXJ3YWlzdGVuLFxuLy8gYWJlciBiZXJlaXRzIHZvcmhhbmRlbmVuIExlYWYgd2llZGVydmVyYmluZGVuIChzaWVoZSBLb21tZW50YXIgZG9ydCksIG5pY2h0XG4vLyBiZWkgamVkZW0gcmVndWxcdTAwRTRyZW4gT2JzaWRpYW4tU3RhcnQgdW5jb25kaXRpb25hbCBlaW5lbiBuZXVlbiBMZWFmIGVyemV1Z2VuXG4vLyB1bmQgYWt0aXZpZXJlbi4gV2FyIGRpZSBUWVAtUGFuZSBiZWltIGxldHp0ZW4gQmVlbmRlbiBnZXNjaGxvc3NlbiAob2RlclxuLy8gZWluZW0gZnJpc2NoZW4gVmF1bHQpLCBibGVpYnQgc2llIG9obmUgZGllc2UgVW50ZXJzY2hlaWR1bmcgc29uc3QgYXVjaCB6dS5cbmFzeW5jIGZ1bmN0aW9uIGFjdGl2YXRlVHlwVmlldyhwbHVnaW4sIHJldmVhbCA9IHRydWUsIGNyZWF0ZUlmTWlzc2luZyA9IHRydWUpIHtcbiAgY29uc3QgYXBwID0gcGx1Z2luLmFwcDtcbiAgY29uc3QgeyB3b3Jrc3BhY2UgfSA9IGFwcDtcblxuICBjb25zdCBjYW5kaWRhdGVzID0gW107XG4gIHdvcmtzcGFjZS5pdGVyYXRlQWxsTGVhdmVzKChsZWFmKSA9PiB7XG4gICAgaWYgKGxlYWYgPT09IGFwcC5fX2ZyZWRUeXBMZWFmIHx8IChsZWFmLnZpZXcgJiYgbGVhZi52aWV3LmdldFZpZXdUeXBlKCkgPT09IFZJRVdfVFlQRV9UWVApKSB7XG4gICAgICBjYW5kaWRhdGVzLnB1c2gobGVhZik7XG4gICAgfVxuICB9KTtcblxuICBsZXQgbGVhZiA9IGNhbmRpZGF0ZXMuc2hpZnQoKSA/PyBudWxsO1xuICBmb3IgKGNvbnN0IGV4dHJhIG9mIGNhbmRpZGF0ZXMpIGV4dHJhLmRldGFjaCgpO1xuXG4gIGlmICghbGVhZikge1xuICAgIGlmICghY3JlYXRlSWZNaXNzaW5nKSByZXR1cm47XG4gICAgbGVhZiA9IHdvcmtzcGFjZS5nZXRMZWZ0TGVhZihmYWxzZSk7XG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoeyB0eXBlOiBWSUVXX1RZUEVfVFlQLCBhY3RpdmU6IHRydWUgfSk7XG4gIH0gZWxzZSBpZiAoIShsZWFmLnZpZXcgaW5zdGFuY2VvZiBUeXBWaWV3KSkge1xuICAgIC8vIGFjdGl2ZTogZmFsc2UgLSByZWluZXMgV2llZGVydmVyYmluZGVuIG5hY2ggSG90LVJlbG9hZCAoc2llaGUgS29tbWVudGFyXG4gICAgLy8gb2JlbiBhbiBhY3RpdmF0ZVR5cFZpZXcpLCBkZXIgTGVhZiBpc3QgamEgYmVyZWl0cyB2b3JoYW5kZW4vc2ljaHRiYXIuXG4gICAgLy8gTWl0IGFjdGl2ZTogdHJ1ZSB3XHUwMEZDcmRlIGplZGVyIFBsdWdpbi1SZWxvYWQgKG5pY2h0IG51ciBlaW4gQXBwLU5ldXN0YXJ0KVxuICAgIC8vIGRlbiBnbG9iYWxlbiBGb2t1cyBhdWYgZGllIFRZUC1QYW5lIHJlaVx1MDBERmVuIC0gb25MYXlvdXRSZWFkeSgpIGZldWVydFxuICAgIC8vIHNlaW5lbiBDYWxsYmFjayBzb2ZvcnQsIHNvYmFsZCB3b3Jrc3BhY2UubGF5b3V0UmVhZHkgZWlubWFsIHRydWUgaXN0LFxuICAgIC8vIGFsc28gYmVpIGplZGVtIGVpbnplbG5lbiBIb3QtUmVsb2FkIHdcdTAwRTRocmVuZCBkZXIgRW50d2lja2x1bmcgZXJuZXV0LlxuICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHsgdHlwZTogVklFV19UWVBFX1RZUCwgYWN0aXZlOiBmYWxzZSB9KTtcbiAgfVxuXG4gIGFwcC5fX2ZyZWRUeXBMZWFmID0gbGVhZjtcbiAgaWYgKHJldmVhbCkgd29ya3NwYWNlLnJldmVhbExlYWYobGVhZik7XG59XG5cbi8vIFZvcnJhbmdpZyBpbiBkZXIgYmVyZWl0cyBvZmZlbmVuIFRZUC1EZXRhaWxhbnNpY2h0IChkYW5uIGV4YWt0IHdpZSBkZXJcbi8vIGRvcnRpZ2UgKy1CdXR0b24pLCBzb25zdCB3aXJkIGRpZSBEZXRhaWxhbnNpY2h0IGZcdTAwRkNyIGRlbiBUWVAgZGVyIGFrdGl2ZW5cbi8vIE5vdGl6IGdlXHUwMEY2ZmZuZXQgdW5kIGRpZSBQcm9wZXJ0eSBkb3J0IGVyZ1x1MDBFNG56dC4gSXN0IG51ciBkaWUgVFlQZW4tTGlzdGVcbi8vIG9mZmVuIChrZWluIHNlbGVjdGVkVHlwZSksIHpcdTAwRTRobHQgZGFzIG5pY2h0IGFscyBcImFrdGl2ZSBEZXRhaWxhbnNpY2h0XCIgLVxuLy8gZGFmXHUwMEZDciBmZWhsdCBkb3J0IGVpbiBGcm9udG1hdHRlci1FZGl0b3IsIGFuIGRlbSBzaWNoIGV0d2FzIGhpbnp1Zlx1MDBGQ2dlbiBsaWVcdTAwREZlLlxuYXN5bmMgZnVuY3Rpb24gYWRkVHlwUHJvcGVydHlDb21tYW5kKHBsdWdpbikge1xuICBjb25zdCBhcHAgPSBwbHVnaW4uYXBwO1xuXG4gIGNvbnN0IGFjdGl2ZVR5cFZpZXcgPSBhcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoVHlwVmlldyk7XG4gIGlmIChhY3RpdmVUeXBWaWV3ICYmIGFjdGl2ZVR5cFZpZXcuc2VsZWN0ZWRUeXBlICE9PSBudWxsKSB7XG4gICAgYWRkQmxhbmtQcm9wZXJ0eShhY3RpdmVUeXBWaWV3LmZyb250bWF0dGVyRWRpdG9yKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBmaWxlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gIGNvbnN0IHR5cGUgPSBwbHVnaW4udHlwSW5kZXgudHlwZU9mKGZpbGUpO1xuICBpZiAoIXR5cGUpIHtcbiAgICBuZXcgTm90aWNlKFwiQWt0aXZlIE5vdGl6IGhhdCBrZWluZW4gVFlQLlwiKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBhd2FpdCBhY3RpdmF0ZVR5cFZpZXcocGx1Z2luKTtcbiAgY29uc3QgdmlldyA9IGFwcC5fX2ZyZWRUeXBMZWFmPy52aWV3O1xuICBpZiAoISh2aWV3IGluc3RhbmNlb2YgVHlwVmlldykpIHJldHVybjtcbiAgdmlldy5vcGVuVHlwZVNldHRpbmdzKHR5cGUpO1xuICBhZGRCbGFua1Byb3BlcnR5KHZpZXcuZnJvbnRtYXR0ZXJFZGl0b3IpO1xufVxuXG4vLyBcdTAwRDZmZm5ldCBiZWkgQmVkYXJmIGVyc3QgZGllIFRZUC1WaWV3IChiencuIHZlcmxcdTAwRTRzc3QgZWluZSBvZmZlbmUgRGV0YWlsYW5zaWNodFxuLy8genVyXHUwMEZDY2sgenVyIExpc3RlIC0gc3RhcnRBZGQoKSBsZWd0IGRhcyBuZXVlIFRyZWUtSXRlbSBpbiB0aGlzLmxpc3RFbCBhbiwgZGFzXG4vLyBlcyBudXIgaW4gZGVyIExpc3RlbmFuc2ljaHQgZ2lidCksIHVuZCBzdFx1MDBGNlx1MDBERnQgZG9ydCBkZW5zZWxiZW4gQWJsYXVmIHdpZSBkZXJcbi8vICstQnV0dG9uIGltIExpc3Rlbi1IZWFkZXIgYW4uXG5hc3luYyBmdW5jdGlvbiBhZGRUeXBDb21tYW5kKHBsdWdpbikge1xuICBhd2FpdCBhY3RpdmF0ZVR5cFZpZXcocGx1Z2luKTtcbiAgY29uc3QgdmlldyA9IHBsdWdpbi5hcHAuX19mcmVkVHlwTGVhZj8udmlldztcbiAgaWYgKCEodmlldyBpbnN0YW5jZW9mIFR5cFZpZXcpKSByZXR1cm47XG4gIGlmICh2aWV3LnNlbGVjdGVkVHlwZSAhPT0gbnVsbCkgdmlldy5jbG9zZVR5cGVTZXR0aW5ncygpO1xuICB2aWV3LnN0YXJ0QWRkKCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclR5cFZpZXcsIFZJRVdfVFlQRV9UWVAsIGNvbXBhcmVUeXBlcywgc29ydFR5cGVzQnlNb2RlLCBERUZBVUxUX1NPUlRfT1JERVIsIERFRkFVTFRfVFlQRV9DT0xPUiB9O1xuIiwgImZ1bmN0aW9uIGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUpIHtcbiAgY29uc3QgdHlwZSA9IHBsdWdpbi50eXBJbmRleC50eXBlT2YoZmlsZSk7XG4gIHJldHVybiB0eXBlID8gcGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gPz8gbnVsbCA6IG51bGw7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBjb2xvckZvckZpbGUgfTtcbiIsICJjb25zdCB7IFRGaWxlLCBURm9sZGVyIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XG5cbmNvbnN0IEZJTEVfRVhQTE9SRVJfVklFV19UWVBFID0gXCJmaWxlLWV4cGxvcmVyXCI7XG5jb25zdCBGT0xERVJfTk9URVNfUExVR0lOX0lEID0gXCJmb2xkZXItbm90ZXNcIjtcblxuLy8gRGFzIFwiRm9sZGVyIE5vdGVzXCItUGx1Z2luIHplaWd0IGVpbmUgTm90aXogc3RhdHQgYWxzIGVpZ2VuZSBaZWlsZSBhbHMgT3JkbmVyIGFuLlxuLy8gRXMgaGF0IGtlaW5lIFx1MDBGNmZmZW50bGljaGUgQVBJIGRhZlx1MDBGQ3IsIGRhaGVyIGRlbiBEYXRlaW5hbWVuIGF1cyBzZWluZW4gZWlnZW5lblxuLy8gKExpdmUtKUVpbnN0ZWxsdW5nZW4gbmFjaGJhdWVuLCBzdGF0dCBzZWluZSBpbnRlcm5lbiBGdW5rdGlvbmVuIGFuenV6YXBmZW4uXG5mdW5jdGlvbiBnZXRGb2xkZXJOb3RlRmlsZShwbHVnaW4sIGZvbGRlcikge1xuICBjb25zdCBmb2xkZXJOb3RlcyA9IHBsdWdpbi5hcHAucGx1Z2lucy5wbHVnaW5zW0ZPTERFUl9OT1RFU19QTFVHSU5fSURdO1xuICBjb25zdCBzZXR0aW5ncyA9IGZvbGRlck5vdGVzPy5zZXR0aW5ncztcbiAgaWYgKCFzZXR0aW5ncykgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgZmlsZU5hbWUgPVxuICAgIChzZXR0aW5ncy5mb2xkZXJOb3RlTmFtZSB8fCBcInt7Zm9sZGVyX25hbWV9fVwiKS5yZXBsYWNlKFwie3tmb2xkZXJfbmFtZX19XCIsIGZvbGRlci5uYW1lKSArXG4gICAgKHNldHRpbmdzLmZvbGRlck5vdGVUeXBlIHx8IFwiLm1kXCIpO1xuICBjb25zdCBkaXJQYXRoID0gc2V0dGluZ3Muc3RvcmFnZUxvY2F0aW9uID09PSBcInBhcmVudEZvbGRlclwiID8gZm9sZGVyLnBhcmVudD8ucGF0aCA/PyBcIlwiIDogZm9sZGVyLnBhdGg7XG4gIGNvbnN0IHBhdGggPSBkaXJQYXRoID8gYCR7ZGlyUGF0aH0vJHtmaWxlTmFtZX1gIDogZmlsZU5hbWU7XG5cbiAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHBhdGgpO1xuICByZXR1cm4gZmlsZSBpbnN0YW5jZW9mIFRGaWxlID8gZmlsZSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGFwcGx5Q29sb3JUb1RpdGxlKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSkge1xuICBjb25zdCBjb250ZW50RWwgPSB0aXRsZUVsLnF1ZXJ5U2VsZWN0b3IoXCIubmF2LWZpbGUtdGl0bGUtY29udGVudCwgLm5hdi1mb2xkZXItdGl0bGUtY29udGVudFwiKTtcbiAgaWYgKCFjb250ZW50RWwpIHJldHVybjtcblxuICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmZpbGVFeHBsb3JlciA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUpIDogbnVsbDtcbiAgaWYgKGNvbG9yKSBjb250ZW50RWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgZWxzZSBjb250ZW50RWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbn1cblxuZnVuY3Rpb24gYXBwbHlGaWxlRXhwbG9yZXJDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoRklMRV9FWFBMT1JFUl9WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgZmlsZVRpdGxlRWxzID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIubmF2LWZpbGUtdGl0bGVbZGF0YS1wYXRoXVwiKTtcbiAgICBmb3IgKGNvbnN0IHRpdGxlRWwgb2YgZmlsZVRpdGxlRWxzKSB7XG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgodGl0bGVFbC5nZXRBdHRyaWJ1dGUoXCJkYXRhLXBhdGhcIikpO1xuICAgICAgYXBwbHlDb2xvclRvVGl0bGUocGx1Z2luLCB0aXRsZUVsLCBmaWxlIGluc3RhbmNlb2YgVEZpbGUgPyBmaWxlIDogbnVsbCk7XG4gICAgfVxuXG4gICAgY29uc3QgZm9sZGVyVGl0bGVFbHMgPSBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChcIi5uYXYtZm9sZGVyLXRpdGxlW2RhdGEtcGF0aF1cIik7XG4gICAgZm9yIChjb25zdCB0aXRsZUVsIG9mIGZvbGRlclRpdGxlRWxzKSB7XG4gICAgICBjb25zdCBmb2xkZXIgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aCh0aXRsZUVsLmdldEF0dHJpYnV0ZShcImRhdGEtcGF0aFwiKSk7XG4gICAgICBjb25zdCBub3RlRmlsZSA9IGZvbGRlciBpbnN0YW5jZW9mIFRGb2xkZXIgPyBnZXRGb2xkZXJOb3RlRmlsZShwbHVnaW4sIGZvbGRlcikgOiBudWxsO1xuICAgICAgYXBwbHlDb2xvclRvVGl0bGUocGx1Z2luLCB0aXRsZUVsLCBub3RlRmlsZSk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlGaWxlRXhwbG9yZXJDb2xvcnMocGx1Z2luKTtcblxuICAvLyBEZXIgRmlsZS1FeHBsb3JlciByZW5kZXJ0IEVpbnRyXHUwMEU0Z2UgYmVpbSBBdWYtL1p1a2xhcHBlbiB2b24gT3JkbmVybiBkeW5hbWlzY2hcbiAgLy8gbmV1IC0gcGVyIE11dGF0aW9uT2JzZXJ2ZXIgYXVmIG5ldSBlaW5nZWZcdTAwRkNndGUgRWxlbWVudGUgcmVhZ2llcmVuLCBzdGF0dCBudXJcbiAgLy8gZWlubWFsaWcgYmVpbSBTdGFydCBlaW56dWZcdTAwRTRyYmVuLlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlRXhwbG9yZXJMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShGSUxFX0VYUExPUkVSX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAudmF1bHQub24oXCJyZW5hbWVcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUV4cGxvcmVyTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlRXhwbG9yZXJMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XG5cbmNvbnN0IEdSQVBIX1ZJRVdfVFlQRVMgPSBbXCJncmFwaFwiLCBcImxvY2FsZ3JhcGhcIl07XG5cbmZ1bmN0aW9uIGhleFRvSW50KGhleCkge1xuICByZXR1cm4gcGFyc2VJbnQoaGV4LnJlcGxhY2UoXCIjXCIsIFwiXCIpLCAxNik7XG59XG5cbi8vIGVuZ2luZS5yZW5kZXIoKSBsaWVzdCBzZWluIGludGVybmVzIGZpbGVGaWx0ZXItT2JqZWt0IG51ciBhdXMsIHdlbm4gYmVyZWl0c1xuLy8gbWluZGVzdGVucyBlaW5lIGVpZ2VuZSBGYXJiZ3J1cHBlL0ZpbHRlci1RdWVyeSBha3RpdiBpc3QgLSBvaG5lIGVpZ2VuZSBHcnVwcGVuXG4vLyBiZWtvbW10IGplZGUgRGF0ZWkgcGF1c2NoYWwgY29sb3I6dHJ1ZSAoa2VpbiBGYXJid2VydCksIGZpbGVGaWx0ZXIgd2lyZCBnYXJcbi8vIG5pY2h0IGVyc3Qga29uc3VsdGllcnQuIFJvYnVzdGVyIGlzdCBkZXIgRWluZ3JpZmYgZGlyZWt0IGFuIHJlbmRlcmVyLnNldERhdGEsXG4vLyB1bm1pdHRlbGJhciBiZXZvciBkaWUgZmVydGlnZW4gTm9kZS1EYXRlbiBhbiBkZW4gV2ViR0wtUmVuZGVyZXIgZ2VoZW4gLSBhblxuLy8gZXhha3QgZGllc2VyIFN0ZWxsZSBwYXRjaHQgYXVjaCBkYXMgQ29tbXVuaXR5LVBsdWdpbiBcImdyYXBoLW5lc3RlZC10YWdzXCIuXG4vLyBFaWdlbmUgRmFyYmdydXBwZW4gaGFiZW4gZG9ydCBub2RlLmNvbG9yIGJlcmVpdHMgZ2VzZXR6dCB1bmQgYmxlaWJlbiB1bmFuZ2V0YXN0ZXQuXG5mdW5jdGlvbiBwYXRjaFJlbmRlcmVyKHBsdWdpbiwgcmVuZGVyZXIpIHtcbiAgaWYgKHJlbmRlcmVyLl9fZnJlZFR5cENvbG9yUGF0Y2hlZCkgcmV0dXJuO1xuICByZW5kZXJlci5fX2ZyZWRUeXBDb2xvclBhdGNoZWQgPSB0cnVlO1xuXG4gIGNvbnN0IG9yaWdpbmFsID0gcmVuZGVyZXIuc2V0RGF0YTtcbiAgcmVuZGVyZXIuc2V0RGF0YSA9IGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgZm9yIChjb25zdCBwYXRoIGluIGRhdGEubm9kZXMpIHtcbiAgICAgIGNvbnN0IG5vZGUgPSBkYXRhLm5vZGVzW3BhdGhdO1xuICAgICAgaWYgKG5vZGUuY29sb3IpIGNvbnRpbnVlO1xuXG4gICAgICBpZiAobm9kZS50eXBlID09PSBcInRhZ1wiKSB7XG4gICAgICAgIGlmIChwbHVnaW4uc2V0dGluZ3MuZ3JhcGhUYWdDb2xvckVuYWJsZWQgJiYgcGx1Z2luLnNldHRpbmdzLmdyYXBoVGFnQ29sb3IpIHtcbiAgICAgICAgICBub2RlLmNvbG9yID0geyBhOiAxLCByZ2I6IGhleFRvSW50KHBsdWdpbi5zZXR0aW5ncy5ncmFwaFRhZ0NvbG9yKSB9O1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocGF0aCk7XG4gICAgICBsZXQgY29sb3IgPSBudWxsO1xuXG4gICAgICBpZiAoZmlsZSAmJiBmaWxlLmV4dGVuc2lvbiAhPT0gXCJtZFwiKSB7XG4gICAgICAgIGlmIChwbHVnaW4uc2V0dGluZ3MuZ3JhcGhBdHRhY2htZW50Q29sb3JFbmFibGVkICYmIHBsdWdpbi5zZXR0aW5ncy5ncmFwaEF0dGFjaG1lbnRDb2xvcikge1xuICAgICAgICAgIGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmdyYXBoQXR0YWNobWVudENvbG9yO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmdyYXBoKSB7XG4gICAgICAgIGNvbG9yID0gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChjb2xvcikgbm9kZS5jb2xvciA9IHsgYTogMSwgcmdiOiBoZXhUb0ludChjb2xvcikgfTtcbiAgICB9XG4gICAgcmV0dXJuIG9yaWdpbmFsLmNhbGwodGhpcywgZGF0YSk7XG4gIH07XG5cbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICByZW5kZXJlci5zZXREYXRhID0gb3JpZ2luYWw7XG4gICAgZGVsZXRlIHJlbmRlcmVyLl9fZnJlZFR5cENvbG9yUGF0Y2hlZDtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGdldEdyYXBoTGVhdmVzKGFwcCkge1xuICBjb25zdCBsZWF2ZXMgPSBbXTtcbiAgZm9yIChjb25zdCB0eXBlIG9mIEdSQVBIX1ZJRVdfVFlQRVMpIGxlYXZlcy5wdXNoKC4uLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKHR5cGUpKTtcbiAgcmV0dXJuIGxlYXZlcztcbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJHcmFwaENvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgZ2V0R3JhcGhMZWF2ZXMocGx1Z2luLmFwcCkpIHtcbiAgICAgIGlmIChsZWFmLnZpZXc/LnJlbmRlcmVyKSBwYXRjaFJlbmRlcmVyKHBsdWdpbiwgbGVhZi52aWV3LnJlbmRlcmVyKTtcbiAgICAgIGxlYWYudmlldz8uZGF0YUVuZ2luZT8ucmVuZGVyKCk7XG4gICAgfVxuICB9O1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIC8vIE51ciBiZWkgdGF0c1x1MDBFNGNobGljaCBnZVx1MDBFNG5kZXJ0ZW0gVFlQIChzaWVoZSB0eXAtaW5kZXguanMpIC0gc29uc3QgemVpZ3RlIGRlclxuICAvLyBHcmFwaCBlaW5lIHVtZ2V0cmFnZW5lIEZhcmJlIGVyc3QgbmFjaCBkZW0gblx1MDBFNGNoc3RlbiBlaWdlbmVuIE5ldWF1ZmJhdS5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeShyZWZyZXNoKTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyR3JhcGhDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XG5cbmNvbnN0IFNFQVJDSF9WSUVXX1RZUEUgPSBcInNlYXJjaFwiO1xuXG4vLyBFcmdlYm5pc3plaWxlbiBpbSBTZWFyY2ggVmlldyB0cmFnZW4ga2VpbiBkYXRhLXBhdGgtQXR0cmlidXQsIGFiZXIgZGllXG4vLyBTZWFyY2hWaWV3IHBmbGVndCBpbnRlcm4gZWluZSBNYXAgdm9uIFRGaWxlIC0+IEVyZ2VibmlzLURPTS1PYmpla3Rcbi8vIChkb20ucmVzdWx0RG9tTG9va3VwKSAtIGRhclx1MDBGQ2JlciBsXHUwMEU0c3N0IHNpY2ggRGF0ZWkgdW5kIFplaWxlIGRpcmVrdCB2ZXJiaW5kZW4uXG5mdW5jdGlvbiBhcHBseVNlYXJjaENvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShTRUFSQ0hfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IHJlc3VsdERvbUxvb2t1cCA9IGxlYWYudmlldz8uZG9tPy5yZXN1bHREb21Mb29rdXA7XG4gICAgaWYgKCFyZXN1bHREb21Mb29rdXApIGNvbnRpbnVlO1xuXG4gICAgZm9yIChjb25zdCBbZmlsZSwgcmVzdWx0RG9tXSBvZiByZXN1bHREb21Mb29rdXApIHtcbiAgICAgIGNvbnN0IHRpdGxlRWwgPSByZXN1bHREb20uZWw/LnF1ZXJ5U2VsZWN0b3IoXCIuc2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIC50cmVlLWl0ZW0taW5uZXJcIik7XG4gICAgICBpZiAoIXRpdGxlRWwpIGNvbnRpbnVlO1xuXG4gICAgICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnNlYXJjaCA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUpIDogbnVsbDtcbiAgICAgIGlmIChjb2xvcikgdGl0bGVFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICAgICAgZWxzZSB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyU2VhcmNoQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlTZWFyY2hDb2xvcnMocGx1Z2luKTtcblxuICAvLyBFcmdlYm5pc3NlIHdlcmRlbiBiZWkgamVkZXIgU3VjaGVpbmdhYmUga29tcGxldHQgbmV1IGF1ZmdlYmF1dC5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFNFQVJDSF9WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclNlYXJjaENvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcblxuY29uc3QgUkVDRU5UX0ZJTEVTX1ZJRVdfVFlQRSA9IFwicmVjZW50LWZpbGVzXCI7XG5cbi8vIFJlY2VudCBGaWxlcyBzZXR6dCBrZWluIGRhdGEtcGF0aC1BdHRyaWJ1dCBhdWYgc2VpbmUgWmVpbGVuLiBFcyByZW5kZXJ0IHNlaW5lXG4vLyBMaXN0ZSBhYmVyIG9obmUgXHUwMEZDYmVyc3BydW5nZW5lIEVpbnRyXHUwMEU0Z2UgZGlyZWt0IGF1cyBkYXRhLnJlY2VudEZpbGVzLCBkYWhlclxuLy8gbFx1MDBFNHNzdCBzaWNoIGRpZSBaZWlsZSBcdTAwRkNiZXIgZGVuIEluZGV4IGVpbmRldXRpZyBkZW0gUGZhZCB6dW9yZG5lbi5cbmZ1bmN0aW9uIGFwcGx5UmVjZW50RmlsZXNDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoUkVDRU5UX0ZJTEVTX1ZJRVdfVFlQRSkpIHtcbiAgICBjb25zdCByZWNlbnRGaWxlcyA9IGxlYWYudmlldz8uZGF0YT8ucmVjZW50RmlsZXM7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJlY2VudEZpbGVzKSkgY29udGludWU7XG5cbiAgICBjb25zdCB0aXRsZUVscyA9IGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLnJlY2VudC1maWxlcy10aXRsZSAubmF2LWZpbGUtdGl0bGUtY29udGVudFwiKTtcbiAgICB0aXRsZUVscy5mb3JFYWNoKCh0aXRsZUVsLCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgZW50cnkgPSByZWNlbnRGaWxlc1tpbmRleF07XG4gICAgICBjb25zdCBmaWxlID0gZW50cnkgPyBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChlbnRyeS5wYXRoKSA6IG51bGw7XG4gICAgICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnJlY2VudEZpbGVzID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSkgOiBudWxsO1xuICAgICAgaWYgKGNvbG9yKSB0aXRsZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlSZWNlbnRGaWxlc0NvbG9ycyhwbHVnaW4pO1xuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShSRUNFTlRfRklMRVNfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcblxuY29uc3QgQkFDS0xJTktfVklFV19UWVBFID0gXCJiYWNrbGlua1wiO1xuXG4vLyBEYXMgQmFja2xpbmtzLVBhbmUgKFNlaXRlbmxlaXN0ZSkgcmVuZGVydCBUcmVmZmVyIGludGVybiBcdTAwRkNiZXIgZGllc2VsYmVcbi8vIFNlYXJjaFJlc3VsdERvbS1LbGFzc2Ugd2llIGRpZSBTdWNoZS4gVmVybGlua3RlIHVuZCBuaWNodCB2ZXJsaW5rdGVcbi8vIEVyd1x1MDBFNGhudW5nZW4gbGllZ2VuIGFscyB6d2VpIHJlc3VsdERvbUxvb2t1cC1NYXBzIGltIEJhY2tsaW5rUmVuZGVyZXJcbi8vICh2aWV3LmJhY2tsaW5rKSAtIEZlbGRuYW1lbiBzaW5kIG5pY2h0IG9mZml6aWVsbCBkb2t1bWVudGllcnQsIGRhaGVyXG4vLyBtZWhyZXJlIGJla2FubnRlIFBmYWRlIHByb2JpZXJlbiBzdGF0dCBlaW5lbiBmZXN0IGFuenVuZWhtZW4uXG5mdW5jdGlvbiBnZXRSZXN1bHREb21Mb29rdXBzKHZpZXcpIHtcbiAgY29uc3QgcmVuZGVyZXIgPSB2aWV3Py5iYWNrbGluaztcbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtyZW5kZXJlcj8uYmFja2xpbmtEb20sIHJlbmRlcmVyPy51bmxpbmtlZERvbSwgdmlldz8uYmFja2xpbmtEb20sIHZpZXc/LnVubGlua2VkRG9tLCB2aWV3Py5kb21dO1xuXG4gIGNvbnN0IGxvb2t1cHMgPSBbXTtcbiAgZm9yIChjb25zdCBkb20gb2YgY2FuZGlkYXRlcykge1xuICAgIGlmIChkb20/LnJlc3VsdERvbUxvb2t1cCBpbnN0YW5jZW9mIE1hcCkgbG9va3Vwcy5wdXNoKGRvbS5yZXN1bHREb21Mb29rdXApO1xuICB9XG4gIHJldHVybiBsb29rdXBzO1xufVxuXG5mdW5jdGlvbiBjb2xvclRpdGxlRWwocGx1Z2luLCBlbCwgZmlsZSkge1xuICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmJhY2tsaW5rcyA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUpIDogbnVsbDtcbiAgaWYgKGNvbG9yKSBlbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICBlbHNlIGVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG59XG5cbmZ1bmN0aW9uIGFwcGx5QmFja2xpbmtQYW5lQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJBQ0tMSU5LX1ZJRVdfVFlQRSkpIHtcbiAgICBmb3IgKGNvbnN0IGxvb2t1cCBvZiBnZXRSZXN1bHREb21Mb29rdXBzKGxlYWYudmlldykpIHtcbiAgICAgIGZvciAoY29uc3QgW2ZpbGUsIHJlc3VsdERvbV0gb2YgbG9va3VwKSB7XG4gICAgICAgIGNvbnN0IHRpdGxlRWwgPSByZXN1bHREb20uZWw/LnF1ZXJ5U2VsZWN0b3IoXCIuc2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIC50cmVlLWl0ZW0taW5uZXJcIik7XG4gICAgICAgIGlmICh0aXRsZUVsKSBjb2xvclRpdGxlRWwocGx1Z2luLCB0aXRsZUVsLCBmaWxlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLy8gXCJCYWNrbGlua3MgaW0gRG9rdW1lbnRcIiBpc3Qga2VpbmUgZWlnZW5lIEFuc2ljaHQva2VpbiBlaWdlbmVyIExlYWYsIHNvbmRlcm5cbi8vIHVudGVuIGluIGRpZSBNYXJrZG93blZpZXcgZWluZ2ViZXR0ZXQgKC5lbWJlZGRlZC1iYWNrbGlua3MpIC0gaGllciByZWljaHRcbi8vIGtlaW4gTGVhZi1UeXAsIHN0YXR0ZGVzc2VuIFx1MDBGQ2JlciBvZmZlbmUgTWFya2Rvd24tTGVhdmVzIG5hY2ggZGVyIERPTS1LbGFzc2Vcbi8vIHN1Y2hlbi4gT2huZSBkYXRhLXBhdGggamUgWmVpbGUgd2lyZCBkaWUgRGF0ZWkgXHUwMEZDYmVyIGRlbiBhbmdlemVpZ3RlblxuLy8gRGF0ZWluYW1lbiAoTGlua3RleHQpIGF1ZmdlbFx1MDBGNnN0LCB3aWUgT2JzaWRpYW4gaW50ZXJuIExpbmtzIGF1ZmxcdTAwRjZzdC5cbmZ1bmN0aW9uIGFwcGx5RW1iZWRkZWRCYWNrbGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgY29uc3QgcGFuZUVsID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoXCIuZW1iZWRkZWQtYmFja2xpbmtzIC5iYWNrbGluay1wYW5lXCIpO1xuICAgIGlmICghcGFuZUVsKSBjb250aW51ZTtcblxuICAgIGNvbnN0IHNvdXJjZVBhdGggPSBsZWFmLnZpZXcuZmlsZT8ucGF0aCA/PyBcIlwiO1xuICAgIGNvbnN0IHRpdGxlRWxzID0gcGFuZUVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIuc2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIC50cmVlLWl0ZW0taW5uZXJcIik7XG4gICAgZm9yIChjb25zdCB0aXRsZUVsIG9mIHRpdGxlRWxzKSB7XG4gICAgICBjb25zdCBiYXNlbmFtZSA9IHRpdGxlRWwudGV4dENvbnRlbnQ7XG4gICAgICBjb25zdCBmaWxlID0gYmFzZW5hbWUgPyBwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0Rmlyc3RMaW5rcGF0aERlc3QoYmFzZW5hbWUsIHNvdXJjZVBhdGgpIDogbnVsbDtcbiAgICAgIGNvbG9yVGl0bGVFbChwbHVnaW4sIHRpdGxlRWwsIGZpbGUpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBseUJhY2tsaW5rQ29sb3JzKHBsdWdpbikge1xuICBhcHBseUJhY2tsaW5rUGFuZUNvbG9ycyhwbHVnaW4pO1xuICBhcHBseUVtYmVkZGVkQmFja2xpbmtDb2xvcnMocGx1Z2luKTtcbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5QmFja2xpbmtDb2xvcnMocGx1Z2luKTtcblxuICAvLyBOdXIgZGFzIChrbGVpbmUpIEJhY2tsaW5rcy1QYW5lIGluIGRlciBTZWl0ZW5sZWlzdGUgcGVyIE11dGF0aW9uT2JzZXJ2ZXJcbiAgLy8gYmVvYmFjaHRlbiAtIE5JQ0hUIGRpZSBNYXJrZG93blZpZXctQ29udGFpbmVyLCBkYSBkZXJlbiBFZGl0b3ItU3VidHJlZSBiZWlcbiAgLy8gamVkZW0gVGFzdGVuZHJ1Y2sgdmllbGUgTXV0YXRpb25lbiBlcnpldWd0IChzaWVoZSBXYXJudW5nIGluXG4gIC8vIGRhdGFiYXNlLWZvbGRlcnMuanM6IGVpbiBzdWJ0cmVlLU9ic2VydmVyIFx1MDBGQ2JlciBlaW5lbiBFZGl0b3ItbmFoZW4gQ29udGFpbmVyXG4gIC8vIGhhdCBkaWVzZXMgVmF1bHQgc2Nob24gZWlubWFsIGtvbXBsZXR0IGVpbmdlZnJvcmVuKS4gRGllIGVpbmdlYmV0dGV0ZW5cbiAgLy8gQmFja2xpbmtzIGltIERva3VtZW50IGJyYXVjaGVuIGRhZlx1MDBGQ3Iga2VpbmVuIGVpZ2VuZW4gT2JzZXJ2ZXI6IHNpZSBcdTAwRTRuZGVyblxuICAvLyBzaWNoIG51ciwgd2VubiBpcmdlbmR3byBpbSBWYXVsdCBMaW5rcyBoaW56dWtvbW1lbi93ZWdmYWxsZW4gb2RlciBiZWltXG4gIC8vIFx1MDBENmZmbmVuL1dlY2hzZWxuIGVpbmVyIE5vdGl6IC0gYmVpZGVzIGlzdCBcdTAwRkNiZXIgZGllIEV2ZW50cyB1bnRlbiBiZXJlaXRzXG4gIC8vIGFiZ2VkZWNrdCAoXCJyZXNvbHZlZFwiIG5hY2ggamVkZXIgTGluay1BdWZsXHUwMEY2c3VuZywgbGF5b3V0LWNoYW5nZS9cbiAgLy8gYWN0aXZlLWxlYWYtY2hhbmdlIGxcdTAwRjZzZW4gb2huZWhpbiBhcHBseUJhY2tsaW5rQ29sb3JzKCkgdW5kIGRhbWl0IGF1Y2hcbiAgLy8gYXBwbHlFbWJlZGRlZEJhY2tsaW5rQ29sb3JzKCkgYXVzKS5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJBQ0tMSU5LX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIC8vIE51ciBkZXIgZWluZ2ViZXR0ZXRlIFRlaWwgaFx1MDBFNG5ndCAobWFuZ2VscyBlaWdlbmVtIE9ic2VydmVyLCBzaWVoZSBvYmVuKVxuICAvLyB3ZWl0ZXJoaW4gYW4gZGVyIExpbmstQXVmbFx1MDBGNnN1bmcgLSBkaWUgU2VpdGVubGVpc3RlIGRlY2t0IGlociBPYnNlcnZlciBhYi5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLm9uKFwicmVzb2x2ZWRcIiwgKCkgPT4gYXBwbHlFbWJlZGRlZEJhY2tsaW5rQ29sb3JzKHBsdWdpbikpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCByZWZyZXNoKSk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckJhY2tsaW5rQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG5jb25zdCBCT09LTUFSS1NfVklFV19UWVBFID0gXCJib29rbWFya3NcIjtcbmNvbnN0IEJPT0tNQVJLU19QTFVHSU5fSUQgPSBcImJvb2ttYXJrc1wiO1xuXG4vLyBCb29rbWFyay1aZWlsZW4gdHJhZ2VuIGtlaW4gZGF0YS1wYXRoLUF0dHJpYnV0LiBEZXIgVmlldyBoXHUwMEU0bHQgYWJlciBpbnRlcm5cbi8vIGVpbmUgV2Vha01hcCAodmlldy5pdGVtRG9tczogQm9va21hcmstSXRlbSAtPiBUcmVlLUl0ZW0tRG9tIG1pdCAudGl0bGVFbCkgLVxuLy8gZGFyXHUwMEZDYmVyIGxcdTAwRTRzc3Qgc2ljaCBqZWRlcyBJdGVtIGdlemllbHQgc2VpbmVyIFplaWxlIHp1b3JkbmVuLCBvaG5lIGRpZSAobmljaHRcbi8vIGl0ZXJpZXJiYXJlKSBXZWFrTWFwIHNlbGJzdCBkdXJjaGxhdWZlbiB6dSBtXHUwMEZDc3Nlbjogc3RhdHRkZXNzZW4gcmVrdXJzaXYgXHUwMEZDYmVyXG4vLyBkZW4gSXRlbS1CYXVtIGRlcyBCb29rbWFya3MtUGx1Z2lucyBzZWxic3QgbGF1ZmVuIChsaWVndCB1bmFiaFx1MDBFNG5naWcgdm9tXG4vLyBSZW5kZXItL0NvbGxhcHNlLVp1c3RhbmQgaW1tZXIgdm9sbHN0XHUwMEU0bmRpZyB2b3IpIHVuZCBqZSBJdGVtIHBlciAuZ2V0KClcbi8vIG5hY2hzY2hsYWdlbiwgb2IgKHVuZCB3bykgZXMgYWt0dWVsbCBnZXJlbmRlcnQgaXN0LlxuZnVuY3Rpb24gZm9yRWFjaEZpbGVCb29rbWFyayhpdGVtcywgY2FsbGJhY2spIHtcbiAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zID8/IFtdKSB7XG4gICAgaWYgKGl0ZW0udHlwZSA9PT0gXCJmaWxlXCIpIGNhbGxiYWNrKGl0ZW0pO1xuICAgIGVsc2UgaWYgKGl0ZW0udHlwZSA9PT0gXCJncm91cFwiKSBmb3JFYWNoRmlsZUJvb2ttYXJrKGl0ZW0uaXRlbXMsIGNhbGxiYWNrKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBseUJvb2ttYXJrc0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgYm9va21hcmtzUGx1Z2luID0gcGx1Z2luLmFwcC5pbnRlcm5hbFBsdWdpbnMuZ2V0RW5hYmxlZFBsdWdpbkJ5SWQoQk9PS01BUktTX1BMVUdJTl9JRCk7XG4gIGlmICghYm9va21hcmtzUGx1Z2luKSByZXR1cm47XG5cbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShCT09LTUFSS1NfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IGl0ZW1Eb21zID0gbGVhZi52aWV3Py5pdGVtRG9tcztcbiAgICBpZiAoIWl0ZW1Eb21zKSBjb250aW51ZTtcblxuICAgIGZvckVhY2hGaWxlQm9va21hcmsoYm9va21hcmtzUGx1Z2luLml0ZW1zLCAoaXRlbSkgPT4ge1xuICAgICAgY29uc3QgdGl0bGVFbCA9IGl0ZW1Eb21zLmdldChpdGVtKT8udGl0bGVFbDtcbiAgICAgIGlmICghdGl0bGVFbCkgcmV0dXJuO1xuXG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoaXRlbS5wYXRoKTtcbiAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuYm9va21hcmtzID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSkgOiBudWxsO1xuICAgICAgaWYgKGNvbG9yKSB0aXRsZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5Qm9va21hcmtzQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gQW5hbG9nIHp1IGZpbGUtZXhwbG9yZXItY29sb3JzLmpzOiBCb29rbWFya3MgcmVuZGVydCBaZWlsZW4gYmVpbVxuICAvLyBBdWYtL1p1a2xhcHBlbiB2b24gR3J1cHBlbiBzb3dpZSBiZWltIEhpbnp1Zlx1MDBGQ2dlbi9FbnRmZXJuZW4vVW1zb3J0aWVyZW5cbiAgLy8gZHluYW1pc2NoIG5ldS5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJPT0tNQVJLU19WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyB9O1xuIiwgImNvbnN0IHsgVEZpbGUgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcblxuY29uc3QgRE9UX0NMQVNTID0gXCJmcmVkLXR5cC10aXRsZS1kb3RcIjtcbmNvbnN0IEJBREdFX0NMQVNTID0gXCJmcmVkLXR5cC10aXRsZS1iYWRnZVwiO1xuY29uc3QgQkFER0VfUExBSU5fQ0xBU1MgPSBcImZyZWQtdHlwLXRpdGxlLWJhZGdlLXBsYWluXCI7XG5jb25zdCBDT0xPUl9WQVIgPSBcIi0tZnJlZC10eXAtdGl0bGUtY29sb3JcIjtcblxuY29uc3QgQkxPQ0tfQkFER0VfQ0xBU1MgPSBcImZyZWQtdHlwLWJsb2NrLWJhZGdlXCI7XG5jb25zdCBCTE9DS19CQURHRV9QTEFJTl9DTEFTUyA9IFwiZnJlZC10eXAtYmxvY2stYmFkZ2UtcGxhaW5cIjtcbmNvbnN0IEJMT0NLX0FMSUdOX1RPUF9DTEFTUyA9IFwiZnJlZC10eXAtYmxvY2stYmFkZ2UtdG9wXCI7XG5jb25zdCBCTE9DS19BTElHTl9CT1RUT01fQ0xBU1MgPSBcImZyZWQtdHlwLWJsb2NrLWJhZGdlLWJvdHRvbVwiO1xuY29uc3QgQkxPQ0tfQ09MT1JfVkFSID0gXCItLWZyZWQtdHlwLWJsb2NrLWNvbG9yXCI7XG5cbi8vIG5vdGVUaXRsZVN0eWxlOiBcIm5vbmVcIiB8IFwiZG90XCIgfCBcImJhZGdlXCIuIEJlaSBcImJhZGdlXCIgYmVzdGltbWVuIHp3ZWlcbi8vIHdlaXRlcmUgRWluc3RlbGx1bmdlbiBGYXJiZSAobm90ZVRpdGxlQmFkZ2VDb2xvcmVkKSB1bmQgUG9zaXRpb25cbi8vIChub3RlVGl0bGVCYWRnZVBvc2l0aW9uOiBcInRpdGxlXCIgfCBcImJsb2NrXCIpIC0gc2llaGUgc2V0dGluZ3MuanMsIGRvcnQgbnVyXG4vLyBiZWkgXCJiYWRnZVwiIFx1MDBGQ2JlcmhhdXB0IGFuZ2V6ZWlndCAocHJvZ3Jlc3NpdmUgT2ZmZW5sZWd1bmcpLiBcImRvdFwiIHNpdHp0XG4vLyBpbW1lciBhbSBUaXRlbCwgXCJiYWRnZVwiIGplIG5hY2ggUG9zaXRpb24gZW50d2VkZXIgYW0gVGl0ZWwgb2RlciBhbVxuLy8gUHJvcGVydHktQmxvY2sgKGRvcnQgenVzXHUwMEU0dHpsaWNoIHBlciBub3RlVGl0bGVWZXJ0aWNhbEFsaWduIG9iZW4vdW50ZW4pLlxuLy8gY29sb3JWaWV3cy5ub3RlVGl0bGVDb2xvciAoVGl0ZWx0ZXh0IHNlbGJzdCBlaW5mXHUwMEU0cmJlbikgaXN0IGRhdm9uIHVuYWJoXHUwMEU0bmdpZ1xuLy8gdW5kIGJlbGllYmlnIGtvbWJpbmllcmJhci5cbmZ1bmN0aW9uIHJlc29sdmVNYXJrZXIocGx1Z2luLCBmaWxlKSB7XG4gIGNvbnN0IHN0eWxlID0gcGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlO1xuICBpZiAoc3R5bGUgPT09IFwibm9uZVwiKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBpZiAoc3R5bGUgPT09IFwiZG90XCIpIHJldHVybiB7IGtpbmQ6IFwiZG90XCIsIGNvbG9yOiBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlKSB9O1xuXG4gIC8vIHN0eWxlID09PSBcImJhZGdlXCJcbiAgY29uc3QgY29sb3JlZCA9IHBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUNvbG9yZWQ7XG4gIGNvbnN0IGNvbG9yID0gY29sb3JlZCA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUpIDogbnVsbDtcbiAgY29uc3QgdHlwZU5hbWUgPSBjb2xvcmVkID8gKGNvbG9yID8gcGx1Z2luLnR5cEluZGV4LnR5cGVPZihmaWxlKSA6IG51bGwpIDogcGx1Z2luLnR5cEluZGV4LnR5cGVPZihmaWxlKTtcbiAgaWYgKCF0eXBlTmFtZSkgcmV0dXJuIHsga2luZDogXCJub25lXCIgfTtcblxuICBjb25zdCBwb3NpdGlvbiA9IHBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZVBvc2l0aW9uO1xuICByZXR1cm4geyBraW5kOiBwb3NpdGlvbiA9PT0gXCJibG9ja1wiID8gXCJibG9jay1iYWRnZVwiIDogXCJ0aXRsZS1iYWRnZVwiLCBjb2xvcmVkLCBjb2xvciwgdHlwZU5hbWUgfTtcbn1cblxuLy8gVGl0ZWwgZGVyIE5vdGl6IHNlbGJzdCAoLmlubGluZS10aXRsZSwgc2ljaHRiYXIgc29mZXJuIE9ic2lkaWFucyBlaWdlbmVcbi8vIEVpbnN0ZWxsdW5nIFwiSW5saW5lLVRpdGVsIGFuemVpZ2VuXCIgYWt0aXYgaXN0KS4gQmV3dXNzdCBhbHMgOjpiZWZvcmVcbi8vIHJlYWxpc2llcnQgKHNpZWhlIHN0eWxlcy5jc3MpIHN0YXR0IGFscyBlaWdlbmVzIERPTS1FbGVtZW50IG9kZXIgV3JhcHBlcjpcbi8vIC5pbmxpbmUtdGl0bGUgaFx1MDBFNG5ndCBpbiBtZWhyZXJlbiBUaGVtZXMgKHUuIGEuIE1pbmltYWwpIHBlciBLaW5kLVNlbGVrdG9yXG4vLyAoXCI+XCIpIGRpcmVrdCBhbiBzZWluZW0gRWx0ZXJuLUNvbnRhaW5lciAoei4gQi4gZlx1MDBGQ3IgbWF4LXdpZHRoL21hcmdpbikgLSBlaW5cbi8vIHp1c1x1MDBFNHR6bGljaGVzIEVsZW1lbnQgZGF2b3Igb2RlciBlaW4gV3JhcHBlciBkYXJ1bSB3XHUwMEZDcmRlIGRpZXNlIFJlZ2VsblxuLy8gdW50ZXJ3YW5kZXJuLiBGYXJiZSB1bmQgVFlQLU5hbWUgbGFzc2VuIHNpY2ggZWluZW0gOjpiZWZvcmUgbmljaHQgZGlyZWt0XG4vLyB6dXdlaXNlbiwgZGFoZXIgZGVyIFVtd2VnIFx1MDBGQ2JlciBlaW5lIENTUy1WYXJpYWJsZSBiencuIGVpbiBkYXRhLUF0dHJpYnV0LFxuLy8gZGllIGRpZSA6OmJlZm9yZS1SZWdlbG4gYXVzbGVzZW4gKHZhcigpL2F0dHIoKSkuXG5mdW5jdGlvbiBhcHBseVN0eWxlVG9UaXRsZSh0aXRsZUVsLCBtYXJrZXIpIHtcbiAgY29uc3QgaXNEb3QgPSBtYXJrZXIua2luZCA9PT0gXCJkb3RcIiAmJiAhIW1hcmtlci5jb2xvcjtcbiAgY29uc3QgaXNCYWRnZSA9IG1hcmtlci5raW5kID09PSBcInRpdGxlLWJhZGdlXCI7XG5cbiAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKERPVF9DTEFTUywgaXNEb3QpO1xuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoQkFER0VfQ0xBU1MsIGlzQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQpO1xuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoQkFER0VfUExBSU5fQ0xBU1MsIGlzQmFkZ2UgJiYgIW1hcmtlci5jb2xvcmVkKTtcblxuICBpZiAoaXNCYWRnZSkgdGl0bGVFbC5kYXRhc2V0LmZyZWRUeXAgPSBtYXJrZXIudHlwZU5hbWU7XG4gIGVsc2UgZGVsZXRlIHRpdGxlRWwuZGF0YXNldC5mcmVkVHlwO1xuXG4gIGNvbnN0IG1hcmtlckNvbG9yID0gKGlzRG90ICYmIG1hcmtlci5jb2xvcikgfHwgKGlzQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQgJiYgbWFya2VyLmNvbG9yKSA/IG1hcmtlci5jb2xvciA6IG51bGw7XG4gIGlmIChtYXJrZXJDb2xvcikgdGl0bGVFbC5zdHlsZS5zZXRQcm9wZXJ0eShDT0xPUl9WQVIsIG1hcmtlckNvbG9yKTtcbiAgZWxzZSB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KENPTE9SX1ZBUik7XG59XG5cbi8vIFByb3BlcnR5LUJsb2NrIGRlciBOb3RpeiAoLm1ldGFkYXRhLWNvbnRhaW5lcikuIERpZSBcImJsb2NrXCItUG9zaXRpb24gdm9uXG4vLyBub3RlVGl0bGVCYWRnZVBvc2l0aW9uOiBkaWVzZWxiZSBCb3ggd2llIGFtIFRpdGVsLCBhYmVyIHVtIDkwXHUwMEIwIGdlZHJlaHRcbi8vICh3cml0aW5nLW1vZGUgc3RhdHQgdHJhbnNmb3JtOnJvdGF0ZSgpIC0gZGFkdXJjaCB3XHUwMEU0Y2hzdCBkaWUgQm94IG1pdCBkZXJcbi8vIFRleHRsXHUwMEU0bmdlIGluIGRlciByaWNodGlnZW4gUmljaHR1bmcsIG9obmUgZGllIFBvc2l0aW9uaWVydW5nIHBlclxuLy8gdHJhbnNmb3JtLW9yaWdpbiB2b24gSGFuZCBuYWNocmVjaG5lbiB6dSBtXHUwMEZDc3NlbikgdW5kIGxpbmtzIGFtIFByb3BlcnR5LUJsb2NrXG4vLyBzdGF0dCBhbSBUaXRlbCB2ZXJhbmtlcnQsIG9iZW4gb2RlciB1bnRlbiAobm90ZVRpdGxlVmVydGljYWxBbGlnbikuIEJsZWlidFxuLy8gYmVpbSAoRWluLS9BdXMtKUJsZW5kZW4gZGVzIEJsb2NrcyAoc2llaGUgUHJvcGVydHktQmxvY2suY3NzKSBhdXRvbWF0aXNjaFxuLy8gbWl0IHZlcnNjaHdpbmRlbi9lcnNjaGVpbmVuLCBkYSBzaWUgYWxzIDo6YmVmb3JlIGRhcmF1ZiBzaXR6dC5cbmZ1bmN0aW9uIGFwcGx5U3R5bGVUb0Jsb2NrKHBsdWdpbiwgYmxvY2tFbCwgbWFya2VyKSB7XG4gIGNvbnN0IGlzQmxvY2tCYWRnZSA9IG1hcmtlci5raW5kID09PSBcImJsb2NrLWJhZGdlXCI7XG5cbiAgYmxvY2tFbC5jbGFzc0xpc3QudG9nZ2xlKEJMT0NLX0JBREdFX0NMQVNTLCBpc0Jsb2NrQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQpO1xuICBibG9ja0VsLmNsYXNzTGlzdC50b2dnbGUoQkxPQ0tfQkFER0VfUExBSU5fQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiAhbWFya2VyLmNvbG9yZWQpO1xuXG4gIGNvbnN0IGFsaWduID0gcGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVZlcnRpY2FsQWxpZ247XG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19BTElHTl9UT1BfQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiBhbGlnbiAhPT0gXCJib3R0b21cIik7XG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19BTElHTl9CT1RUT01fQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiBhbGlnbiA9PT0gXCJib3R0b21cIik7XG5cbiAgaWYgKGlzQmxvY2tCYWRnZSkgYmxvY2tFbC5kYXRhc2V0LmZyZWRUeXAgPSBtYXJrZXIudHlwZU5hbWU7XG4gIGVsc2UgZGVsZXRlIGJsb2NrRWwuZGF0YXNldC5mcmVkVHlwO1xuXG4gIGNvbnN0IGJsb2NrQ29sb3IgPSBpc0Jsb2NrQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQgJiYgbWFya2VyLmNvbG9yID8gbWFya2VyLmNvbG9yIDogbnVsbDtcbiAgaWYgKGJsb2NrQ29sb3IpIGJsb2NrRWwuc3R5bGUuc2V0UHJvcGVydHkoQkxPQ0tfQ09MT1JfVkFSLCBibG9ja0NvbG9yKTtcbiAgZWxzZSBibG9ja0VsLnN0eWxlLnJlbW92ZVByb3BlcnR5KEJMT0NLX0NPTE9SX1ZBUik7XG59XG5cbmZ1bmN0aW9uIGFwcGx5QWN0aXZlVGl0bGVDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGNvbnN0IGNvbnRhaW5lckVsID0gbGVhZi52aWV3LmNvbnRhaW5lckVsO1xuICAgIGNvbnN0IGZpbGUgPSBsZWFmLnZpZXcuZmlsZTtcbiAgICBjb25zdCB0eXBlZEZpbGUgPSBmaWxlIGluc3RhbmNlb2YgVEZpbGUgPyBmaWxlIDogbnVsbDtcbiAgICBjb25zdCBtYXJrZXIgPSByZXNvbHZlTWFya2VyKHBsdWdpbiwgdHlwZWRGaWxlKTtcblxuICAgIGNvbnN0IHRpdGxlRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKFwiLmlubGluZS10aXRsZVwiKTtcbiAgICBpZiAodGl0bGVFbCkge1xuICAgICAgYXBwbHlTdHlsZVRvVGl0bGUodGl0bGVFbCwgbWFya2VyKTtcblxuICAgICAgY29uc3QgdGV4dENvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Mubm90ZVRpdGxlQ29sb3IgPyBjb2xvckZvckZpbGUocGx1Z2luLCB0eXBlZEZpbGUpIDogbnVsbDtcbiAgICAgIGlmICh0ZXh0Q29sb3IpIHRpdGxlRWwuc3R5bGUuY29sb3IgPSB0ZXh0Q29sb3I7XG4gICAgICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBibG9ja0VsID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihcIi5tZXRhZGF0YS1jb250YWluZXJcIik7XG4gICAgaWYgKGJsb2NrRWwpIGFwcGx5U3R5bGVUb0Jsb2NrKHBsdWdpbiwgYmxvY2tFbCwgbWFya2VyKTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlBY3RpdmVUaXRsZUNvbG9ycyhwbHVnaW4pO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwiZmlsZS1vcGVuXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJhY3RpdmUtbGVhZi1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaCk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzIH07XG4iLCAiY29uc3QgeyBlZGl0b3JJbmZvRmllbGQsIGdldExpbmtwYXRoIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IFZpZXdQbHVnaW4sIERlY29yYXRpb24gfSA9IHJlcXVpcmUoXCJAY29kZW1pcnJvci92aWV3XCIpO1xuY29uc3QgeyBQcmVjLCBSYW5nZVNldEJ1aWxkZXIsIFN0YXRlRWZmZWN0IH0gPSByZXF1aXJlKFwiQGNvZGVtaXJyb3Ivc3RhdGVcIik7XG5jb25zdCB7IHN5bnRheFRyZWUgfSA9IHJlcXVpcmUoXCJAY29kZW1pcnJvci9sYW5ndWFnZVwiKTtcbmNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcblxuLy8gTGlua3MgaW0gTm90aXp0ZXh0IG5hY2ggZGVtIFRZUCBpaHJlcyBaaWVscyBlaW5mXHUwMEU0cmJlbi4gT2JzaWRpYW4gZlx1MDBFNHJidFxuLy8gaW50ZXJuZSBMaW5rcyBpbiBiZWlkZW4gRGFyc3RlbGx1bmdlbiBcdTAwRkNiZXIgdmFyKC0tbGluay1jb2xvcikgYnp3LlxuLy8gdmFyKC0tbGluay1jb2xvci1ob3ZlcikgKHNpZWhlIGFwcC5jc3M6IFwiLm1hcmtkb3duLXJlbmRlcmVkIC5pbnRlcm5hbC1saW5rXCJcbi8vIHVuZCBcIi5jbS1zLW9ic2lkaWFuIHNwYW4uY20taG1kLWludGVybmFsLWxpbmtcIikgLSBzdGF0dCBlaWdlbmVyIEZhcmJyZWdlbG5cbi8vIHdpcmQgZGFoZXIgbnVyIC0tbGluay1jb2xvciBqZSBMaW5rIFx1MDBGQ2JlcnNjaHJpZWJlbi4gLS1saW5rLWNvbG9yLWhvdmVyIGJsZWlidFxuLy8gYmV3dXNzdCB1bmFuZ2V0YXN0ZXQ6IGJlaW0gXHUwMERDYmVyZmFocmVuIGVyc2NoZWludCB3aWVkZXIgZGllIG5vcm1hbGVcbi8vIExpbmstRmFyYmUuIFVudGVyc3RyZWljaHVuZyB1bmQgVGhlbWUtQW5wYXNzdW5nZW4gYmxlaWJlbiBlYmVuc28gZXJoYWx0ZW4uXG4vL1xuLy8gWndlaSBnZXRyZW5udGUgV2VnZSwgZGEgc2ljaCBkaWUgRGFyc3RlbGx1bmdlbiBncnVuZGxlZ2VuZCB1bnRlcnNjaGVpZGVuOlxuLy8gIC0gTGVzZS1Nb2R1cywgSG92ZXItVm9yc2NoYXUsIGdlcmVuZGVydGUgQmxcdTAwRjZja2UgaW4gTGl2ZSBQcmV2aWV3IChUYWJlbGxlbixcbi8vICAgIENhbGxvdXRzKTogZWNodGUgPGEgY2xhc3M9XCJpbnRlcm5hbC1saW5rXCIgZGF0YS1ocmVmPVwiXHUyMDI2XCI+LUVsZW1lbnRlIGF1c1xuLy8gICAgT2JzaWRpYW5zIE1hcmtkb3duLVJlbmRlcmVyIC0+IE1hcmtkb3duUG9zdFByb2Nlc3NvciwgamUgTGluayBlaW5tYWxpZ1xuLy8gICAgYmVpbSBSZW5kZXJuLlxuLy8gIC0gTGl2ZSBQcmV2aWV3L1F1ZWxsdGV4dC1Nb2R1czogZG9ydCBnaWJ0IGVzIGtlaW5lIExpbmstRWxlbWVudGUgbWl0XG4vLyAgICBaaWVsYXR0cmlidXQsIG51ciBDb2RlTWlycm9yLVNwYW5zIChcIi5jbS1obWQtaW50ZXJuYWwtbGlua1wiKSBcdTAwRkNiZXIgZGVtXG4vLyAgICBSb2h0ZXh0IC0+IGVpZ2VuZXIgVmlld1BsdWdpbiwgZGVyIG51ciBkZW4gc2ljaHRiYXJlbiBCZXJlaWNoIGJldHJhY2h0ZXQuXG4vL1xuLy8gTmV1IGVpbmdlZlx1MDBFNHJidCB3aXJkIGRhclx1MDBGQ2JlciBoaW5hdXMgbnVyIGJlaSB0YXRzXHUwMEU0Y2hsaWNoIGdlXHUwMEU0bmRlcnRlbSBUWVBcbi8vICh0eXBJbmRleCBcImNoYW5nZVwiKSBvZGVyIGdlXHUwMEU0bmRlcnRlciBFaW5zdGVsbHVuZyAtIG5pY2h0IGJlaSBqZWRlbSBTcGVpY2hlcm4uXG5cbmNvbnN0IENPTE9SX1ZBUiA9IFwiLS1saW5rLWNvbG9yXCI7XG5jb25zdCBTT1VSQ0VfQVRUUiA9IFwiZGF0YS1mcmVkLXR5cC1zcmNcIjtcblxuLy8gW1taaWVsXV0sIFtbWmllbHxBbGlhc11dLCBbW1ppZWwjXHUwMERDYmVyc2NocmlmdF1dIC0gRWluYmV0dHVuZ2VuICghW1tcdTIwMjZdXSlcbi8vIGJsZWliZW4gYXVcdTAwREZlbiB2b3IsIGRpZSBzaW5kIGtlaW5lIExpbmtzIGltIGVpZ2VudGxpY2hlbiBTaW5uLiBJbiBUYWJlbGxlblxuLy8gc3RlaHQgZGllIEFsaWFzLVBpcGUgZXNjYXBlZCAoXCJcXHxcIikuXG5jb25zdCBXSUtJTElOS19QQVRURVJOID0gLyg/PCEhKVxcW1xcWyhbXltcXF1dKz8pXFxdXFxdL2c7XG5cbmZ1bmN0aW9uIGNvbG9yRm9yTGlua3RleHQocGx1Z2luLCBsaW5rdGV4dCwgc291cmNlUGF0aCkge1xuICBjb25zdCB0YXJnZXQgPSBsaW5rdGV4dC5zcGxpdCgvXFxcXD9cXHwvKVswXS50cmltKCk7XG4gIGNvbnN0IGxpbmtwYXRoID0gZ2V0TGlua3BhdGgodGFyZ2V0KTtcbiAgaWYgKCFsaW5rcGF0aCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0Rmlyc3RMaW5rcGF0aERlc3QobGlua3BhdGgsIHNvdXJjZVBhdGgpO1xuICByZXR1cm4gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSk7XG59XG5cbi8vIC0tLSBMZXNlLU1vZHVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBhcHBseVRvQW5jaG9yKHBsdWdpbiwgYW5jaG9yRWwpIHtcbiAgY29uc3QgaHJlZiA9IGFuY2hvckVsLmdldEF0dHJpYnV0ZShcImRhdGEtaHJlZlwiKTtcbiAgY29uc3QgY29sb3IgPVxuICAgIHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmxpbmtzICYmIGhyZWYgJiYgIWFuY2hvckVsLmNsYXNzTGlzdC5jb250YWlucyhcImlzLXVucmVzb2x2ZWRcIilcbiAgICAgID8gY29sb3JGb3JMaW5rdGV4dChwbHVnaW4sIGhyZWYsIGFuY2hvckVsLmdldEF0dHJpYnV0ZShTT1VSQ0VfQVRUUikgPz8gXCJcIilcbiAgICAgIDogbnVsbDtcbiAgaWYgKGNvbG9yKSBhbmNob3JFbC5zdHlsZS5zZXRQcm9wZXJ0eShDT0xPUl9WQVIsIGNvbG9yKTtcbiAgZWxzZSBhbmNob3JFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShDT0xPUl9WQVIpO1xufVxuXG4vLyBCZXJlaXRzIGdlcmVuZGVydGUgTGlua3MgbmV1IGVpbmZcdTAwRTRyYmVuIChUWVAtIG9kZXIgRWluc3RlbGx1bmdzXHUwMEU0bmRlcnVuZykuIERlclxuLy8gUG9zdC1Qcm9jZXNzb3IgbWVya3Qgc2ljaCBkYWZcdTAwRkNyIGFuIGplZGVtIExpbmsgZGVzc2VuIFF1ZWxsbm90aXosIGRhIGRpZSB6dXJcbi8vIEF1ZmxcdTAwRjZzdW5nIG1laHJkZXV0aWdlciBMaW5rdGV4dGUgZ2VicmF1Y2h0IHdpcmQuIEFsbGUgRmVuc3RlciAoUG9wLW91dHMpXG4vLyBcdTAwRkNiZXIgaWhyZSBMZWF2ZXMgZWluZ2VzYW1tZWx0LlxuZnVuY3Rpb24gcmVmcmVzaFJlbmRlcmVkTGlua3MocGx1Z2luKSB7XG4gIGNvbnN0IGRvY3MgPSBuZXcgU2V0KCk7XG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLml0ZXJhdGVBbGxMZWF2ZXMoKGxlYWYpID0+IGRvY3MuYWRkKGxlYWYudmlldy5jb250YWluZXJFbC5vd25lckRvY3VtZW50KSk7XG4gIGZvciAoY29uc3QgZG9jIG9mIGRvY3MpIHtcbiAgICBmb3IgKGNvbnN0IGFuY2hvckVsIG9mIGRvYy5xdWVyeVNlbGVjdG9yQWxsKGBhLmludGVybmFsLWxpbmtbJHtTT1VSQ0VfQVRUUn1dYCkpIGFwcGx5VG9BbmNob3IocGx1Z2luLCBhbmNob3JFbCk7XG4gIH1cbn1cblxuLy8gLS0tIExpdmUgUHJldmlldyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IHJlZnJlc2hFZmZlY3QgPSBTdGF0ZUVmZmVjdC5kZWZpbmUoKTtcblxuZnVuY3Rpb24gYnVpbGRMaW5rVmlld1BsdWdpbihwbHVnaW4pIHtcbiAgY29uc3QgZGVjb3JhdGlvbnNCeUNvbG9yID0gbmV3IE1hcCgpO1xuICBjb25zdCBkZWNvcmF0aW9uRm9yID0gKGNvbG9yKSA9PiB7XG4gICAgbGV0IGRlY29yYXRpb24gPSBkZWNvcmF0aW9uc0J5Q29sb3IuZ2V0KGNvbG9yKTtcbiAgICBpZiAoIWRlY29yYXRpb24pIHtcbiAgICAgIGRlY29yYXRpb24gPSBEZWNvcmF0aW9uLm1hcmsoe1xuICAgICAgICBjbGFzczogXCJmcmVkLXR5cC1saW5rXCIsXG4gICAgICAgIGF0dHJpYnV0ZXM6IHsgc3R5bGU6IGAke0NPTE9SX1ZBUn06ICR7Y29sb3J9O2AgfSxcbiAgICAgIH0pO1xuICAgICAgZGVjb3JhdGlvbnNCeUNvbG9yLnNldChjb2xvciwgZGVjb3JhdGlvbik7XG4gICAgfVxuICAgIHJldHVybiBkZWNvcmF0aW9uO1xuICB9O1xuXG4gIGNvbnN0IGJ1aWxkID0gKHZpZXcpID0+IHtcbiAgICBpZiAoIXBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmxpbmtzKSByZXR1cm4gRGVjb3JhdGlvbi5ub25lO1xuICAgIGNvbnN0IHNvdXJjZVBhdGggPSB2aWV3LnN0YXRlLmZpZWxkKGVkaXRvckluZm9GaWVsZCwgZmFsc2UpPy5maWxlPy5wYXRoID8/IFwiXCI7XG4gICAgY29uc3QgdHJlZSA9IHN5bnRheFRyZWUodmlldy5zdGF0ZSk7XG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyBSYW5nZVNldEJ1aWxkZXIoKTtcblxuICAgIGZvciAoY29uc3QgeyBmcm9tLCB0byB9IG9mIHZpZXcudmlzaWJsZVJhbmdlcykge1xuICAgICAgY29uc3QgdGV4dCA9IHZpZXcuc3RhdGUuc2xpY2VEb2MoZnJvbSwgdG8pO1xuICAgICAgV0lLSUxJTktfUEFUVEVSTi5sYXN0SW5kZXggPSAwO1xuICAgICAgZm9yIChsZXQgbWF0Y2g7IChtYXRjaCA9IFdJS0lMSU5LX1BBVFRFUk4uZXhlYyh0ZXh0KSk7ICkge1xuICAgICAgICBjb25zdCBzdGFydCA9IGZyb20gKyBtYXRjaC5pbmRleDtcbiAgICAgICAgLy8gTnVyLCB3YXMgT2JzaWRpYW5zIE1hcmtkb3duLVBhcnNlciBzZWxic3QgYWxzIGludGVybmVuIExpbmsgZXJrZW5udCAtXG4gICAgICAgIC8vIHNjaGxpZVx1MDBERnQgei4gQi4gW1tcdTIwMjZdXSBpbiBDb2RlLUJsXHUwMEY2Y2tlbiBvZGVyIElubGluZS1Db2RlIGF1cy5cbiAgICAgICAgaWYgKCF0cmVlLnJlc29sdmVJbm5lcihzdGFydCArIDIsIDEpLm5hbWUuaW5jbHVkZXMoXCJobWQtaW50ZXJuYWwtbGlua1wiKSkgY29udGludWU7XG4gICAgICAgIGNvbnN0IGNvbG9yID0gY29sb3JGb3JMaW5rdGV4dChwbHVnaW4sIG1hdGNoWzFdLCBzb3VyY2VQYXRoKTtcbiAgICAgICAgaWYgKGNvbG9yKSBidWlsZGVyLmFkZChzdGFydCwgc3RhcnQgKyBtYXRjaFswXS5sZW5ndGgsIGRlY29yYXRpb25Gb3IoY29sb3IpKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGJ1aWxkZXIuZmluaXNoKCk7XG4gIH07XG5cbiAgcmV0dXJuIFZpZXdQbHVnaW4uZnJvbUNsYXNzKFxuICAgIGNsYXNzIHtcbiAgICAgIGNvbnN0cnVjdG9yKHZpZXcpIHtcbiAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IGJ1aWxkKHZpZXcpO1xuICAgICAgfVxuXG4gICAgICAvLyBEZXIgUGFyc2VyIGFyYmVpdGV0IGRlbiBzaWNodGJhcmVuIEJlcmVpY2ggZ2dmLiBlcnN0IG5hY2ggdW5kIG5hY2ggYWIgLVxuICAgICAgLy8gZWluIG5ldWVyIFN5bnRheGJhdW0gelx1MDBFNGhsdCBkYWhlciBlYmVuZmFsbHMgYWxzIEFubGFzcyB6dW0gTmV1YXVmYmF1LlxuICAgICAgdXBkYXRlKHVwZGF0ZSkge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgdXBkYXRlLmRvY0NoYW5nZWQgfHxcbiAgICAgICAgICB1cGRhdGUudmlld3BvcnRDaGFuZ2VkIHx8XG4gICAgICAgICAgc3ludGF4VHJlZSh1cGRhdGUuc3RhcnRTdGF0ZSkgIT09IHN5bnRheFRyZWUodXBkYXRlLnN0YXRlKSB8fFxuICAgICAgICAgIHVwZGF0ZS50cmFuc2FjdGlvbnMuc29tZSgodHIpID0+IHRyLmVmZmVjdHMuc29tZSgoZWZmZWN0KSA9PiBlZmZlY3QuaXMocmVmcmVzaEVmZmVjdCkpKVxuICAgICAgICApIHtcbiAgICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gYnVpbGQodXBkYXRlLnZpZXcpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcbiAgICB7IGRlY29yYXRpb25zOiAodmFsdWUpID0+IHZhbHVlLmRlY29yYXRpb25zIH1cbiAgKTtcbn1cblxuZnVuY3Rpb24gcmVmcmVzaEVkaXRvcnMocGx1Z2luKSB7XG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLml0ZXJhdGVBbGxMZWF2ZXMoKGxlYWYpID0+IHtcbiAgICBsZWFmLnZpZXc/LmVkaXRvcj8uY20/LmRpc3BhdGNoKHsgZWZmZWN0czogcmVmcmVzaEVmZmVjdC5vZihudWxsKSB9KTtcbiAgfSk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiByZWdpc3RlckxpbmtDb2xvcnMocGx1Z2luKSB7XG4gIHBsdWdpbi5yZWdpc3Rlck1hcmtkb3duUG9zdFByb2Nlc3NvcigoZWwsIGN0eCkgPT4ge1xuICAgIC8vIFF1ZWxsZSBpbW1lciB2ZXJtZXJrZW4sIGF1Y2ggYmVpIGF1c2dlc2NoYWx0ZXRlciBFaW5mXHUwMEU0cmJ1bmcgLSBzbyBncmVpZnRcbiAgICAvLyBlaW4gc3BcdTAwRTR0ZXJlcyBFaW5zY2hhbHRlbiBhdWNoIGZcdTAwRkNyIGJlcmVpdHMgZ2VyZW5kZXJ0ZSBMaW5rcy5cbiAgICBmb3IgKGNvbnN0IGFuY2hvckVsIG9mIGVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCJhLmludGVybmFsLWxpbmtcIikpIHtcbiAgICAgIGFuY2hvckVsLnNldEF0dHJpYnV0ZShTT1VSQ0VfQVRUUiwgY3R4LnNvdXJjZVBhdGgpO1xuICAgICAgYXBwbHlUb0FuY2hvcihwbHVnaW4sIGFuY2hvckVsKTtcbiAgICB9XG4gIH0pO1xuICAvLyBPYnNpZGlhbnMgU3ludGF4LVNwYW4gXCIuY20taG1kLWludGVybmFsLWxpbmtcIiBsaWVndCB1bmFiaFx1MDBFNG5naWcgdm9uIGRlclxuICAvLyBQcmlvcml0XHUwMEU0dCBpbW1lciBhdVx1MDBERmVuLCBkaWUgTWFya2llcnVuZyBhbHNvIGRhcmluIC0gZGllIEZhcmJlIHNldHp0IGRhaGVyXG4gIC8vIGVpbmUgZWlnZW5lIFJlZ2VsIGluIHN0eWxlcy5jc3MgKC5mcmVkLXR5cC1saW5rKS4gTmllZHJpZ3N0ZSBQcmlvcml0XHUwMEU0dCBsZWd0XG4gIC8vIHNpZSBpbW1lcmhpbiB1bSBcIi5jbS11bmRlcmxpbmVcIiBoZXJ1bSwgZGFtaXQgZGVyIGdhbnplIExpbmt0ZXh0IGVyZmFzc3QgaXN0LlxuICBwbHVnaW4ucmVnaXN0ZXJFZGl0b3JFeHRlbnNpb24oUHJlYy5sb3dlc3QoYnVpbGRMaW5rVmlld1BsdWdpbihwbHVnaW4pKSk7XG5cbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IHtcbiAgICByZWZyZXNoUmVuZGVyZWRMaW5rcyhwbHVnaW4pO1xuICAgIHJlZnJlc2hFZGl0b3JzKHBsdWdpbik7XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIC8vIERpZSBFZGl0b3ItRGVrb3JhdGlvbmVuIHZlcnNjaHdpbmRlbiBiZWltIEVudGxhZGVuIG1pdCBkZXIgRXJ3ZWl0ZXJ1bmcgdm9uXG4gIC8vIHNlbGJzdCwgZGllIElubGluZS1WYXJpYWJsZW4gYW4gZ2VyZW5kZXJ0ZW4gTGlua3MgbmljaHQuXG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4ge1xuICAgICAgZm9yIChjb25zdCBhbmNob3JFbCBvZiBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChgYS5pbnRlcm5hbC1saW5rWyR7U09VUkNFX0FUVFJ9XWApKSB7XG4gICAgICAgIGFuY2hvckVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KENPTE9SX1ZBUik7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyTGlua0NvbG9ycyB9O1xuIiwgImNvbnN0IFRZUF9QUk9QRVJUWSA9IFwiVFlQXCI7XG5jb25zdCBUWVBfVklFV19UWVBFID0gXCJmcmVkLXR5cC12aWV3XCI7XG5jb25zdCBBTExfUFJPUEVSVElFU19WSUVXX1RZUEUgPSBcImFsbC1wcm9wZXJ0aWVzXCI7XG5jb25zdCBISUdITElHSFRfQ0xBU1MgPSBcImZyZWQtdHlwLWRlZmF1bHQtcHJvcGVydHlcIjtcbi8vIEZsb2F0aW5nIFByb3BlcnRpZXMgKHNpZWhlIHR5cGVGbG9hdGluZ0tleXMgaW4gc2V0dGluZ3MuanMpIC0gZGllc2VsYmVcbi8vIExpc3RlIHdpZSBkaWUgXHUwMEZDYnJpZ2VuIFN0YW5kYXJkLVByb3BlcnRpZXMgZGVzIFR5cHMsIGFiZXIga3Vyc2l2IHN0YXR0IGZldHRcbi8vIG1hcmtpZXJ0LCBhbmFsb2cgenUgSElHSExJR0hUX0NMQVNTLlxuY29uc3QgRkxPQVRJTkdfQ0xBU1MgPSBcImZyZWQtdHlwLWZsb2F0aW5nLXByb3BlcnR5XCI7XG5cbi8vIE9ic2lkaWFuIHNjaHJlaWJ0IGRhdGEtcHJvcGVydHkta2V5IGludGVybiBpbW1lciBrbGVpbiAodW5hYmhcdTAwRTRuZ2lnIHZvbiBkZXJcbi8vIFNjaHJlaWJ3ZWlzZSBpbSBZQU1MKSAtIFZlcmdsZWljaCBkZXNoYWxiIGViZW5mYWxscyBjYXNlLWluc2Vuc2l0aXZlLiBUWVBcbi8vIGlzdCBrZWluZSBlY2h0ZSBcIlN0YW5kYXJkXCItUHJvcGVydHkgKGlociBXZXJ0IGlzdCBpbW1lciBkZXIgVFlQLU5hbWVcbi8vIHNlbGJzdCkgLSBmYWxscyBkb2NoIG5vY2ggaXJnZW5kd28gZWluIGFsdGVyIEVpbnRyYWcgaGVydW1saWVndCwgaGllclxuLy8gZWJlbmZhbGxzIGlnbm9yaWVyZW4gc3RhdHQgZGllIFRZUC1aZWlsZSBmZXR0IHp1IG1hcmtpZXJlbi5cbmZ1bmN0aW9uIHJhd0tleXNGb3JUeXBlKHR5cGUsIGRlZmF1bHRzKSB7XG4gIGlmICghdHlwZSB8fCAhZGVmYXVsdHMpIHJldHVybiBudWxsO1xuICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMoZGVmYXVsdHMpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIgJiYga2V5LnRvTG93ZXJDYXNlKCkgIT09IFRZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpKTtcbiAgcmV0dXJuIGtleXMubGVuZ3RoID4gMCA/IGtleXMubWFwKChrZXkpID0+IGtleS50b0xvd2VyQ2FzZSgpKSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGZsb2F0aW5nS2V5U2V0KHBsdWdpbiwgdHlwZSkge1xuICByZXR1cm4gbmV3IFNldCgocGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV0gPz8gW10pLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkpO1xufVxuXG4vLyBMaWVmZXJ0IGdldHJlbm50ZSBTZXRzIGZcdTAwRkNyIGZldHQgZGFyenVzdGVsbGVuZGUgKFwic3RhbmRhcmRcIikgdW5kIGt1cnNpdlxuLy8gZGFyenVzdGVsbGVuZGUgKFwiZmxvYXRpbmdcIikgUHJvcGVydHktTmFtZW4gKGpld2VpbHMgbG93ZXJjYXNlKSAtIGJlaWRlXG4vLyBzdGFtbWVuIGF1cyBkZXJzZWxiZW4gdHlwZURlZmF1bHRGcm9udG1hdHRlci1MaXN0ZSwgRmxvYXRpbmctbWFya2llcnRlIEtleXNcbi8vIHpcdTAwRTRobGVuIGRhYmVpIG51ciB6dSBcImZsb2F0aW5nXCIsIG5pZSB6dXNcdTAwRTR0emxpY2ggenUgXCJzdGFuZGFyZFwiLlxuZnVuY3Rpb24ga2V5c0ZvclR5cGUocGx1Z2luLCB0eXBlKSB7XG4gIGlmICghcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0cykgcmV0dXJuIHsgc3RhbmRhcmQ6IG51bGwsIGZsb2F0aW5nOiBudWxsIH07XG4gIGlmICghdHlwZSkgcmV0dXJuIHsgc3RhbmRhcmQ6IG51bGwsIGZsb2F0aW5nOiBudWxsIH07XG4gIGNvbnN0IGFsbEtleXMgPSByYXdLZXlzRm9yVHlwZSh0eXBlLCBwbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSk7XG4gIGlmICghYWxsS2V5cykgcmV0dXJuIHsgc3RhbmRhcmQ6IG51bGwsIGZsb2F0aW5nOiBudWxsIH07XG4gIGNvbnN0IGZsb2F0aW5nID0gZmxvYXRpbmdLZXlTZXQocGx1Z2luLCB0eXBlKTtcbiAgY29uc3Qgc3RhbmRhcmRLZXlzID0gYWxsS2V5cy5maWx0ZXIoKGtleSkgPT4gIWZsb2F0aW5nLmhhcyhrZXkpKTtcbiAgY29uc3QgZmxvYXRpbmdLZXlzID0gYWxsS2V5cy5maWx0ZXIoKGtleSkgPT4gZmxvYXRpbmcuaGFzKGtleSkpO1xuICByZXR1cm4ge1xuICAgIHN0YW5kYXJkOiBzdGFuZGFyZEtleXMubGVuZ3RoID4gMCA/IG5ldyBTZXQoc3RhbmRhcmRLZXlzKSA6IG51bGwsXG4gICAgZmxvYXRpbmc6IGZsb2F0aW5nS2V5cy5sZW5ndGggPiAwID8gbmV3IFNldChmbG9hdGluZ0tleXMpIDogbnVsbCxcbiAgfTtcbn1cblxuZnVuY3Rpb24ga2V5c0ZvckZpbGUocGx1Z2luLCBmaWxlKSB7XG4gIHJldHVybiBrZXlzRm9yVHlwZShwbHVnaW4sIHBsdWdpbi50eXBJbmRleC50eXBlT2YoZmlsZSkpO1xufVxuXG4vLyBQcm9wZXJ0eS1OYW1lIChsb3dlcmNhc2UpIC0+IFNldCBkZXIgVHlwZW4sIGluIGRlcmVuIFN0YW5kYXJkLUZyb250bWF0dGVyXG4vLyBlciB2b3Jrb21tdC4gRGllIFwiQWxsIFByb3BlcnRpZXNcIi1BbnNpY2h0IGlzdCB2YXVsdC13ZWl0IHVuZCBrZW5udCBrZWluZW5cbi8vIGVpbnplbG5lbiBUWVAtS29udGV4dCAtIGRhaGVyIGhpZXIgc3RhdHQgZWluZXMgZWluemVsbmVuIEZldHQtRmxhZ3MgZ2xlaWNoXG4vLyBkaWUgdm9sbHN0XHUwMEU0bmRpZ2UgWnVvcmRudW5nIHNhbW1lbG4sIGRhbWl0IGFwcGx5VG9BbGxQcm9wZXJ0aWVzVmlldyB6d2lzY2hlblxuLy8gXCJnZW5hdSBlaW4gVHlwXCIgKGVpbmZcdTAwRTRyYmVuKSB1bmQgXCJtZWhyZXJlIFR5cGVuXCIgKGZldHQpIHVudGVyc2NoZWlkZW4ga2Fubi5cbi8vIEVpZ2VuZXIgU2NoYWx0ZXIgKGNvbG9yVmlld3MuYWxsUHJvcGVydGllcyksIHVuYWJoXHUwMEU0bmdpZyB2b25cbi8vIGNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0cy5cbmZ1bmN0aW9uIHR5cGVzVXNpbmdLZXlNYXAocGx1Z2luKSB7XG4gIGNvbnN0IG1hcCA9IG5ldyBNYXAoKTtcbiAgaWYgKCFwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzKSByZXR1cm4gbWFwO1xuICBmb3IgKGNvbnN0IFt0eXBlLCBkZWZhdWx0c10gb2YgT2JqZWN0LmVudHJpZXMocGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXIpKSB7XG4gICAgY29uc3Qga2V5cyA9IHJhd0tleXNGb3JUeXBlKHR5cGUsIGRlZmF1bHRzKTtcbiAgICBpZiAoIWtleXMpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICAgIGlmICghbWFwLmhhcyhrZXkpKSBtYXAuc2V0KGtleSwgbmV3IFNldCgpKTtcbiAgICAgIG1hcC5nZXQoa2V5KS5hZGQodHlwZSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBtYXA7XG59XG5cbi8vIE51ciBkYXMgTGFiZWwgKFByb3BlcnR5LUtleS1JbnB1dCkgZmV0dC9rdXJzaXYgbWFya2llcmVuLCBuaWNodCBkaWUgV2VydGUgLVxuLy8gYmV0cmlmZnQgc293b2hsIE5vdGl6ZW4gKEZyb250bWF0dGVyIGltIERva3VtZW50ICsgXCJQcm9wZXJ0aWVzXCItXG4vLyBTZWl0ZW5sZWlzdGUpIGFscyBhdWNoIGRpZSBlaWdlbmUgVFlQLURldGFpbGFuc2ljaHQgZGVzIFBsdWdpbnMgc2VsYnN0LlxuZnVuY3Rpb24gYXBwbHlUb0NvbnRhaW5lcihjb250YWluZXJFbCwgc3RhbmRhcmRLZXlzLCBmbG9hdGluZ0tleXMpIHtcbiAgaWYgKCFjb250YWluZXJFbCkgcmV0dXJuO1xuICBjb25zdCByb3dzID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChcIi5tZXRhZGF0YS1wcm9wZXJ0eVtkYXRhLXByb3BlcnR5LWtleV1cIik7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBjb25zdCBrZXlFbCA9IHJvdy5xdWVyeVNlbGVjdG9yKFwiLm1ldGFkYXRhLXByb3BlcnR5LWtleS1pbnB1dFwiKTtcbiAgICBpZiAoIWtleUVsKSBjb250aW51ZTtcbiAgICBjb25zdCBwcm9wZXJ0eUtleSA9IHJvdy5nZXRBdHRyaWJ1dGUoXCJkYXRhLXByb3BlcnR5LWtleVwiKTtcbiAgICBrZXlFbC5jbGFzc0xpc3QudG9nZ2xlKEhJR0hMSUdIVF9DTEFTUywgISFzdGFuZGFyZEtleXMgJiYgc3RhbmRhcmRLZXlzLmhhcyhwcm9wZXJ0eUtleSkpO1xuICAgIGtleUVsLmNsYXNzTGlzdC50b2dnbGUoRkxPQVRJTkdfQ0xBU1MsICEhZmxvYXRpbmdLZXlzICYmIGZsb2F0aW5nS2V5cy5oYXMocHJvcGVydHlLZXkpKTtcbiAgfVxufVxuXG4vLyBEaWUgXCJBbGwgUHJvcGVydGllc1wiLUFuc2ljaHQgcmVuZGVydCBpaHJlIFplaWxlbiBuaWNodCBcdTAwRkNiZXIgZGFzXG4vLyBNZXRhZGF0YS1XaWRnZXQsIHNvbmRlcm4gXHUwMEZDYmVyIGVpZ2VuZSBUcmVlLUl0ZW0tS29tcG9uZW50ZW4gKEtsYXNzZSBcImFIXCIgaW1cbi8vIGdlYmF1dGVuIGFwcC5qcyksIGVycmVpY2hiYXIgXHUwMEZDYmVyIHZpZXcuZG9tcyAoUHJvcGVydHktTmFtZSAtPiBLb21wb25lbnRlKS5cbi8vIERlcmVuIFRpdGVsLUVsZW1lbnQgdHJcdTAwRTRndCBkaWUgS2xhc3NlIFwidHJlZS1pdGVtLWlubmVyLXRleHRcIiwgbmljaHRcbi8vIFwiLm1ldGFkYXRhLXByb3BlcnR5LWtleS1pbnB1dFwiIHdpZSBpbSBGcm9udG1hdHRlci1XaWRnZXQuXG4vL1xuLy8gTnV0enQgZ2VuYXUgZWluIFR5cCBkaWVzZSBQcm9wZXJ0eSBhbHMgU3RhbmRhcmQsIHdpcmQgZGVyIE5hbWUgaW4gZGVzc2VuXG4vLyBGYXJiZSBlaW5nZWZcdTAwRTRyYnQgKHdpZSBkZXIgRmFyYnB1bmt0L2RpZSBMaXN0ZSBkZXMgVHlwcykgLSBlaW5kZXV0aWcgZ2VudWcsXG4vLyB1bSBzaWUgenV6dW9yZG5lbi4gTnV0emVuIG1laHJlcmUgVHlwZW4gc2llLCB3XHUwMEU0cmUgZWluZSBlaW56ZWxuZSBGYXJiZVxuLy8gaXJyZWZcdTAwRkNocmVuZCwgZGFoZXIgc3RhdHRkZXNzZW4gZmV0dCAoZGllc2VsYmUgTWFya2llcnVuZyB3aWUgaW1cbi8vIEZyb250bWF0dGVyLVdpZGdldCBlaW5lciBOb3RpeikuXG5mdW5jdGlvbiBhcHBseVRvQWxsUHJvcGVydGllc1ZpZXcocGx1Z2luKSB7XG4gIGNvbnN0IHVzYWdlTWFwID0gdHlwZXNVc2luZ0tleU1hcChwbHVnaW4pO1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEFMTF9QUk9QRVJUSUVTX1ZJRVdfVFlQRSkpIHtcbiAgICBjb25zdCBkb21zID0gbGVhZi52aWV3Py5kb21zO1xuICAgIGlmICghZG9tcykgY29udGludWU7XG4gICAgZm9yIChjb25zdCBba2V5LCBkb21dIG9mIE9iamVjdC5lbnRyaWVzKGRvbXMpKSB7XG4gICAgICBjb25zdCB0aXRsZUVsID0gZG9tPy50aXRsZUVsO1xuICAgICAgaWYgKCF0aXRsZUVsKSBjb250aW51ZTtcblxuICAgICAgY29uc3QgdHlwZXMgPSB1c2FnZU1hcC5nZXQoa2V5LnRvTG93ZXJDYXNlKCkpO1xuICAgICAgY29uc3QgY291bnQgPSB0eXBlcyA/IHR5cGVzLnNpemUgOiAwO1xuICAgICAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKEhJR0hMSUdIVF9DTEFTUywgY291bnQgPiAxKTtcblxuICAgICAgLy8gS3Vyc2l2IG51ciwgd2VubiBlaW5kZXV0aWcgZ2VuYXUgZWluIFRZUCBkaWUgUHJvcGVydHkgbnV0enQgVU5EIHNpZVxuICAgICAgLy8gZG9ydCBhbHMgRmxvYXRpbmcgbWFya2llcnQgaXN0IC0gYmVpIG1laHJlcmVuIFRZUHMgKEZldHQtRmFsbCkgd1x1MDBFNHJlXG4gICAgICAvLyBuaWNodCBrbGFyLCB3ZXNzZW4gRmxvYXRpbmctTWFya2llcnVuZyBnZW1laW50IGlzdC5cbiAgICAgIGxldCBpc0Zsb2F0aW5nID0gZmFsc2U7XG4gICAgICBpZiAoY291bnQgPT09IDEpIHtcbiAgICAgICAgY29uc3QgW29ubHlUeXBlXSA9IHR5cGVzO1xuICAgICAgICBpc0Zsb2F0aW5nID0gZmxvYXRpbmdLZXlTZXQocGx1Z2luLCBvbmx5VHlwZSkuaGFzKGtleS50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1tvbmx5VHlwZV07XG4gICAgICAgIC8vICFpbXBvcnRhbnQgdmlhIHNldFByb3BlcnR5LCBkYSBkaWUgRmV0dC1SZWdlbCBmXHUwMEZDciAuZnJlZC10eXAtZGVmYXVsdC1cbiAgICAgICAgLy8gcHJvcGVydHkgaW4gc3R5bGVzLmNzcyBlYmVuZmFsbHMgIWltcG9ydGFudCBjb2xvciBzZXR6dCB1bmQgZWluXG4gICAgICAgIC8vIElubGluZS1TdHlsZSBvaG5lICFpbXBvcnRhbnQgZGFnZWdlbiB2ZXJsaWVyZW4gd1x1MDBGQ3JkZSwgZmFsbHMgZGllXG4gICAgICAgIC8vIEtsYXNzZSAoYXVzIGVpbmVtIHZvcmhlcmlnZW4gWnVzdGFuZCBtaXQgbWVocmVyZW4gVHlwZW4pIG5vY2ggZHJhbmhcdTAwRTRuZ3QuXG4gICAgICAgIGlmIChjb2xvcikgdGl0bGVFbC5zdHlsZS5zZXRQcm9wZXJ0eShcImNvbG9yXCIsIGNvbG9yLCBcImltcG9ydGFudFwiKTtcbiAgICAgICAgZWxzZSB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG4gICAgICB9XG4gICAgICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoRkxPQVRJTkdfQ0xBU1MsIGlzRmxvYXRpbmcpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBseUZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodChwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgY29uc3QgdmlldyA9IGxlYWYudmlldztcbiAgICBjb25zdCB7IHN0YW5kYXJkLCBmbG9hdGluZyB9ID0ga2V5c0ZvckZpbGUocGx1Z2luLCB2aWV3Py5maWxlKTtcbiAgICBhcHBseVRvQ29udGFpbmVyKHZpZXc/Lm1ldGFkYXRhRWRpdG9yPy5jb250YWluZXJFbCwgc3RhbmRhcmQsIGZsb2F0aW5nKTtcbiAgfVxuXG4gIC8vIERpZSBcIlByb3BlcnRpZXNcIi1TZWl0ZW5sZWlzdGUgemVpZ3QgaW1tZXIgZGllIGFrdGl2ZSBEYXRlaSwgaFx1MDBFNGx0IGFiZXJcbiAgLy8ga2VpbmUgZWlnZW5lLCB2ZXJsXHUwMEU0c3NsaWNoZSBSZWZlcmVueiBkYXJhdWYgZ3JpZmZiZXJlaXQgd2llIE1hcmtkb3duVmlldyAtXG4gIC8vIGRhaGVyIGF1ZiBkaWUgdm9tIFdvcmtzcGFjZSBha3R1ZWxsIGFrdGl2ZSBEYXRlaSB6dXJcdTAwRkNja2ZhbGxlbi5cbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcImZpbGUtcHJvcGVydGllc1wiKSkge1xuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XG4gICAgY29uc3QgZmlsZSA9IHZpZXc/LmZpbGUgPz8gcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgIGNvbnN0IHsgc3RhbmRhcmQsIGZsb2F0aW5nIH0gPSBrZXlzRm9yRmlsZShwbHVnaW4sIGZpbGUpO1xuICAgIGFwcGx5VG9Db250YWluZXIodmlldz8ubWV0YWRhdGFFZGl0b3I/LmNvbnRhaW5lckVsLCBzdGFuZGFyZCwgZmxvYXRpbmcpO1xuICB9XG5cbiAgLy8gVFlQLURldGFpbGFuc2ljaHQgZGVzIFBsdWdpbnMgc2VsYnN0OiBkb3J0IHplaWd0IGRlciBFZGl0b3IgZGlyZWt0IGRhc1xuICAvLyBTdGFuZGFyZC1Gcm9udG1hdHRlciBkZXMgZ2VyYWRlIGF1c2dld1x1MDBFNGhsdGVuIFR5cHMsIGVudHNwcmljaHQgYWxzbyAxOjFcbiAgLy8gZGVuIFwiU3RhbmRhcmRcIi0gYnp3LiBcIkZsb2F0aW5nXCItUHJvcGVydGllcyAodmlldy5zZWxlY3RlZFR5cGUvXG4gIC8vIC5mcm9udG1hdHRlckVkaXRvciBrb21tZW4gYXVzIHR5cC12aWV3LmpzKS5cbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShUWVBfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XG4gICAgY29uc3QgeyBzdGFuZGFyZCwgZmxvYXRpbmcgfSA9IGtleXNGb3JUeXBlKHBsdWdpbiwgdmlldz8uc2VsZWN0ZWRUeXBlKTtcbiAgICBhcHBseVRvQ29udGFpbmVyKHZpZXc/LmZyb250bWF0dGVyRWRpdG9yPy5jb250YWluZXJFbCwgc3RhbmRhcmQsIGZsb2F0aW5nKTtcbiAgfVxuXG4gIGFwcGx5VG9BbGxQcm9wZXJ0aWVzVmlldyhwbHVnaW4pO1xufVxuXG5mdW5jdGlvbiByZWdpc3RlckZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodChwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5RnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0KHBsdWdpbik7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLm9uKFwiY2hhbmdlZFwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5vbihcInJlc29sdmVkXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJhY3RpdmUtbGVhZi1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaCk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodCB9O1xuIiwgImNvbnN0IHsgTm90aWNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5cbmNvbnN0IFRZUF9QUk9QRVJUWSA9IFwiVFlQXCI7XG5cbi8vIE9ic2lkaWFuIHNjaHJlaWJ0IFByb3BlcnR5LU5hbWVuIGludGVybiBrbGVpbiAoc2llaGUgZnJvbnRtYXR0ZXItZGVmYXVsdC1cbi8vIGhpZ2hsaWdodC5qcykgLSBadW9yZG51bmcgZGFoZXIgY2FzZS1pbnNlbnNpdGl2LCBkZXIgbmV1ZSBOYW1lIHdpcmQgYWJlclxuLy8gZXhha3Qgc28gXHUwMEZDYmVybm9tbWVuLCB3aWUgZXIgZWluZ2VnZWJlbiB3dXJkZS5cbmZ1bmN0aW9uIHNhbWVLZXkoYSwgYikge1xuICByZXR1cm4gYS50b0xvd2VyQ2FzZSgpID09PSBiLnRvTG93ZXJDYXNlKCk7XG59XG5cbmZ1bmN0aW9uIGlzRW1wdHlWYWx1ZSh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gXCJcIjtcbn1cblxuLy8gQmVuZW5udCBvbGRLZXkgaW4gdHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSB1bSAoUmVpaGVuZm9sZ2UgYmxlaWJ0XG4vLyBlcmhhbHRlbikgdW5kIHppZWh0IGRpZSBGbG9hdGluZy1NYXJraWVydW5nIG1pdC4gR2lidCBlcyBuZXdLZXkgZG9ydCBiZXJlaXRzXG4vLyAoWnVzYW1tZW5sZWdlbiwgYW5hbG9nIHp1IE9ic2lkaWFucyBlaWdlbmVtIE1lcmdlIGluIGRlbiBOb3RpemVuKSwgYmxlaWJ0IGRlclxuLy8gYmVzdGVoZW5kZSBFaW50cmFnIGFuIHNlaW5lciBQb3NpdGlvbiAtIGRlciBXZXJ0IGRlcyBhbHRlbiBFaW50cmFncyB3aXJkIG51clxuLy8gXHUwMEZDYmVybm9tbWVuLCB3ZW5uIGRlciBiZXN0ZWhlbmRlIGxlZXIgaXN0LiBMaWVmZXJ0IHRydWUgYmVpIGVpbmVyIFx1MDBDNG5kZXJ1bmcuXG5mdW5jdGlvbiByZW5hbWVJblR5cGUoc2V0dGluZ3MsIHR5cGUsIG9sZEtleSwgbmV3S2V5KSB7XG4gIGNvbnN0IGRlZmF1bHRzID0gc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXTtcbiAgaWYgKCFkZWZhdWx0cykgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMoZGVmYXVsdHMpO1xuICBjb25zdCBzb3VyY2VLZXkgPSBrZXlzLmZpbmQoKGtleSkgPT4gc2FtZUtleShrZXksIG9sZEtleSkpO1xuICBpZiAoc291cmNlS2V5ID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTtcbiAgLy8gQmVpIGVpbmVyIHJlaW5lbiBcdTAwQzRuZGVydW5nIGRlciBHcm9cdTAwREYtL0tsZWluc2NocmVpYnVuZyBpc3Qgc291cmNlS2V5IHNlbGJzdFxuICAvLyBkZXIgZWluemlnZSBUcmVmZmVyIGZcdTAwRkNyIG5ld0tleSAtIGRhcyBpc3QgZGFubiBrZWluIFp1c2FtbWVubGVnZW4uXG4gIGNvbnN0IHRhcmdldEtleSA9IGtleXMuZmluZCgoa2V5KSA9PiBrZXkgIT09IHNvdXJjZUtleSAmJiBzYW1lS2V5KGtleSwgbmV3S2V5KSk7XG4gIGlmICh0YXJnZXRLZXkgPT09IHVuZGVmaW5lZCAmJiBzb3VyY2VLZXkgPT09IG5ld0tleSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IG5leHQgPSB7fTtcbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykge1xuICAgIGlmIChrZXkgIT09IHNvdXJjZUtleSkge1xuICAgICAgbmV4dFtrZXldID0gZGVmYXVsdHNba2V5XTtcbiAgICB9IGVsc2UgaWYgKHRhcmdldEtleSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBuZXh0W25ld0tleV0gPSBkZWZhdWx0c1tzb3VyY2VLZXldO1xuICAgIH1cbiAgfVxuICBpZiAodGFyZ2V0S2V5ICE9PSB1bmRlZmluZWQgJiYgaXNFbXB0eVZhbHVlKG5leHRbdGFyZ2V0S2V5XSkpIG5leHRbdGFyZ2V0S2V5XSA9IGRlZmF1bHRzW3NvdXJjZUtleV07XG4gIHNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0gPSBuZXh0O1xuXG4gIGNvbnN0IGZsb2F0aW5nID0gc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXTtcbiAgaWYgKGZsb2F0aW5nKSB7XG4gICAgLy8gQmVpbSBadXNhbW1lbmxlZ2VuIGJsZWlidCBkaWUgRmxvYXRpbmctTWFya2llcnVuZyBkZXMgWmllbHMgbWFcdTAwREZnZWJsaWNoLlxuICAgIGNvbnN0IG5leHRGbG9hdGluZyA9XG4gICAgICB0YXJnZXRLZXkgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IGZsb2F0aW5nLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IHNvdXJjZUtleSlcbiAgICAgICAgOiBmbG9hdGluZy5tYXAoKGtleSkgPT4gKGtleSA9PT0gc291cmNlS2V5ID8gbmV3S2V5IDoga2V5KSk7XG4gICAgaWYgKG5leHRGbG9hdGluZy5sZW5ndGggPiAwKSBzZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdID0gbmV4dEZsb2F0aW5nO1xuICAgIGVsc2UgZGVsZXRlIHNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV07XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbi8vIEVpbnplbC1Qcm9wZXJ0eS1FaW50clx1MDBFNGdlIGRlciBnbG9iYWxlbiBSZWloZW5mb2xnZSAtIGRvcnQgc2luZCBrZWluZVxuLy8gRG9wcGx1bmdlbiBlcmxhdWJ0LCBlaW4gYmVyZWl0cyB2b3JoYW5kZW5lciBaaWVsZWludHJhZyBiZWhcdTAwRTRsdCBkYWhlciBzZWluZVxuLy8gUG9zaXRpb24gdW5kIGRlciBhbHRlIGVudGZcdTAwRTRsbHQuXG5mdW5jdGlvbiByZW5hbWVJbkdsb2JhbE9yZGVyKHNldHRpbmdzLCBvbGRLZXksIG5ld0tleSkge1xuICBjb25zdCBvcmRlciA9IHNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXI7XG4gIGNvbnN0IHNvdXJjZSA9IG9yZGVyLmZpbmQoKGVudHJ5KSA9PiBlbnRyeS5raW5kID09PSBcInByb3BlcnR5XCIgJiYgc2FtZUtleShlbnRyeS5uYW1lLCBvbGRLZXkpKTtcbiAgaWYgKCFzb3VyY2UpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgdGFyZ2V0ID0gb3JkZXIuZmluZCgoZW50cnkpID0+IGVudHJ5ICE9PSBzb3VyY2UgJiYgZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiICYmIHNhbWVLZXkoZW50cnkubmFtZSwgbmV3S2V5KSk7XG4gIGlmICh0YXJnZXQpIHNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIgPSBvcmRlci5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeSAhPT0gc291cmNlKTtcbiAgZWxzZSBpZiAoc291cmNlLm5hbWUgPT09IG5ld0tleSkgcmV0dXJuIGZhbHNlO1xuICBlbHNlIHNvdXJjZS5uYW1lID0gbmV3S2V5O1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc3luY1JlbmFtZShwbHVnaW4sIG9sZEtleSwgbmV3S2V5KSB7XG4gIGlmICh0eXBlb2Ygb2xkS2V5ICE9PSBcInN0cmluZ1wiIHx8IHR5cGVvZiBuZXdLZXkgIT09IFwic3RyaW5nXCIpIHJldHVybjtcbiAgbmV3S2V5ID0gbmV3S2V5LnRyaW0oKTtcbiAgaWYgKG9sZEtleSA9PT0gXCJcIiB8fCBuZXdLZXkgPT09IFwiXCIgfHwgb2xkS2V5ID09PSBuZXdLZXkpIHJldHVybjtcbiAgLy8gVFlQIGlzdCBuaWUgVGVpbCBkZXMgU3RhbmRhcmQtRnJvbnRtYXR0ZXJzIChzaWVoZSBzdHJpcFR5cFByb3BlcnR5IGluXG4gIC8vIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKSAtIGVpbiBVbWJlbmVubmVuIHZvbi9uYWNoIFRZUCBkYWhlciBpZ25vcmllcmVuLlxuICBpZiAoc2FtZUtleShvbGRLZXksIFRZUF9QUk9QRVJUWSkgfHwgc2FtZUtleShuZXdLZXksIFRZUF9QUk9QRVJUWSkpIHJldHVybjtcblxuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XG4gIGxldCB0eXBlQ291bnQgPSAwO1xuICBmb3IgKGNvbnN0IHR5cGUgb2YgT2JqZWN0LmtleXMoc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlcikpIHtcbiAgICBpZiAocmVuYW1lSW5UeXBlKHNldHRpbmdzLCB0eXBlLCBvbGRLZXksIG5ld0tleSkpIHR5cGVDb3VudCsrO1xuICB9XG4gIGNvbnN0IG9yZGVyQ2hhbmdlZCA9IHJlbmFtZUluR2xvYmFsT3JkZXIoc2V0dGluZ3MsIG9sZEtleSwgbmV3S2V5KTtcbiAgaWYgKHR5cGVDb3VudCA9PT0gMCAmJiAhb3JkZXJDaGFuZ2VkKSByZXR1cm47XG5cbiAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICBwbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG5cbiAgY29uc3QgcGFydHMgPSBbXTtcbiAgaWYgKHR5cGVDb3VudCA+IDApIHBhcnRzLnB1c2goYCR7dHlwZUNvdW50fSBUWVAke3R5cGVDb3VudCA9PT0gMSA/IFwiXCIgOiBcImVuXCJ9YCk7XG4gIGlmIChvcmRlckNoYW5nZWQpIHBhcnRzLnB1c2goXCJnbG9iYWxlciBSZWloZW5mb2xnZVwiKTtcbiAgbmV3IE5vdGljZShgVFlQLVN5c3RlbTogXHUyMDFFJHtvbGRLZXl9XHUyMDFDIFx1MjE5MiBcdTIwMUUke25ld0tleX1cdTIwMUMgaW4gJHtwYXJ0cy5qb2luKFwiIHVuZCBcIil9IHVtYmVuYW5udC5gKTtcbn1cblxuLy8gT2JzaWRpYW5zIFwiQWxsIHByb3BlcnRpZXNcIi1BbnNpY2h0IChhY2NlcHRSZW5hbWUpIHVuZCBCYXNlcyAoTmFtZW5zZmVsZCBlaW5lclxuLy8gbmV1IGFuZ2VsZWd0ZW4gTm90aXotUHJvcGVydHkpIGJlbmVubmVuIFByb3BlcnRpZXMgdmF1bHQtd2VpdCBhdXNzY2hsaWVcdTAwREZsaWNoXG4vLyBcdTAwRkNiZXIgYXBwLmZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5KGFsdCwgbmV1KSB1bSAoc2llaGUgZ2ViYXV0ZXMgYXBwLmpzKSAtXG4vLyBlaW4gV3JhcHBlciBnZW5hdSBkb3J0IGVyZmFzc3QgYWxzbyBqZWRlIGVjaHRlIFVtYmVuZW5udW5nLCBvaG5lIGRpZVxuLy8gamV3ZWlsaWdlbiBWaWV3cyBzZWxic3QgYW5mYXNzZW4genUgbVx1MDBGQ3NzZW4uIEJhc2VzJyBcIkRpc3BsYXkgbmFtZVwiIGZcdTAwRkNyXG4vLyBiZXN0ZWhlbmRlIFByb3BlcnRpZXMgXHUwMEU0bmRlcnQgbnVyIGRpZSAuYmFzZS1EYXRlaSwgbmljaHQgZGllIE5vdGl6ZW4sIHVuZFxuLy8gbFx1MDBFNHVmdCBkZXNoYWxiIChyaWNodGlnZXJ3ZWlzZSkgbmljaHQgaGllciBkdXJjaC5cbmZ1bmN0aW9uIHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jKHBsdWdpbikge1xuICBjb25zdCBmaWxlTWFuYWdlciA9IHBsdWdpbi5hcHAuZmlsZU1hbmFnZXI7XG4gIGlmIChmaWxlTWFuYWdlci5fX2ZyZWRUeXBSZW5hbWVTeW5jUGF0Y2hlZCkgcmV0dXJuO1xuICBmaWxlTWFuYWdlci5fX2ZyZWRUeXBSZW5hbWVTeW5jUGF0Y2hlZCA9IHRydWU7XG5cbiAgY29uc3Qgb3JpZ2luYWwgPSBmaWxlTWFuYWdlci5yZW5hbWVQcm9wZXJ0eTtcbiAgZmlsZU1hbmFnZXIucmVuYW1lUHJvcGVydHkgPSBhc3luYyBmdW5jdGlvbiAob2xkS2V5LCBuZXdLZXksIC4uLnJlc3QpIHtcbiAgICAvLyBXaXJmdCBkYXMgT3JpZ2luYWwgKGFjY2VwdFJlbmFtZSBmXHUwMEU0bmd0IGRhcyBzZWxic3QgYWIpLCBibGVpYmVuIGRpZVxuICAgIC8vIFBsdWdpbi1FaW5zdGVsbHVuZ2VuIHVudmVyXHUwMEU0bmRlcnQuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgb3JpZ2luYWwuY2FsbCh0aGlzLCBvbGRLZXksIG5ld0tleSwgLi4ucmVzdCk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN5bmNSZW5hbWUocGx1Z2luLCBvbGRLZXksIG5ld0tleSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJUWVAtU3lzdGVtOiBQcm9wZXJ0eS1VbWJlbmVubnVuZyBuaWNodCBcdTAwRkNiZXJub21tZW5cIiwgZXJyb3IpO1xuICAgICAgbmV3IE5vdGljZShgVFlQLVN5c3RlbTogVW1iZW5lbm51bmcgdm9uIFx1MjAxRSR7b2xkS2V5fVx1MjAxQyBuaWNodCBcdTAwRkNiZXJub21tZW4gXHUyMDEzICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIGZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5ID0gb3JpZ2luYWw7XG4gICAgZGVsZXRlIGZpbGVNYW5hZ2VyLl9fZnJlZFR5cFJlbmFtZVN5bmNQYXRjaGVkO1xuICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jIH07XG4iLCAiY29uc3QgeyBGdXp6eVN1Z2dlc3RNb2RhbCwgTm90aWNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IERFRkFVTFRfVFlQRV9DT0xPUiwgY29tcGFyZVR5cGVzLCBERUZBVUxUX1NPUlRfT1JERVIgfSA9IHJlcXVpcmUoXCIuL3R5cC12aWV3XCIpO1xuXG4vLyBOYXRpdmVyIEVyc2F0eiBmXHUwMEZDciBUZW1wbGF0ZXJzIHRwLnN5c3RlbS5zdWdnZXN0ZXIgYmVpIGRlciBUWVAtQXVzd2FobCAoc2llaGVcbi8vIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanMpOiBiYXV0IGF1ZiBPYnNpZGlhbnMgZWlnZW5lbVxuLy8gRnV6enlTdWdnZXN0TW9kYWwgYXVmIChkaWVzZWxiZSBCYXNpcywgYXVmIGRlciBhdWNoIFRlbXBsYXRlcnMgU3VnZ2VzdGVyXG4vLyBzZWxic3QgYmVydWh0KSwgemVpZ3QgenVzXHUwMEU0dHpsaWNoIGFiZXIgVFlQLUZhcmJlLy1QdW5rdCwgQmVzY2hyZWlidW5nIHVuZFxuLy8gTm90aXotQW56YWhsIGplIFplaWxlLiBOaWNodCBlcmZhc3N0ZSAoaXRlbS51bnJlZ2lzdGVyZWQpIFRZUGVuIHdlcmRlbiBzdGF0dFxuLy8gaW4gaWhyZXIgKG5pY2h0IGV4aXN0aWVyZW5kZW4pIEZhcmJlIG11dGVkIGRhcmdlc3RlbGx0LCBhbmFsb2cgenVyXG4vLyBUWVAtTGlzdGUgc2VsYnN0IChzaWVoZSAuZnJlZC10eXAtdW5yZWdpc3RlcmVkIGluIHR5cC12aWV3LmpzKS5cbmNsYXNzIFR5cFBpY2tlck1vZGFsIGV4dGVuZHMgRnV6enlTdWdnZXN0TW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbiwgaXRlbXMsIHJlc29sdmUpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICAgIHRoaXMuaXRlbXMgPSBpdGVtcztcbiAgICB0aGlzLnJlc29sdmUgPSByZXNvbHZlO1xuICAgIHRoaXMuY2hvc2VuID0gZmFsc2U7XG4gICAgdGhpcy5zZXRQbGFjZWhvbGRlcihcIkVTQyBmXHUwMEZDciBBYmJydWNoXCIpO1xuICB9XG5cbiAgZ2V0SXRlbXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuaXRlbXM7XG4gIH1cblxuICAvLyBGdXp6eS1TdWNoZSBncmVpZnQgYXVjaCBhdWYgZGllIEJlc2NocmVpYnVuZywgbmljaHQgbnVyIGF1ZiBkZW4gVFlQLU5hbWVuLlxuICBnZXRJdGVtVGV4dChpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0uZGVzY3JpcHRpb24gPyBgJHtpdGVtLnR5cGV9ICR7aXRlbS5kZXNjcmlwdGlvbn1gIDogaXRlbS50eXBlO1xuICB9XG5cbiAgcmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpIHtcbiAgICBjb25zdCBpdGVtID0gbWF0Y2guaXRlbTtcbiAgICBlbC5hZGRDbGFzcyhcImZyZWQtdHlwLXBpY2tlci1zdWdnZXN0aW9uXCIpO1xuICAgIGlmIChpdGVtLnVucmVnaXN0ZXJlZCkgZWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC1waWNrZXItdW5yZWdpc3RlcmVkXCIpO1xuXG4gICAgaWYgKGl0ZW0udW5yZWdpc3RlcmVkKSB7XG4gICAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1uYW1lXCIsIHRleHQ6IGl0ZW0udHlwZSB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgY29sb3IgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW2l0ZW0udHlwZV0gPz8gREVGQVVMVF9UWVBFX0NPTE9SO1xuICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCkge1xuICAgICAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1uYW1lXCIsIHRleHQ6IGl0ZW0udHlwZSB9KS5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItZG90XCIgfSkuc3R5bGUuYmFja2dyb3VuZENvbG9yID0gY29sb3I7XG4gICAgICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLW5hbWVcIiwgdGV4dDogaXRlbS50eXBlIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChpdGVtLmRlc2NyaXB0aW9uKSB7XG4gICAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1kZXNjXCIsIHRleHQ6IGl0ZW0uZGVzY3JpcHRpb24gfSk7XG4gICAgfVxuXG4gICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItY291bnRcIiwgdGV4dDogU3RyaW5nKGl0ZW0uY291bnQpIH0pO1xuICB9XG5cbiAgLy8gT2JzaWRpYW5zIFN1Z2dlc3RNb2RhbC5zZWxlY3RTdWdnZXN0aW9uKCkgcnVmdCBpbnRlcm4gZXJzdCB0aGlzLmNsb3NlKClcbiAgLy8gYXVmIHVuZCBkYW5hY2ggZXJzdCBvbkNob29zZVN1Z2dlc3Rpb24oKS9vbkNob29zZUl0ZW0oKSAtIFwiY2hvc2VuXCIgaGllciB6dVxuICAvLyBzZXR6ZW4gKHN0YXR0IGluIG9uQ2hvb3NlSXRlbSkgaXN0IGRhaGVyIG5pY2h0IGJsb1x1MDBERiBHZXNjaG1hY2tzc2FjaGU6IHdcdTAwRkNyZGVcbiAgLy8gZXMgZXJzdCBpbiBvbkNob29zZUl0ZW0gZ2VzZXR6dCwgaFx1MDBFNHR0ZSBkYXMgY2xvc2UoKS1hdXNnZWxcdTAwRjZzdGUgb25DbG9zZSgpXG4gIC8vIHVudGVuIFwiY2hvc2VuXCIgbm9jaCBhbHMgZmFsc2UgZ2VzZWhlbiB1bmQgZGFzIFByb21pc2UgZlx1MDBFNGxzY2hsaWNoIHNjaG9uIG1pdFxuICAvLyBudWxsIGF1ZmdlbFx1MDBGNnN0LCBiZXZvciBkZXIgZWlnZW50bGljaGUgb25DaG9vc2VJdGVtLUF1ZnJ1ZiBcdTAwRkNiZXJoYXVwdCBsaWVmIC1cbiAgLy8gZGFzIHp3ZWl0ZSByZXNvbHZlKCkgZ3JlaWZ0IGRhbm4gbmljaHQgbWVociAoZWluIFByb21pc2UgbFx1MDBGNnN0IG51ciBlaW5tYWxcbiAgLy8gYXVmKSwgZGFzIEVyZ2VibmlzIHdhciB1bmFiaFx1MDBFNG5naWcgdm9uIGRlciBBdXN3YWhsIGltbWVyIG51bGwuXG4gIHNlbGVjdFN1Z2dlc3Rpb24oaXRlbSwgZXZ0KSB7XG4gICAgdGhpcy5jaG9zZW4gPSB0cnVlO1xuICAgIHN1cGVyLnNlbGVjdFN1Z2dlc3Rpb24oaXRlbSwgZXZ0KTtcbiAgfVxuXG4gIG9uQ2hvb3NlSXRlbShpdGVtKSB7XG4gICAgdGhpcy5yZXNvbHZlKGl0ZW0udHlwZSk7XG4gIH1cblxuICAvLyBFU0MgKG9kZXIgS2xpY2sgZGFuZWJlbikgc2NobGllXHUwMERGdCBkYXMgTW9kYWwgb2huZSBzZWxlY3RTdWdnZXN0aW9uIC0gZGFublxuICAvLyBzdGF0dCBlaW5lcyBoXHUwMEU0bmdlbmRlbiBQcm9taXNlIG1pdCBudWxsIGF1ZmxcdTAwRjZzZW4sIGFuYWxvZyB6dVxuICAvLyB0cC5zeXN0ZW0uc3VnZ2VzdGVyLlxuICBvbkNsb3NlKCkge1xuICAgIHN1cGVyLm9uQ2xvc2UoKTtcbiAgICBpZiAoIXRoaXMuY2hvc2VuKSB0aGlzLnJlc29sdmUobnVsbCk7XG4gIH1cbn1cblxuLy8gTmljaHQgaW4gcGx1Z2luLnNldHRpbmdzLnR5cGVzIHJlZ2lzdHJpZXJ0ZSBUWVBlbiwgZGllIGFiZXIgdGF0c1x1MDBFNGNobGljaCBpblxuLy8gTm90aXplbiB2b3Jrb21tZW4gLSBhbmFsb2cgenUgZGVuIFwidW5yZWdpc3RyaWVydGVuXCIgWmVpbGVuIGRlciBUWVAtTGlzdGVcbi8vIChzaWVoZSB1bnJlZ2lzdGVyZWRSb3dzIGluIHR5cC12aWV3LmpzKS4gS2VpbmUgQmVzY2hyZWlidW5nL0ZhcmJlLCBkYSBmXHUwMEZDclxuLy8gc2llIG5pY2h0cyBkZXJnbGVpY2hlbiBnZXBmbGVndCBpc3QuIExpc3RlbiB1bmQgV2VydGUgbWl0IFJhbmRsZWVyemVpY2hlblxuLy8gKHNpZWhlIGlzQ2xlYW5LZXkgaW4gdHlwLWluZGV4LmpzKSBibGVpYmVuIGF1XHUwMERGZW4gdm9yIC0gZGVyIGdld1x1MDBFNGhsdGUgV2VydFxuLy8gd2lyZCBpbiBlaW5lIG5ldWUgTm90aXogZ2VzY2hyaWViZW4gdW5kIHNvbGwgZG9ydCBrZWluIEF1ZnJcdTAwRTR1bWZhbGwgc2Vpbi5cbmZ1bmN0aW9uIHVucmVnaXN0ZXJlZEl0ZW1zKGFwcCwgcGx1Z2luKSB7XG4gIGNvbnN0IHJlZ2lzdGVyZWQgPSBuZXcgU2V0KHBsdWdpbi5zZXR0aW5ncy50eXBlcyk7XG4gIGNvbnN0IHsgY291bnRzIH0gPSBwbHVnaW4udHlwSW5kZXgudHlwZUNvdW50cygpO1xuICBjb25zdCBzb3J0T3JkZXIgPSBwbHVnaW4uc2V0dGluZ3MudHlwU29ydE9yZGVyID8/IERFRkFVTFRfU09SVF9PUkRFUjtcbiAgcmV0dXJuIFsuLi5jb3VudHMua2V5cygpXVxuICAgIC5maWx0ZXIoKHR5cGUpID0+ICFyZWdpc3RlcmVkLmhhcyh0eXBlKSAmJiBwbHVnaW4udHlwSW5kZXguaXNDbGVhbktleSh0eXBlKSlcbiAgICAuc29ydCgoYSwgYikgPT4gY29tcGFyZVR5cGVzKHNvcnRPcmRlciwgYSwgYiwgY291bnRzLCBwbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9ycykpXG4gICAgLm1hcCgodHlwZSkgPT4gKHsgdHlwZSwgZGVzY3JpcHRpb246IFwiXCIsIGNvdW50OiBjb3VudHMuZ2V0KHR5cGUpID8/IDAsIHVucmVnaXN0ZXJlZDogdHJ1ZSB9KSk7XG59XG5cbi8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanMgc293aWUgXHUwMEZDYmVyYWxsIHNvbnN0IGltIFBsdWdpbiwgd29cbi8vIGVpbiBlaW56ZWxuZXIgVFlQIGF1c2dld1x1MDBFNGhsdCB3ZXJkZW4gbXVzcy4gaW5jbHVkZU1hbnVhbE9mZiB3aWUgYmVpXG4vLyBwbHVnaW4uZ2V0VHlwZXMoKTogVFlQZW4gbWl0IGRlYWt0aXZpZXJ0ZW0gXCJNYW51ZWxsZXIgVFlQXCItU2NoYWx0ZXIgc2luZFxuLy8gc3RhbmRhcmRtXHUwMEU0XHUwMERGaWcgYXVzZ2VrbGFtbWVydC4gaW5jbHVkZVVucmVnaXN0ZXJlZCBlcmdcdTAwRTRuenQgenVzXHUwMEU0dHpsaWNoIFRZUGVuLFxuLy8gZGllIGluIE5vdGl6ZW4gdm9ya29tbWVuLCBhYmVyIG5pY2h0IGluIGRlciBUWVAtTGlzdGUgcmVnaXN0cmllcnQgc2luZCAtXG4vLyBtdXRlZCBkYXJnZXN0ZWxsdCwgZGEgZlx1MDBGQ3Igc2llIGtlaW5lIEZhcmJlL0Jlc2NocmVpYnVuZyBleGlzdGllcnQuIExcdTAwRjZzdCBtaXRcbi8vIGRlbSBnZXdcdTAwRTRobHRlbiBUWVAgYXVmLCBvZGVyIG1pdCBudWxsIGJlaSBBYmJydWNoIGJ6dy4gZmFsbHMgZXMgKGF1Y2ggbWl0XG4vLyBkZW4gZ2V3XHUwMEU0aGx0ZW4gT3B0aW9uZW4pIGtlaW5lIGFuenV6ZWlnZW5kZW4gVFlQZW4gZ2lidC5cbmZ1bmN0aW9uIHBpY2tUeXBlKGFwcCwgcGx1Z2luLCB7IGluY2x1ZGVNYW51YWxPZmYgPSBmYWxzZSwgaW5jbHVkZVVucmVnaXN0ZXJlZCA9IGZhbHNlIH0gPSB7fSkge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICBjb25zdCBpdGVtcyA9IHBsdWdpbi5nZXRUeXBlcyh7IGluY2x1ZGVNYW51YWxPZmYgfSkubWFwKChpdGVtKSA9PiAoeyAuLi5pdGVtLCB1bnJlZ2lzdGVyZWQ6IGZhbHNlIH0pKTtcbiAgICBpZiAoaW5jbHVkZVVucmVnaXN0ZXJlZCkgaXRlbXMucHVzaCguLi51bnJlZ2lzdGVyZWRJdGVtcyhhcHAsIHBsdWdpbikpO1xuXG4gICAgaWYgKGl0ZW1zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgbmV3IE5vdGljZShcIktlaW5lIFRZUGVuIHZvcmhhbmRlbi5cIik7XG4gICAgICByZXNvbHZlKG51bGwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIG5ldyBUeXBQaWNrZXJNb2RhbChhcHAsIHBsdWdpbiwgaXRlbXMsIHJlc29sdmUpLm9wZW4oKTtcbiAgfSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBwaWNrVHlwZSB9O1xuIiwgImNvbnN0IHsgUGx1Z2luIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IERFRkFVTFRfU0VUVElOR1MsIFR5cFN5c3RlbVNldHRpbmdUYWIgfSA9IHJlcXVpcmUoXCIuL3NldHRpbmdzXCIpO1xuY29uc3QgeyByZWdpc3RlckNvbW1hbmRzIH0gPSByZXF1aXJlKFwiLi9jb21tYW5kc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJUeXBWaWV3LCBzb3J0VHlwZXNCeU1vZGUsIERFRkFVTFRfU09SVF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vdHlwLXZpZXdcIik7XG5jb25zdCB7IFR5cEluZGV4IH0gPSByZXF1aXJlKFwiLi90eXAtaW5kZXhcIik7XG5jb25zdCB7IHJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9maWxlLWV4cGxvcmVyLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJHcmFwaENvbG9ycyB9ID0gcmVxdWlyZShcIi4vZ3JhcGgtY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlclNlYXJjaENvbG9ycyB9ID0gcmVxdWlyZShcIi4vc2VhcmNoLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vcmVjZW50LWZpbGVzLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vYmFja2xpbmstY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vYm9va21hcmstY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9hY3RpdmUtdGl0bGUtY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckxpbmtDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2xpbmstY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodCB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHRcIik7XG5jb25zdCB7IHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jIH0gPSByZXF1aXJlKFwiLi9wcm9wZXJ0eS1yZW5hbWUtc3luY1wiKTtcbmNvbnN0IHsgbm9ybWFsaXplR2xvYmFsT3JkZXIgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXNvcnRcIik7XG5jb25zdCB7IHJlc29sdmVGcm9udG1hdHRlclBsYWNlaG9sZGVycywgRFlOQU1JQ19QTEFDRUhPTERFUl9QQVRURVJOIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1wbGFjZWhvbGRlcnNcIik7XG5jb25zdCB7IHBpY2tUeXBlOiBwaWNrVHlwZU1vZGFsIH0gPSByZXF1aXJlKFwiLi90eXBlLXBpY2tlclwiKTtcbmNvbnN0IHsgcmVnaXN0ZXJQbGFjZWhvbGRlclN1Z2dlc3QgfSA9IHJlcXVpcmUoXCIuL3BsYWNlaG9sZGVyLXN1Z2dlc3RcIik7XG5cbi8vIE1pZ3JpZXJ0IEJlc3RhbmRzaW5zdGFsbGF0aW9uZW4gdm9uIGRlciBhbHRlbiwgc2VwYXJhdGVuXG4vLyB0eXBlRmxvYXRpbmdGcm9udG1hdHRlci1MaXN0ZSAoZWlnZW5lcyBEaWN0IGplIFR5cCwgaW1tZXIgaGludGVyIGRlclxuLy8gU3RhbmRhcmRsaXN0ZSBzb3J0aWVydCkgYXVmIGRpZSBuZXVlIHR5cGVGbG9hdGluZ0tleXMtTWFya2llcnVuZyBpbm5lcmhhbGJcbi8vIGRlcnNlbGJlbiB0eXBlRGVmYXVsdEZyb250bWF0dGVyLUxpc3RlIChzaWVoZSBLb21tZW50YXIgYW4gdHlwZUZsb2F0aW5nS2V5c1xuLy8gaW4gc2V0dGluZ3MuanMpIC0gZGllIEZsb2F0aW5nIFByb3BlcnRpZXMgbGFuZGVuIGRhYmVpIHVudmVyXHUwMEU0bmRlcnQgZGlyZWt0XG4vLyBpbSBBbnNjaGx1c3MgYW4gZGllIGJpc2hlcmlnZSBTdGFuZGFyZGxpc3RlLCBnZW5hdSB3aWUgenV2b3IuXG5mdW5jdGlvbiBtaWdyYXRlRmxvYXRpbmdGcm9udG1hdHRlcihzZXR0aW5ncykge1xuICBpZiAoIXNldHRpbmdzLnR5cGVGbG9hdGluZ0Zyb250bWF0dGVyKSByZXR1cm47XG4gIGZvciAoY29uc3QgW3R5cGUsIGZsb2F0aW5nXSBvZiBPYmplY3QuZW50cmllcyhzZXR0aW5ncy50eXBlRmxvYXRpbmdGcm9udG1hdHRlcikpIHtcbiAgICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMoZmxvYXRpbmcpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIpO1xuICAgIGlmIChrZXlzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSA9IHsgLi4uKHNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0gPz8ge30pLCAuLi5mbG9hdGluZyB9O1xuICAgIHNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV0gPSBbLi4ubmV3IFNldChbLi4uKHNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV0gPz8gW10pLCAuLi5rZXlzXSldO1xuICB9XG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBlRmxvYXRpbmdGcm9udG1hdHRlcjtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBjbGFzcyBUeXBTeXN0ZW1QbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBhc3luYyBvbmxvYWQoKSB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcblxuICAgIC8vIFZvciBhbGxlbiBcdTAwRkNicmlnZW4gTW9kdWxlbjogZGllIHJlZ2lzdHJpZXJlbiBzaWNoIGF1ZiBkZXNzZW4gXCJjaGFuZ2VcIi1cbiAgICAvLyBFdmVudCB1bmQgbGVzZW4gVFlQL1NVQlRZUCBhdXNzY2hsaWVcdTAwREZsaWNoIGRhclx1MDBGQ2JlciAoc2llaGUgdHlwLWluZGV4LmpzKS5cbiAgICB0aGlzLnR5cEluZGV4ID0gbmV3IFR5cEluZGV4KHRoaXMpO1xuICAgIHRoaXMudHlwSW5kZXgucmVnaXN0ZXIoKTtcblxuICAgIHJlZ2lzdGVyQ29tbWFuZHModGhpcyk7XG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBUeXBTeXN0ZW1TZXR0aW5nVGFiKHRoaXMuYXBwLCB0aGlzKSk7XG4gICAgLy8gVW1iZW5lbm51bmdlbiBcdTAwRkNiZXIgXCJBbGwgcHJvcGVydGllc1wiL0Jhc2VzIGF1Y2ggaW5zIFN0YW5kYXJkLUZyb250bWF0dGVyXG4gICAgLy8gZGVyIFR5cGVuIFx1MDBGQ2Jlcm5laG1lbiAoc2llaGUgcHJvcGVydHktcmVuYW1lLXN5bmMuanMpLlxuICAgIHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jKHRoaXMpO1xuICAgIHJlZ2lzdGVyUGxhY2Vob2xkZXJTdWdnZXN0KHRoaXMpO1xuXG4gICAgLy8gU2VwYXJhdCBnZWhhbHRlbiAobmljaHQgbnVyIFRlaWwgdm9uIHJlZnJlc2hGbnMpOiBkaWUgVFlQLURldGFpbGFuc2ljaHRcbiAgICAvLyBicmF1Y2h0IG5hY2ggZGVtIE1vdW50ZW4gaWhyZXMgU3RhbmRhcmQtRnJvbnRtYXR0ZXItRWRpdG9ycyBnZXppZWx0IG51clxuICAgIC8vIGRpZXNlbiBlaW5lbiBSZWZyZXNoIChGZXR0LU1hcmtpZXJ1bmcgZGVyIFByb3BlcnR5LVplaWxlbikgLSBkYXMgZ2FuemVcbiAgICAvLyByZWZyZXNoVHlwQ29sb3JzKCktQlx1MDBGQ25kZWwgd1x1MDBGQ3JkZSBkb3J0IGF1Y2ggdW5uXHUwMEY2dGlnIHJlZ2lzdGVyVHlwVmlldydzXG4gICAgLy8gZWlnZW5lbiBSZW5kZXItUmVmcmVzaCBtaXRhbnN0b1x1MDBERmVuIHVuZCBzaWNoIGRhbWl0IHNlbGJzdCByZWt1cnNpdlxuICAgIC8vIGVybmV1dCByZW5kZXJuIChmXHUwMEZDaHJ0ZSB6dSBlaW5lbSBTdGFjayBPdmVyZmxvdyBiZWkgamVkZW0gVFlQLVx1MDBENmZmbmVuKS5cbiAgICB0aGlzLnJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodCA9IHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0KHRoaXMpO1xuXG4gICAgY29uc3QgcmVmcmVzaEZucyA9IFtcbiAgICAgIHJlZ2lzdGVyVHlwVmlldyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJHcmFwaENvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyU2VhcmNoQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyQmFja2xpbmtDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlckxpbmtDb2xvcnModGhpcyksXG4gICAgICB0aGlzLnJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodCxcbiAgICBdO1xuICAgIHRoaXMucmVmcmVzaFR5cENvbG9ycyA9ICgpID0+IHJlZnJlc2hGbnMuZm9yRWFjaCgoZm4pID0+IGZuKCkpO1xuICB9XG5cbiAgb251bmxvYWQoKSB7fVxuXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IGxpZWZlcnQgZGllIGltIFRZUC1WaWV3IHVudGVyXG4gIC8vIFwiU3RhbmRhcmQtRnJvbnRtYXR0ZXJcIiBoaW50ZXJsZWd0ZW4gUHJvcGVydGllcyBmXHUwMEZDciBkZW4gZ2VnZWJlbmVuIFRZUCwgZGFtaXRcbiAgLy8gVGVtcGxhdGVyIHNpZSBiZWltIEFubGVnZW4gZWluZXIgbmV1ZW4gTm90aXogXHUwMEZDYmVybmVobWVuIGthbm4sIHN0YXR0IHNpZSBkb3J0XG4gIC8vIGVpbiB6d2VpdGVzIE1hbCB6dSBwZmxlZ2VuLiBXZXJ0ZSB3aWUgXCJ7e3RvZGF5fX1cIiB3ZXJkZW4gZGFiZWkgZXJzdCBoaWVyXG4gIC8vIGF1ZmdlbFx1MDBGNnN0IChzaWVoZSBmcm9udG1hdHRlci1wbGFjZWhvbGRlcnMuanMpLCBuaWNodCBzY2hvbiBiZWltIFNwZWljaGVybiAtXG4gIC8vIGxpZWZlcnQgYWxzbyBiZWkgamVkZW0gQXVmcnVmIGZyaXNjaCBiZXJlY2huZXRlIFdlcnRlLiBLb3BpZSBzdGF0dCBkaXJla3RlclxuICAvLyBSZWZlcmVueiwgZGFtaXQgZWluIEF1ZnJ1ZmVyIGRpZSB6dXJcdTAwRkNja2dlZ2ViZW5lbiBXZXJ0ZSBnZWZhaHJsb3MgbXV0aWVyZW5cbiAgLy8ga2Fubiwgb2huZSBkaWUgUGx1Z2luLVNldHRpbmdzIHp1IHZlclx1MDBFNG5kZXJuLlxuICAvL1xuICAvLyBpbmNsdWRlRmxvYXRpbmcgKFN0YW5kYXJkOiBmYWxzZSkgbFx1MDBFNHNzdCBkaWUgYWxzIFwiRmxvYXRpbmcgUHJvcGVydHlcIlxuICAvLyBtYXJraWVydGVuIEtleXMgKHR5cGVGbG9hdGluZ0tleXMpIGluIGRlciBMaXN0ZSAtIGFuZGVycyBhbHMgZGllIFx1MDBGQ2JyaWdlblxuICAvLyBTdGFuZGFyZC1Qcm9wZXJ0aWVzIHdlcmRlbiBkaWVzZSBOSUNIVCBhdXRvbWF0aXNjaCBiZWkgamVkZXIgbmV1ZW4gTm90aXpcbiAgLy8gYW5nZWxlZ3QgKHNpZSB6XHUwMEU0aGxlbiB6d2FyIGZcdTAwRkNyIGRpZSBGcm9udG1hdHRlci1Tb3J0aWVydW5nIG1pdCwgc2llaGVcbiAgLy8gb3JkZXJlZERlZmF1bHRLZXlzIGluIGZyb250bWF0dGVyLXNvcnQuanMsIHNvbGxlbiBhYmVyIG51ciBiZWkgQmVkYXJmXG4gIC8vIGV4cGxpeml0IHZvbiBlaW5lbSBUZW1wbGF0ZXItU2tyaXB0IGFiZ2VncmlmZmVuIHdlcmRlbikuXG4gIC8vXG4gIC8vIGZpbGUgKG9wdGlvbmFsKSB3aXJkIGFuIHJlc29sdmVGcm9udG1hdHRlclBsYWNlaG9sZGVycygpIGR1cmNoZ2VyZWljaHQgLVxuICAvLyBudXIgZlx1MDBGQ3IgZGVuIFwie3tjcmVhdGVkfX1cIi1QbGF0emhhbHRlciByZWxldmFudCwgZGVyIGRhcyBFcnN0ZWxsdW5nc2RhdHVtXG4gIC8vIGRlciBaaWVsLURhdGVpIHN0YXR0IGRlcyBBdWZydWZ6ZWl0cHVua3RzIGxpZWZlcnQuXG4gIGdldFR5cGVEZWZhdWx0cyh0eXBlLCB7IGluY2x1ZGVGbG9hdGluZyA9IGZhbHNlLCBmaWxlIH0gPSB7fSkge1xuICAgIGNvbnN0IGRlZmF1bHRzID0geyAuLi4odGhpcy5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdID8/IHt9KSB9O1xuICAgIGlmICghaW5jbHVkZUZsb2F0aW5nKSB7XG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiB0aGlzLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV0gPz8gW10pIGRlbGV0ZSBkZWZhdWx0c1trZXldO1xuICAgIH1cbiAgICByZXR1cm4gcmVzb2x2ZUZyb250bWF0dGVyUGxhY2Vob2xkZXJzKGRlZmF1bHRzLCBmaWxlKTtcbiAgfVxuXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IGVya2VubnQgZWluZW4gZHluYW1pc2NoZW5cbiAgLy8gXCJ7e3RwLjxTa3JpcHRuYW1lPn19XCItUGxhdHpoYWx0ZXIgKHNpZWhlIGZyb250bWF0dGVyLXBsYWNlaG9sZGVycy5qcykgaW5cbiAgLy8gZWluZW0gU3RhbmRhcmQtRnJvbnRtYXR0ZXItV2VydCB1bmQgbGllZmVydCBkZW4gcmVmZXJlbnppZXJ0ZW4gU2tyaXB0bmFtZW4sXG4gIC8vIHNvbnN0IG51bGwuIERpZSBlaWdlbnRsaWNoZSBBdWZsXHUwMEY2c3VuZyAoQXVmcnVmIHZvbiB0cC51c2VyLjxTa3JpcHRuYW1lPilcbiAgLy8ga2FubiBudXIgVGVtcGxhdGVyIHNlbGJzdCBcdTAwRkNiZXJuZWhtZW4gLSBkYXMgUGx1Z2luIGhhdCBrZWluZW4gdHAtWnVncmlmZixcbiAgLy8gZGFoZXIgaGllciBiZXd1c3N0IG51ciBFcmtlbm51bmcgc3RhdHQgQXVmbFx1MDBGNnN1bmcgd2llIGJlaSBnZXRUeXBlRGVmYXVsdHMoKS5cbiAgbWF0Y2hEeW5hbWljUGxhY2Vob2xkZXIodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBtYXRjaCA9IHZhbHVlLm1hdGNoKERZTkFNSUNfUExBQ0VIT0xERVJfUEFUVEVSTik7XG4gICAgcmV0dXJuIG1hdGNoID8gbWF0Y2hbMV0udHJpbSgpIDogbnVsbDtcbiAgfVxuXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IGRpZSBpbSBUWVAtVmlldyByZWdpc3RyaWVydGVuIFRZUGVuXG4gIC8vIHNhbXQgaWhyZXIgZG9ydCBnZXBmbGVndGVuIEJlc2NocmVpYnVuZywgc3RhdHQgc2llIGF1cyBfb2JzaWRpYW4vVHlwZW4ubWQgenUgcGFyc2VuIC1cbiAgLy8gaW4gZGVyc2VsYmVuIFJlaWhlbmZvbGdlLCBpbiBkZXIgc2llIGF1Y2ggaW4gZGVyIFRZUC1MaXN0ZSBzZWxic3QgZXJzY2hlaW5lblxuICAvLyAoYWt0dWVsbGUgU29ydGllcmVpbnN0ZWxsdW5nIGRvcnQsIHouIEIuIEhcdTAwRTR1Zmlna2VpdCBvZGVyIE5hbWUpLlxuICAvL1xuICAvLyBUWVBlbiBtaXQgZGVha3RpdmllcnRlbSBcIk1hbnVlbGxlciBUWVBcIi1TY2hhbHRlciAoc2llaGUgVFlQLURldGFpbGFuc2ljaHQpXG4gIC8vIHNpbmQgbmljaHQgZlx1MDBGQ3IgZGllIG1hbnVlbGxlIEF1c3dhaGwgZ2VkYWNodCAoei4gQi4gYmVpbSBBbmxlZ2VuIGVpbmVyIG5ldWVuXG4gIC8vIE5vdGl6KSB1bmQgd2VyZGVuIGRlc2hhbGIgc3RhbmRhcmRtXHUwMEU0XHUwMERGaWcgYXVzZ2VrbGFtbWVydCAtIEF1ZnJ1ZmVyLCBkaWVcbiAgLy8gdHJvdHpkZW0gYWxsZSBUWVBlbiBicmF1Y2hlbiwgXHUwMEZDYmVyZ2ViZW4gaW5jbHVkZU1hbnVhbE9mZjogdHJ1ZS5cbiAgZ2V0VHlwZXMoeyBpbmNsdWRlTWFudWFsT2ZmID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgY29uc3QgeyBjb3VudHMgfSA9IHRoaXMudHlwSW5kZXgudHlwZUNvdW50cygpO1xuICAgIGNvbnN0IHNvcnRPcmRlciA9IHRoaXMuc2V0dGluZ3MudHlwU29ydE9yZGVyID8/IERFRkFVTFRfU09SVF9PUkRFUjtcbiAgICByZXR1cm4gc29ydFR5cGVzQnlNb2RlKHRoaXMuc2V0dGluZ3MudHlwZXMsIHNvcnRPcmRlciwgY291bnRzLCB0aGlzLnNldHRpbmdzLnR5cGVDb2xvcnMpXG4gICAgICAuZmlsdGVyKCh0eXBlKSA9PiBpbmNsdWRlTWFudWFsT2ZmIHx8ICh0aGlzLnNldHRpbmdzLnR5cGVNYW51YWwgPz8ge30pW3R5cGVdICE9PSBmYWxzZSlcbiAgICAgIC5tYXAoKHR5cGUpID0+ICh7XG4gICAgICAgIHR5cGUsXG4gICAgICAgIGRlc2NyaXB0aW9uOiB0aGlzLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gPz8gXCJcIixcbiAgICAgICAgY291bnQ6IGNvdW50cy5nZXQodHlwZSkgPz8gMCxcbiAgICAgIH0pKTtcbiAgfVxuXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IG5hdGl2ZXIgVFlQLVBpY2tlciAoc2llaGVcbiAgLy8gdHlwZS1waWNrZXIuanMpIHN0YXR0IGRlciByZWluZW4gVGV4dC1MaXN0ZSBhdXMgZ2V0VHlwZXMoKSArXG4gIC8vIHRwLnN5c3RlbS5zdWdnZXN0ZXIgLSBtaXQgVFlQLUZhcmJlLy1QdW5rdCwgQmVzY2hyZWlidW5nIHVuZCBOb3Rpei1BbnphaGxcbiAgLy8gamUgWmVpbGUuIGluY2x1ZGVNYW51YWxPZmYgd2llIGJlaSBnZXRUeXBlcygpLiBMXHUwMEY2c3QgbWl0IGRlbSBnZXdcdTAwRTRobHRlbiBUWVBcbiAgLy8gYXVmLCBvZGVyIG1pdCBudWxsIGJlaSBBYmJydWNoIChFU0MpLlxuICBwaWNrVHlwZShvcHRpb25zKSB7XG4gICAgcmV0dXJuIHBpY2tUeXBlTW9kYWwodGhpcy5hcHAsIHRoaXMsIG9wdGlvbnMpO1xuICB9XG5cbiAgYXN5bmMgbG9hZFNldHRpbmdzKCkge1xuICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTLCBhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuICAgIC8vIE9iamVjdC5hc3NpZ24gZXJzZXR6dCB2ZXJzY2hhY2h0ZWx0ZSBPYmpla3RlIGFscyBHYW56ZXMgLSBzcFx1MDBFNHRlclxuICAgIC8vIGhpbnp1Z2Vrb21tZW5lIEFuc2ljaHRlbiAoei4gQi4gY29sb3JWaWV3cy5saW5rcykgZmVobHRlbiBpbiBiZXJlaXRzXG4gICAgLy8gZ2VzcGVpY2hlcnRlbiBFaW5zdGVsbHVuZ2VuIHNvbnN0IHVuZCB3XHUwMEU0cmVuIHN0aWxsc2Nod2VpZ2VuZCBhdXMuXG4gICAgdGhpcy5zZXR0aW5ncy5jb2xvclZpZXdzID0geyAuLi5ERUZBVUxUX1NFVFRJTkdTLmNvbG9yVmlld3MsIC4uLnRoaXMuc2V0dGluZ3MuY29sb3JWaWV3cyB9O1xuICAgIC8vIE1pZ3JpZXJ0IEJlc3RhbmRzaW5zdGFsbGF0aW9uZW4sIGRlcmVuIGdsb2JhbFByb3BlcnR5T3JkZXIgbm9jaCBhdXMgZGVyXG4gICAgLy8gWmVpdCB2b3IgXCJUWVAgYWxzIExpc3RlbmVpbnRyYWdcIiBzdGFtbXQgKHNpZWhlIGZyb250bWF0dGVyLXNvcnQuanMpLlxuICAgIHRoaXMuc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHRoaXMuc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XG4gICAgbWlncmF0ZUZsb2F0aW5nRnJvbnRtYXR0ZXIodGhpcy5zZXR0aW5ncyk7XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKSB7XG4g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SyxTQUFTLGdCQUFnQjtBQUNoRCxXQUFPLGdCQUFnQixLQUFLLFNBQVMsT0FBTyxXQUFXLFFBQVEsS0FBSyxTQUFTLFVBQVUsRUFDcEYsT0FBTyxDQUFDLFNBQVMscUJBQXFCLEtBQUssU0FBUyxjQUFjLENBQUMsR0FBRyxJQUFJLE1BQU0sS0FBSyxFQUNyRixJQUFJLENBQUMsVUFBVTtBQUFBLE1BQ2Q7QUFBQSxNQUNBLGFBQWEsS0FBSyxTQUFTLGlCQUFpQixJQUFJLEtBQUs7QUFBQSxNQUNyRCxPQUFPLE9BQU8sSUFBSSxJQUFJLEtBQUs7QUFBQSxJQUM3QixFQUFFO0FBQUEsRUFDTjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU9BLFNBQVMsU0FBUztBQUNoQixXQUFPLGNBQWMsS0FBSyxLQUFLLE1BQU0sT0FBTztBQUFBLEVBQzlDO0FBQUEsRUFFQSxNQUFNLGVBQWU7QUFDbkIsU0FBSyxXQUFXLE9BQU8sT0FBTyxDQUFDLEdBQUcsa0JBQWtCLE1BQU0sS0FBSyxTQUFTLENBQUM7QUFJekUsU0FBSyxTQUFTLGFBQWEsRUFBRSxHQUFHLGlCQUFpQixZQUFZLEdBQUcsS0FBSyxTQUFTLFdBQVc7QUFHekYsU0FBSyxTQUFTLHNCQUFzQixxQkFBcUIsS0FBSyxTQUFTLG1CQUFtQjtBQUMxRiwrQkFBMkIsS0FBSyxRQUFRO0FBQUEsRUFDMUM7QUFBQSxFQUVBLE1BQU0sZUFBZTtBQUNuQixVQUFNLEtBQUssU0FBUyxLQUFLLFFBQVE7QUFBQSxFQUNuQztBQUNGOyIsCiAgIm5hbWVzIjogWyJleHBvcnRzIiwgIm1vZHVsZSIsICJub3JtYWxpemVHbG9iYWxPcmRlciIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJERUZBVUxUX1NFVFRJTkdTIiwgIlR5cFN5c3RlbVNldHRpbmdUYWIiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJDb21tYW5kcyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJEWU5BTUlDX1BMQUNFSE9MREVSX1BBVFRFUk4iLCAicmVzb2x2ZUZyb250bWF0dGVyUGxhY2Vob2xkZXJzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyUGxhY2Vob2xkZXJTdWdnZXN0IiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInNvcnRUeXBlc0J5TW9kZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJUeXBJbmRleCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJzb3J0VHlwZXNCeU1vZGUiLCAiREVGQVVMVF9TT1JUX09SREVSIiwgInJlZ2lzdGVyVHlwVmlldyIsICJsZWFmIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyR3JhcGhDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJTZWFyY2hDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckJhY2tsaW5rQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyQm9va21hcmtzQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJMaW5rQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0IiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgIkRFRkFVTFRfU09SVF9PUkRFUiJdCn0K
