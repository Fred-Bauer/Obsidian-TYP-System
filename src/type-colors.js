const { getSubtype } = require("./subtypes");

// --- Subtyp-Farben ----------------------------------------------------------
// Ein Subtyp speichert keine eigene Farbe, sondern nur eine Abweichung von der
// Farbe seines TYPs (settings.typeSubtypes[TYP][SUBTYP].color = { h, s, l }).
// Die tatsächliche Farbe wird jedes Mal aus der aktuellen TYP-Farbe berechnet
// - ändert sich die, ziehen alle Subtypen mit und bleiben in der Farbfamilie.
// Gerechnet wird in OKLCH statt HSL: dort wirkt eine Helligkeitsänderung über
// alle Farbtöne ähnlich stark (in HSL wäre z. B. Gelb bei gleichem Wert viel
// heller als Blau). Ohne eigene Einstellung hat ein Subtyp die TYP-Farbe.
//   h: Farbton in Grad, s: Sättigung (Chroma) in % relativ,
//   l: Helligkeit in Prozentpunkten.
// Wie weit ein Subtyp jeweils abweichen darf (±), ist einstellbar
// (settings.subtypeColorRanges, siehe settings.js) - eine schon eingestellte
// Abweichung wird beim Verkleinern der Grenze darauf gekappt.
const SUBTYPE_COLOR_CHANNELS = [
  { key: "h", label: "Farbton", unit: "°" },
  { key: "s", label: "Sättigung", unit: "%" },
  { key: "l", label: "Helligkeit", unit: "%" },
];
const DEFAULT_SUBTYPE_COLOR_RANGES = { h: 25, s: 30, l: 20 };

function colorRange(settings, key) {
  const value = Number(settings.subtypeColorRanges?.[key]);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SUBTYPE_COLOR_RANGES[key];
}

// Abweichung eines Subtyps, auf die eingestellten Grenzen gekappt.
function clampedOffset(settings, offset) {
  if (!offset) return null;
  const result = {};
  for (const { key } of SUBTYPE_COLOR_CHANNELS) {
    const range = colorRange(settings, key);
    result[key] = Math.min(range, Math.max(-range, Number(offset[key]) || 0));
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

// Lineares sRGB, Kanäle ggf. außerhalb von 0..1 (außerhalb des Farbraums).
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

// Liegt die Farbe außerhalb von sRGB, wird die Sättigung (Chroma) so weit
// verringert, bis sie darstellbar ist - Farbton und Helligkeit bleiben.
function oklchToHex(color) {
  const inGamut = (rgb) => rgb.every((c) => c >= -0.0001 && c <= 1.0001);
  let rgb = oklchToLinear(color);
  if (!inGamut(rgb)) {
    let low = 0;
    let high = color.C;
    for (let i = 0; i < 20; i++) {
      const mid = (low + high) / 2;
      if (inGamut(oklchToLinear({ ...color, C: mid }))) low = mid;
      else high = mid;
    }
    rgb = oklchToLinear({ ...color, C: low });
  }
  return (
    "#" +
    rgb
      .map((c) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, c))))) * 255))
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")
  );
}

function applyColorOffset(hex, offset) {
  if (!offset) return hex;
  const base = hexToOklch(hex);
  if (!base) return hex;
  return oklchToHex({
    L: Math.min(1, Math.max(0, base.L + (offset.l ?? 0) / 100)),
    C: Math.max(0, base.C * (1 + (offset.s ?? 0) / 100)),
    H: (base.H + (offset.h ?? 0) + 360) % 360,
  });
}

function hasColorOffset(offset) {
  return !!offset && ["h", "s", "l"].some((key) => (offset[key] ?? 0) !== 0);
}

// Farbe eines Subtyps (bzw. die des TYPs, solange der Subtyp keine eigene
// Einstellung hat); null, wenn der TYP selbst keine Farbe hat.
function subtypeColor(settings, type, subtype) {
  const typeColor = settings.typeColors[type] ?? null;
  if (!typeColor || !subtype) return typeColor;
  const offset = clampedOffset(settings, getSubtype(settings, type, subtype)?.color);
  return hasColorOffset(offset) ? applyColorOffset(typeColor, offset) : typeColor;
}

// Hat der Subtyp eine eigene (innerhalb der Grenzen wirksame) Abweichung?
function subtypeHasOwnColor(settings, type, subtype) {
  return hasColorOffset(clampedOffset(settings, getSubtype(settings, type, subtype)?.color));
}

// Farbpunkt (TYP-Liste, Detailansicht, Picker, Bestätigungen): gefüllt bei
// einer eigenen Farbe, als hohler Ring beim Standardwert - ein TYP ohne Farbe
// als grauer Ring, ein Subtyp ohne eigene Einstellung als Ring in der
// TYP-Farbe, die er übernimmt.
function paintColorDot(el, color, isDefault) {
  el.style.backgroundColor = isDefault ? "transparent" : color;
  el.style.boxShadow = isDefault ? `inset 0 0 0 max(1.5px, 0.15em) ${color}` : "";
}

// viewKey (optional): Schlüssel der Ansicht in colorViews - ist dort der
// Unter-Schalter "<viewKey>Subtyp" an, gilt die Farbe des Subtyps der Notiz
// statt der ihres TYPs.
function colorForFile(plugin, file, viewKey = null) {
  const type = plugin.typIndex.typeOf(file);
  if (!type) return null;
  const { settings } = plugin;
  if (!viewKey || !settings.colorViews[`${viewKey}Subtyp`]) return settings.typeColors[type] ?? null;
  return subtypeColor(settings, type, plugin.typIndex.subtypeOf(file));
}

module.exports = {
  colorForFile,
  subtypeColor,
  applyColorOffset,
  hasColorOffset,
  subtypeHasOwnColor,
  paintColorDot,
  colorRange,
  clampedOffset,
  SUBTYPE_COLOR_CHANNELS,
  DEFAULT_SUBTYPE_COLOR_RANGES,
};
