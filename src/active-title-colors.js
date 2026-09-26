const { TFile } = require("obsidian");
const { colorForFile } = require("./type-colors");

const DOT_CLASS = "fred-typ-title-dot";
const BADGE_CLASS = "fred-typ-title-badge";
const BADGE_PLAIN_CLASS = "fred-typ-title-badge-plain";
const COLOR_VAR = "--fred-typ-title-color";

const BLOCK_BADGE_CLASS = "fred-typ-block-badge";
const BLOCK_BADGE_PLAIN_CLASS = "fred-typ-block-badge-plain";
const BLOCK_ALIGN_TOP_CLASS = "fred-typ-block-badge-top";
const BLOCK_ALIGN_BOTTOM_CLASS = "fred-typ-block-badge-bottom";
const BLOCK_COLOR_VAR = "--fred-typ-block-color";

// noteTitleStyle: "none" | "dot" | "badge". Bei "badge" bestimmen zwei
// weitere Einstellungen Farbe (noteTitleBadgeColored) und Position
// (noteTitleBadgePosition: "title" | "block") - siehe settings.js, dort nur
// bei "badge" überhaupt angezeigt (progressive Offenlegung). "dot" sitzt
// immer am Titel, "badge" je nach Position entweder am Titel oder am
// Property-Block (dort zusätzlich per noteTitleVerticalAlign oben/unten).
// colorViews.noteTitleColor (Titeltext selbst einfärben) ist davon unabhängig
// und beliebig kombinierbar.
function resolveMarker(plugin, file) {
  const style = plugin.settings.noteTitleStyle;
  if (style === "none") return { kind: "none" };
  if (style === "dot") return { kind: "dot", color: colorForFile(plugin, file) };

  // style === "badge"
  const colored = plugin.settings.noteTitleBadgeColored;
  const color = colored ? colorForFile(plugin, file) : null;
  const typeName = colored ? (color ? plugin.typIndex.typeOf(file) : null) : plugin.typIndex.typeOf(file);
  if (!typeName) return { kind: "none" };

  const position = plugin.settings.noteTitleBadgePosition;
  return { kind: position === "block" ? "block-badge" : "title-badge", colored, color, typeName };
}

// Titel der Notiz selbst (.inline-title, sichtbar sofern Obsidians eigene
// Einstellung "Inline-Titel anzeigen" aktiv ist). Bewusst als ::before
// realisiert (siehe styles.css) statt als eigenes DOM-Element oder Wrapper:
// .inline-title hängt in mehreren Themes (u. a. Minimal) per Kind-Selektor
// (">") direkt an seinem Eltern-Container (z. B. für max-width/margin) - ein
// zusätzliches Element davor oder ein Wrapper darum würde diese Regeln
// unterwandern. Farbe und TYP-Name lassen sich einem ::before nicht direkt
// zuweisen, daher der Umweg über eine CSS-Variable bzw. ein data-Attribut,
// die die ::before-Regeln auslesen (var()/attr()).
function applyStyleToTitle(titleEl, marker) {
  const isDot = marker.kind === "dot" && !!marker.color;
  const isBadge = marker.kind === "title-badge";

  titleEl.classList.toggle(DOT_CLASS, isDot);
  titleEl.classList.toggle(BADGE_CLASS, isBadge && marker.colored);
  titleEl.classList.toggle(BADGE_PLAIN_CLASS, isBadge && !marker.colored);

  if (isBadge) titleEl.dataset.fredTyp = marker.typeName;
  else delete titleEl.dataset.fredTyp;

  const markerColor = (isDot && marker.color) || (isBadge && marker.colored && marker.color) ? marker.color : null;
  if (markerColor) titleEl.style.setProperty(COLOR_VAR, markerColor);
  else titleEl.style.removeProperty(COLOR_VAR);
}

// Property-Block der Notiz (.metadata-container). Die "block"-Position von
// noteTitleBadgePosition: dieselbe Box wie am Titel, aber um 90° gedreht
// (writing-mode statt transform:rotate() - dadurch wächst die Box mit der
// Textlänge in der richtigen Richtung, ohne die Positionierung per
// transform-origin von Hand nachrechnen zu müssen) und links am Property-Block
// statt am Titel verankert, oben oder unten (noteTitleVerticalAlign). Bleibt
// beim (Ein-/Aus-)Blenden des Blocks (siehe Property-Block.css) automatisch
// mit verschwinden/erscheinen, da sie als ::before darauf sitzt.
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

function registerActiveTitleColors(plugin) {
  const refresh = () => applyActiveTitleColors(plugin);

  plugin.registerEvent(plugin.typIndex.on("change", refresh));
  plugin.registerEvent(plugin.app.workspace.on("file-open", refresh));
  plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", refresh));
  plugin.registerEvent(plugin.app.workspace.on("layout-change", refresh));

  plugin.app.workspace.onLayoutReady(refresh);

  return refresh;
}

module.exports = { registerActiveTitleColors };
