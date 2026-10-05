const { getLinkpath } = require("obsidian");
const { getSubtyp } = require("./subtyps");

// Color of a TYP without its own color. Lives here because code below the
// view needs it (see nameColor); typ-pane.js re-exports it.
const DEFAULT_TYP_COLOR = "#888888";

// --- Subtyp colors ----------------------------------------------------------
// A Subtyp stores no color, only an offset from its TYP's color
// (settings.typSubtyps[TYP][SUBTYP].color = { h, l }). The real color is
// computed from the current TYP color every time, so when that changes all
// Subtyps follow and stay in the family.
// The math runs in OKLCH, where a lightness change looks about equally strong
// across hues (in HSL yellow would be far brighter than blue). Without an
// offset a Subtyp has the TYP color.
//   h: hue, shifted in degrees;
//   l: lightness as % of the way to white (+) or black (-).
// The allowed range is a setting (settings.subtypColorRanges); a larger stored
// offset is clamped to it.
//
// This list is the single source for the popover sliders, the setting limits
// and the clamping; commenting a channel out removes it everywhere.
//
// Saturation is disabled. It once compensated for chroma that lightness and
// hue took away; since both now carry chroma along (see computeColorOffset),
// it could only say "this Subtyp holds back", not worth a third slider. To
// revive it, uncomment it here, in DEFAULT_SUBTYP_COLOR_RANGES, in
// computeColorOffset and at rangeMax/rangeDesc in settings.js.
// downOnly: the slider only goes from -limit to 0 - a Subtyp may hold back but
// never be louder than its TYP.
const SUBTYP_COLOR_CHANNELS = [
  { key: "h", label: "Hue", unit: "°" },
  // { key: "s", label: "Saturation", unit: "%", downOnly: true },
  { key: "l", label: "Lightness", unit: "%" },
];
// Subtyps should above all be distinguishable: hue contributes most and gets
// the widest range, lightness as the second clear axis gets plenty too.
const DEFAULT_SUBTYP_COLOR_RANGES = { h: 35, /* s: 40, */ l: 40 };

function colorRange(settings, key) {
  const value = Number(settings.subtypColorRanges?.[key]);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SUBTYP_COLOR_RANGES[key];
}

// Slider range - one place for popover, clamping and gradient preview so they
// can't drift apart.
function channelBounds(settings, key) {
  const range = colorRange(settings, key);
  return SUBTYP_COLOR_CHANNELS.find((channel) => channel.key === key)?.downOnly ? [-range, 0] : [-range, range];
}

// A Subtyp's offset, clamped to the configured limits.
function clampedOffset(settings, offset) {
  if (!offset) return null;
  const result = {};
  for (const { key } of SUBTYP_COLOR_CHANNELS) {
    const [min, max] = channelBounds(settings, key);
    result[key] = Math.min(max, Math.max(min, Number(offset[key]) || 0));
  }
  return result;
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToOklch(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!match) return null;
  const int = parseInt(match[1], 16);
  const [r, g, b] = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => toLinear(c / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

// Linear sRGB; channels may fall outside 0..1 (out of gamut).
function oklchToLinear({ L, C, H }) {
  const A = C * Math.cos((H * Math.PI) / 180);
  const B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb) => rgb.every((c) => c >= -0.0001 && c <= 1.0001);

// Largest chroma sRGB can show at this lightness and hue. The limit varies a
// lot (pure yellow only carries much chroma just below white, blue in the
// middle), which is exactly where any math holding chroma absolute breaks.
function maxChroma(L, H) {
  let low = 0;
  let high = 0.4; // above the sRGB maximum (~0.32)
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    if (inGamut(oklchToLinear({ L, C: mid, H }))) low = mid;
    else high = mid;
  }
  return low;
}

// Out-of-gamut colors lose chroma until they fit; hue and lightness stay.
// For applyColorOffset only a safety net, since chroma is already a share of
// the displayable maximum there.
function oklchToHex(color) {
  let rgb = oklchToLinear(color);
  if (!inGamut(rgb)) rgb = oklchToLinear({ ...color, C: maxChroma(color.L, color.H) });
  return (
    "#" +
    rgb
      .map((c) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, c))))) * 255))
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")
  );
}

// Lightness of a hue's cusp, where it carries the most chroma. maxChroma rises
// up to it and falls after, so the peak can be narrowed down. One value per
// hue and the search is costly, so it is cached per whole degree.
const cuspCache = new Map();

// Above this a color counts as chromatic. A pure gray comes back from
// hexToOklch with chroma around 2e-8 and an arbitrary hue (rounded matrix
// constants); testing "> 0" made a gray follow the cusp of a hue it doesn't
// have. Far below anything visible in 8 bit (one step is about 0.002).
const NEUTRAL_CHROMA = 1e-4;

