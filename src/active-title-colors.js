const { TFile } = require("obsidian");
const { colorForFile, subtypColor, subtypHasOwnColor, setInlineColor, DEFAULT_TYP_COLOR } = require("./typ-colors");
const { getSubtyp } = require("./subtyps");

const DOT_CLASS = "typ-title-dot";
const DOT_HOLLOW_CLASS = "typ-title-dot-hollow";
const BADGE_CLASS = "typ-title-badge";
const BADGE_PLAIN_CLASS = "typ-title-badge-plain";
const COLOR_VAR = "--typ-title-color";

const BLOCK_BADGE_CLASS = "typ-block-badge";
const BLOCK_BADGE_PLAIN_CLASS = "typ-block-badge-plain";
const BLOCK_ALIGN_TOP_CLASS = "typ-block-badge-top";
const BLOCK_ALIGN_BOTTOM_CLASS = "typ-block-badge-bottom";
const BLOCK_COLOR_VAR = "--typ-block-color";

// noteTitleStyle: "none" | "dot" | "badge". For "badge", noteTitleBadgeColored
// and noteTitleBadgePosition ("title" | "block", plus noteTitleVerticalAlign
// for "block") refine it. colorViews.noteTitleColor (the title text itself) is
// independent and combines with any of these.
function resolveMarker(plugin, file) {
  const style = plugin.settings.noteTitleStyle;
  if (style === "none") return { kind: "none" };
  if (style === "dot") return { kind: "dot", ...resolveDot(plugin, file) };

  // "badge": colored, a registered TYP without a color gets the gray default
  // (like the ring in resolveDot); an unregistered TYP gets no colored badge,
  // just as it gets no dot.
  const { settings } = plugin;
  const typ = plugin.typIndex.typOf(file);
  if (!typ) return { kind: "none" };
  const colored = settings.noteTitleBadgeColored;
  if (colored && !settings.typColors[typ] && !settings.typs.includes(typ)) return { kind: "none" };
  const typColor = settings.typColors[typ] ?? DEFAULT_TYP_COLOR;

  const label = badgeLabel(plugin, file, typ);
  if (!label) return { kind: "none" };
  const { text, useSubtypColor, subtyp } = label;
  const color = colored ? (useSubtypColor ? subtypColor(settings, typ, subtyp) ?? typColor : typColor) : null;
  const position = settings.noteTitleBadgePosition;
  return { kind: position === "block" ? "block-badge" : "title-badge", colored, color, typName: text };
}

// Badge label (noteTitleBadgeLabel) with its color: [TYP] in the TYP color,
// [Subtyp] in the Subtyp color (no badge without a Subtyp), [TYP/Subtyp]
// depending on the "Subtyp color" toggle (colorViews.noteTitleMarkerSubtyp).
// An unregistered SUBTYP value is shown but has no color of its own
// (subtypColor then returns the TYP color).
function badgeLabel(plugin, file, typ) {
  const { settings } = plugin;
  const subtyp = plugin.typIndex.subtypOf(file);
  const mode = settings.noteTitleBadgeLabel ?? "typ";
  if (mode === "subtyp") return subtyp ? { text: subtyp, useSubtypColor: true, subtyp } : null;
  if (!subtyp || mode === "typ") return { text: typ, useSubtypColor: false, subtyp };
  return { text: `${typ}/${subtyp}`, useSubtypColor: !!settings.colorViews.noteTitleMarkerSubtyp, subtyp };
}

// Dot at the title. Like the dots in the TYP-Pane (paintColorDot in
// typ-colors.js), a default is shown as a hollow ring: gray for a registered
// TYP without a color, the inherited TYP color for a Subtyp without its own.
// Unregistered TYP values get no dot, as in the TYP-List.
function resolveDot(plugin, file) {
  const typ = plugin.typIndex.typOf(file);
  if (!typ) return { color: null, hollow: false };
  const { settings } = plugin;
  const typColor = settings.typColors[typ];
  if (!typColor) {
    return settings.typs.includes(typ) ? { color: DEFAULT_TYP_COLOR, hollow: true } : { color: null, hollow: false };
  }
  const subtyp = plugin.typIndex.subtypOf(file);
  if (settings.colorViews.noteTitleMarkerSubtyp && subtyp && getSubtyp(settings, typ, subtyp)) {
    return { color: subtypColor(settings, typ, subtyp), hollow: !subtypHasOwnColor(settings, typ, subtyp) };
  }
  return { color: typColor, hollow: false };
}

// The note's inline title. Done as ::before (see styles.css), not as an extra
// element or wrapper: several themes (Minimal among them) style .inline-title
// with child selectors, which an extra element would break. A ::before can't
// be given a color or text directly, hence the CSS variable and the data
// attribute that its rules read (var()/attr()).
function applyStyleToTitle(titleEl, marker) {
  const isDot = marker.kind === "dot" && !!marker.color;
  const isBadge = marker.kind === "title-badge";

  titleEl.classList.toggle(DOT_CLASS, isDot);
  titleEl.classList.toggle(DOT_HOLLOW_CLASS, isDot && !!marker.hollow);
  titleEl.classList.toggle(BADGE_CLASS, isBadge && marker.colored);
  titleEl.classList.toggle(BADGE_PLAIN_CLASS, isBadge && !marker.colored);

  if (isBadge) titleEl.dataset.typ = marker.typName;
  else delete titleEl.dataset.typ;

  const markerColor = (isDot && marker.color) || (isBadge && marker.colored && marker.color) ? marker.color : null;
  if (markerColor) titleEl.style.setProperty(COLOR_VAR, markerColor);
  else titleEl.style.removeProperty(COLOR_VAR);
}

// The note's property block (.metadata-container), for position "block": the
// same badge, turned 90° (writing-mode rather than rotate(), so it grows with
// the text in the right direction) and anchored left at the block, top or
// bottom. As a ::before it hides and shows with the block (Property-Block.css).
function applyStyleToBlock(plugin, blockEl, marker) {
  const isBlockBadge = marker.kind === "block-badge";

  blockEl.classList.toggle(BLOCK_BADGE_CLASS, isBlockBadge && marker.colored);
  blockEl.classList.toggle(BLOCK_BADGE_PLAIN_CLASS, isBlockBadge && !marker.colored);

  const align = plugin.settings.noteTitleVerticalAlign;
  blockEl.classList.toggle(BLOCK_ALIGN_TOP_CLASS, isBlockBadge && align !== "bottom");
  blockEl.classList.toggle(BLOCK_ALIGN_BOTTOM_CLASS, isBlockBadge && align === "bottom");

  if (isBlockBadge) blockEl.dataset.typ = marker.typName;
  else delete blockEl.dataset.typ;

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
      setInlineColor(titleEl, textColor);
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

  // Dot, badge and their data attribute and color variables would otherwise
  // stay on open notes after the plugin is disabled, until the note is
  // re-rendered. The title text color is cleared with the other inline colors
  // (clearInlineColors, see main.js).
  plugin.register(() => {
    const none = { kind: "none" };
    for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
      const containerEl = leaf.view.containerEl;
      const titleEl = containerEl.querySelector(".inline-title");
      if (titleEl) applyStyleToTitle(titleEl, none);
      const blockEl = containerEl.querySelector(".metadata-container");
      if (blockEl) applyStyleToBlock(plugin, blockEl, none);
    }
  });

  return refresh;
}

module.exports = { registerActiveTitleColors };
