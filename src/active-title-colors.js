const { TFile } = require("obsidian");
const { colorForFile, subtypeColor, subtypeHasOwnColor } = require("./type-colors");
const { getSubtype } = require("./subtypes");

const DOT_CLASS = "fred-typ-title-dot";
const DOT_HOLLOW_CLASS = "fred-typ-title-dot-hollow";
// Wie DEFAULT_TYPE_COLOR in typ-view.js (Farbe eines TYPs ohne eigene Farbe).
const DEFAULT_DOT_COLOR = "#888888";
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
  if (style === "dot") return { kind: "dot", ...resolveDot(plugin, file) };

  // style === "badge" - farbig bei einem registrierten TYP ohne eigene Farbe
  // in der grauen Standardfarbe (wie der Ring von resolveDot); ein nicht
  // registrierter TYP bekommt farbig keine Box, wie auch keinen Punkt.
  const { settings } = plugin;
  const type = plugin.typIndex.typeOf(file);
  if (!type) return { kind: "none" };
  const colored = settings.noteTitleBadgeColored;
  if (colored && !settings.typeColors[type] && !settings.types.includes(type)) return { kind: "none" };
  const typeColor = settings.typeColors[type] ?? DEFAULT_DOT_COLOR;

  const label = badgeLabel(plugin, file, type);
  if (!label) return { kind: "none" };
  const { text, useSubtypeColor, subtype } = label;
  const color = colored ? (useSubtypeColor ? subtypeColor(settings, type, subtype) ?? typeColor : typeColor) : null;
  const position = settings.noteTitleBadgePosition;
  return { kind: position === "block" ? "block-badge" : "title-badge", colored, color, typeName: text };
}

// Beschriftung der Box (noteTitleBadgeLabel) samt der dazu passenden Farbe:
// [TYP] in TYP-Farbe, [Subtyp] in Subtyp-Farbe (ohne Subtyp keine Box -
// dann null), [TYP/Subtyp] je nach Schalter "Subtyp-Farbe"
// (colorViews.noteTitleMarkerSubtyp). Ein nicht registrierter SUBTYP-Wert
// steht als Text da, hat aber keine eigene Farbe (subtypeColor liefert dann
// die des TYPs).
function badgeLabel(plugin, file, type) {
  const { settings } = plugin;
  const subtype = plugin.typIndex.subtypeOf(file);
  const mode = settings.noteTitleBadgeLabel ?? "type";
  if (mode === "subtype") return subtype ? { text: subtype, useSubtypeColor: true, subtype } : null;
  if (!subtype || mode === "type") return { text: type, useSubtypeColor: false, subtype };
  return { text: `${type}/${subtype}`, useSubtypeColor: !!settings.colorViews.noteTitleMarkerSubtyp, subtype };
}

// Farbpunkt am Titel - wie die Farbpunkte der TYP-View (siehe paintColorDot
// in type-colors.js) beim Standardwert als hohler Ring: ein registrierter TYP
// ohne Farbe grau, ein Subtyp ohne eigene Einstellung (mit dem Unter-Schalter
// "Subtyp") in der TYP-Farbe, die er übernimmt. Nicht registrierte TYPen
// bleiben wie in der TYP-Liste ohne Punkt.
function resolveDot(plugin, file) {
  const type = plugin.typIndex.typeOf(file);
  if (!type) return { color: null, hollow: false };
  const { settings } = plugin;
  const typeColor = settings.typeColors[type];
  if (!typeColor) {
    return settings.types.includes(type) ? { color: DEFAULT_DOT_COLOR, hollow: true } : { color: null, hollow: false };
  }
  const subtype = plugin.typIndex.subtypeOf(file);
  if (settings.colorViews.noteTitleMarkerSubtyp && subtype && getSubtype(settings, type, subtype)) {
    return { color: subtypeColor(settings, type, subtype), hollow: !subtypeHasOwnColor(settings, type, subtype) };
  }
  return { color: typeColor, hollow: false };
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
  titleEl.classList.toggle(DOT_HOLLOW_CLASS, isDot && !!marker.hollow);
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

      const textColor = plugin.settings.colorViews.noteTitleColor ? colorForFile(plugin, typedFile, "noteTitleColor") : null;
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