function cuspLightness(H) {
  const key = Math.round(H) % 360;
  const cached = cuspCache.get(key);
  if (cached !== undefined) return cached;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i++) {
    const third = (high - low) / 3;
    if (maxChroma(low + third, key) < maxChroma(high - third, key)) low += third;
    else high -= third;
  }
  const result = (low + high) / 2;
  cuspCache.set(key, result);
  return result;
}

// The same lightness, measured against the target hue's cusp instead of its
// own: cusp maps to cusp, black to black, white to white, linear in between.
// Without a hue shift L comes back unchanged.
function remapToCusp(L, fromH, toH) {
  const from = cuspLightness(fromH);
  const to = cuspLightness(toH);
  if (L <= from) return from > 0 ? (L / from) * to : to;
  return from < 1 ? to + ((L - from) / (1 - from)) * (1 - to) : to;
}

// The two gamut searches cost about 10 µs per color - too much when the file
// tree or graph asks for every file (see colorForFile). There are only a
// handful of distinct colors, so a cache suffices; dragging a slider adds
// every intermediate value, hence the occasional reset.
const offsetCache = new Map();

function applyColorOffset(hex, offset) {
  if (!offset) return hex;
  const cacheKey = hex + "|" + (offset.h ?? 0) + "|" + (offset.l ?? 0);
  const cached = offsetCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const result = computeColorOffset(hex, offset);
  if (offsetCache.size > 500) offsetCache.clear();
  offsetCache.set(cacheKey, result);
  return result;
}

// Both sliders act relative to the TYP color so the Subtyp stays in the
// family. Absolute values don't keep their promise, because how much color
// sRGB allows depends on lightness AND hue:
//   l: share of the way to white (+) or black (-). Absolute OKLCH points ran a
//      light TYP color into pure white in the first half of the slider.
//   h: degrees - the only absolute one, BUT it carries lightness along (see
//      remapToCusp). Each hue peaks at a different lightness (yellow at L 0.92,
//      orange 0.78, blue 0.49). Turning a light yellow to orange at fixed
//      lightness lands far above orange's cusp, where there is hardly any
//      chroma left: a washed-out pastel. Following the cusp keeps the color
//      strength nearly constant through the turn.
// Chroma is then simply a share of the ceiling (base.C / maxChroma at the
// start, times maxChroma at the target); only with related lightnesses are
// two hues' ceilings comparable.
//
// Note what that share is: a statement about sRGB, not about perception. It
// keeps "equally exhausted", not "equally colorful" (constant C) nor "equally
// saturated" (constant C/L). So the model is tied to sRGB; after a hue turn a
// Subtyp is equally emphatic rather than equally light (a design choice); and
// chroma isn't monotonic in lightness - above its cusp a TYP color first gains
// chroma going down, then loses it (#7878dc has more at -20 % than at 0 % or
// -40 %). Fine for colored file names; a stricter model needs a different
// reference, not patched formulas.
//
// OKLab itself is off in the blue range (H 260-290): blue drifts toward violet
// when lightened while the numbers say the hue is constant. Check such TYP
// colors by eye.
function computeColorOffset(hex, offset) {
  const base = hexToOklch(hex);
  if (!base) return hex;
  const H = (base.H + (offset.h ?? 0) + 360) % 360;
  const baseCeiling = maxChroma(base.L, base.H);
  // A gray TYP color stays gray; its hue means nothing, so there is no cusp to
  // follow either.
  const neutral = base.C < NEUTRAL_CHROMA || baseCeiling <= 0;
  const relative = neutral ? 0 : base.C / baseCeiling;
  const shifted = neutral ? base.L : remapToCusp(base.L, base.H, H);
  const share = (offset.l ?? 0) / 100;
  const L = Math.min(1, Math.max(0, shifted + share * (share >= 0 ? 1 - shifted : shifted)));
  const C = relative * maxChroma(L, H); /* * (1 + (offset.s ?? 0) / 100) - saturation disabled */
  return oklchToHex({ L, C: Math.max(0, C), H });
}

function hasColorOffset(offset) {
  return !!offset && SUBTYP_COLOR_CHANNELS.some(({ key }) => (offset[key] ?? 0) !== 0);
}

// A Subtyp's color (the TYP's while it has no offset); null if the TYP itself
// has no color.
function subtypColor(settings, typ, subtyp) {
  const typColor = settings.typColors[typ] ?? null;
  if (!typColor || !subtyp) return typColor;
  const offset = clampedOffset(settings, getSubtyp(settings, typ, subtyp)?.color);
  return hasColorOffset(offset) ? applyColorOffset(typColor, offset) : typColor;
}

