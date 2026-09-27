const { setIcon, Notice } = require("obsidian");
const { TYP_PROPERTY, SUBTYP_PROPERTY, sortAllFrontmatter } = require("./frontmatter-sort");

// Anzeigetext der vier nicht entfernbaren Platzhalter-Zeilen - "typValue" ist
// die TYP-Property selbst, "subtypValue" analog die SUBTYP-Property, "typ"
// die TYP-Frontmatter-Liste des TYPs (siehe
// type-frontmatter-editor.js), "other" alle Properties, die weder dort noch
// in dieser Liste namentlich geführt werden. Siehe computeSortedKeys in
// frontmatter-sort.js für die tatsächliche Auflösung dieser Blöcke.
const PLACEHOLDER_LABELS = {
  typValue: "TYP",
  subtypValue: "SUBTYP",
  typ: "TYP-Frontmatter",
  other: "Sonstige Properties",
};

// Editor für plugin.settings.globalPropertyOrder: eine reine Namensliste
// (keine Werte, daher kein eigener private-API-Umweg über Obsidians
// Metadata-Editor-Widget wie in type-frontmatter-editor.js nötig) mit
// Drag-and-drop-Sortierung. Die drei Platzhalter-Zeilen sind Teil derselben
// Liste, lassen sich verschieben, aber nicht per UI entfernen.
function mountGlobalOrderEditor(containerEl, plugin) {
  const header = containerEl.createDiv({ cls: "fred-typ-frontmatter-header" });

  // Eigene Gruppe für Button + Überschrift, statt beide als getrennte Kinder
  // von header direkt: bei justify-content: space-between (siehe CSS) würde
  // ein drittes Kind zwischen Überschrift und "+"-Button sonst mittig im
  // verbleibenden Platz landen, statt direkt neben der Überschrift zu sitzen.
  const titleGroup = header.createDiv({ cls: "fred-typ-frontmatter-title-group" });

  // Wendet die aktuelle Reihenfolge sofort auf den gesamten Vault an - derselbe
  // Lauf wie der Befehl "Frontmatter Sortierung GLOBAL aktualisieren"
  // (sortAllFrontmatter mit onlyType null), nur direkt neben der Liste
  // erreichbar statt über die Befehlspalette.
  const applyBtn = titleGroup.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Auf alle Notizen anwenden" } });
  setIcon(applyBtn, "play");
  applyBtn.addEventListener("click", async () => {
    try {
      const { checked, changed } = await sortAllFrontmatter(plugin.app, plugin, null);
      new Notice(
        changed > 0
          ? `Frontmatter Sortierung: ${checked} Notizen geprüft, ${changed} sortiert.`
          : `Frontmatter Sortierung: ${checked} Notizen geprüft, bereits alle sortiert.`
      );
    } catch (error) {
      console.error("[Frontmatter Sortierung]", error);
      new Notice(`Frontmatter Sortierung fehlgeschlagen: ${error.message}`);
    }
  });

  titleGroup.createDiv({ cls: "fred-typ-detail-section-title", text: "Globale Property-Reihenfolge" });

  const addBtn = header.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Property hinzufügen" } });
  setIcon(addBtn, "plus");

  const listEl = containerEl.createDiv({ cls: "fred-order-list" });

  const order = () => plugin.settings.globalPropertyOrder;

  // Neue Zeile wird erst bei einem gültigen, nicht-leeren Namen tatsächlich in
  // plugin.settings.globalPropertyOrder aufgenommen (und damit potenziell
  // gespeichert) - bis dahin existiert sie nur als lokaler Entwurf, der beim
  // Re-Render zusätzlich ans Ende der echten Liste gehängt wird. So landen
  // leere Property-Felder nie in den Einstellungen, selbst wenn zwischendurch
  // aus anderem Anlass (z. B. Verschieben einer anderen Zeile) gespeichert wird.
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
      const rowCls =
        "fred-order-row" + (isPlaceholder ? " is-placeholder" : "") + (entry.kind === "typ" ? " is-typ-defaults" : "");
      const row = listEl.createDiv({ cls: rowCls });

      const dragHandle = row.createDiv({ cls: "fred-order-drag", attr: { "aria-label": "Verschieben" } });
      setIcon(dragHandle, "grip-vertical");

      if (isPlaceholder) {
        row.createDiv({ cls: "fred-order-label", text: PLACEHOLDER_LABELS[entry.kind] });
      } else {
        const input = row.createEl("input", {
          type: "text",
          cls: "fred-order-name-input",
          attr: { placeholder: "Property-Name" },
        });
        input.value = entry.name;

        // "blur" statt "change": Letzteres feuert bei einem leer gebliebenen
        // Feld gar nicht erst (Browser sehen darin keine Wertänderung) - der
        // Entwurf würde dann nie aufgeräumt. "blur" greift zuverlässig in
        // beiden Fällen (umbenennen wie leer lassen).
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

      // Der Entwurf hat noch keinen Platz in der echten Liste - Verschieben
      // ergibt für ihn keinen Sinn, bevor er überhaupt einen Namen hat.
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
        // Obere oder untere Hälfte der Zeile entscheidet, ob die gezogene
        // Zeile davor oder dahinter landet - sonst ließe sich nie "nach ganz
        // unten" ablegen (Ablegen auf der letzten Zeile hätte immer nur vor
        // ihr eingefügt).
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

        // Zielposition im Array VOR dem Entfernen von fromIndex gedacht -
        // "nach dieser Zeile" heißt: direkt vor der jeweils nächsten.
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

module.exports = { mountGlobalOrderEditor };