// Does the Subtyp have an offset of its own (effective within the limits)?
function subtypHasOwnColor(settings, typ, subtyp) {
  return hasColorOffset(clampedOffset(settings, getSubtyp(settings, typ, subtyp)?.color));
}

// Color of a TYP or Subtyp name - shared by the picker (typ-picker.js) and the
// Subtyp preview in the TYP-List so they can't drift apart. With subtyp, the
// Subtyp color, but only if the "Subtyp" sub-toggle of "TYP-Pane" allows it.
// isDefault means a hollow ring instead of a filled dot (see paintColorDot).
function nameColor(settings, typ, subtyp = null) {
  const useSubtyp = !!subtyp && settings.colorViews.typListSubtyp;
  const typColor = settings.typColors[typ] ?? null;
  return {
    color: (useSubtyp ? subtypColor(settings, typ, subtyp) : typColor) ?? DEFAULT_TYP_COLOR,
    isDefault: !typColor || (useSubtyp && !subtypHasOwnColor(settings, typ, subtyp)),
  };
}

// Color dot (TYP-List, detail view, pickers, dialogs): filled for an own
// color, a hollow ring for the default - gray for a TYP without a color, the
// inherited TYP color for a Subtyp without an offset.
function paintColorDot(el, color, isDefault) {
  el.style.backgroundColor = isDefault ? "transparent" : color;
  el.style.boxShadow = isDefault ? `inset 0 0 0 max(1.5px, 0.15em) ${color}` : "";
}

// viewKey (optional): the view's key in colorViews. If its "<viewKey>Subtyp"
// sub-toggle is on, the note's Subtyp color is used instead of its TYP's.
function colorForFile(plugin, file, viewKey = null) {
  const typ = plugin.typIndex.typOf(file);
  if (!typ) return null;
  const { settings } = plugin;
  if (!viewKey || !settings.colorViews[`${viewKey}Subtyp`]) return settings.typColors[typ] ?? null;
  return subtypColor(settings, typ, plugin.typIndex.subtypOf(file));
}

// A rendered link element (data-href: link text or path, as Obsidian sets it;
// "is-unresolved" for a target that doesn't exist), resolved from sourcePath
// like Obsidian does - for Bases values and property links. Unresolved links,
// attachments and notes without a TYP stay neutral (null).
function colorForLink(plugin, linkEl, sourcePath, viewKey) {
  const href = linkEl.getAttribute("data-href");
  if (!href || linkEl.classList.contains("is-unresolved")) return null;
  const file = plugin.app.metadataCache.getFirstLinkpathDest(getLinkpath(href), sourcePath);
  return colorForFile(plugin, file, viewKey);
}

// --- Inline colors in other views -------------------------------------------
// Explorer, search (pane and query blocks in notes), Bases, Recent Files,
// backlinks, bookmarks, the note title, property links and "All properties"
// are colored through style.color on Obsidian's own elements. Those views only
// re-render now and then, so the colors would stay after the plugin is
// disabled. Every element colored this way is marked, and on unload exactly
// the marked ones are cleared - never an inline color some other plugin or
// theme put there.
const COLORED_ATTR = "data-typ-colored";

// color null/"" removes the color, but only from an element we colored.
// priority: "important" where a CSS rule with !important competes.
function setInlineColor(el, color, priority = "") {
  if (color) {
    el.style.setProperty("color", color, priority);
    el.setAttribute(COLORED_ATTR, "");
  } else if (el.hasAttribute(COLORED_ATTR)) {
    el.style.removeProperty("color");
    el.removeAttribute(COLORED_ATTR);
  }
}

// root: a document (unload, see main.js) or an element (one view switched off,
// see view-colors.js).
function clearInlineColors(root) {
  for (const el of root.querySelectorAll(`[${COLORED_ATTR}]`)) setInlineColor(el, null);
}

// The documents of all windows (pop-outs included), collected through their
// leaves.
function allDocuments(app) {
  const docs = new Set();
  app.workspace.iterateAllLeaves((leaf) => docs.add(leaf.view.containerEl.ownerDocument));
  return docs;
}

module.exports = {
  setInlineColor,
  clearInlineColors,
  allDocuments,
  colorForFile,
  colorForLink,
  nameColor,
  DEFAULT_TYP_COLOR,
  subtypColor,
  applyColorOffset,
  hasColorOffset,
  subtypHasOwnColor,
  paintColorDot,
  colorRange,
  channelBounds,
  clampedOffset,
  SUBTYP_COLOR_CHANNELS,
  DEFAULT_SUBTYP_COLOR_RANGES,
};
