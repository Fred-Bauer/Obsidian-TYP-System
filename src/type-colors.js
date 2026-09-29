const { getSubtype } = require("./subtypes");

// --- Subtyp-Farben ----------------------------------------------------------
// Ein Subtyp speichert keine eigene Farbe, sondern nur eine Abweichung von der
// Farbe seines TYPs (settings.typeSubtypes[TYP][SUBTYP].color = { h, l }; in
// Bestandsdaten steht dort noch ein wirkungsloses s, siehe
// SUBTYPE_COLOR_CHANNELS).
// Die tatsächliche Farbe wird jedes Mal aus der aktuellen TYP-Farbe berechnet
// - ändert sich die, ziehen alle Subtypen mit und bleiben in der Farbfamilie.
// Gerechnet wird in OKLCH statt HSL: dort wirkt eine Helligkeitsänderung über
// alle Farbtöne ähnlich stark (in HSL wäre z. B. Gelb bei gleichem Wert viel
// heller als Blau). Ohne eigene Einstellung hat ein Subtyp die TYP-Farbe.
//   h: Farbton, verschoben um Grad;
//   l: Helligkeit in % des Wegs zu Weiß (+) bzw. Schwarz (-).
// Warum beide relativ rechnen und die Sättigung dabei von allein mitzieht,
// steht ausführlich an applyColorOffset.
// Wie weit ein Subtyp jeweils abweichen darf (±), ist einstellbar
// (settings.subtypeColorRanges, siehe settings.js) - eine schon eingestellte
// Abweichung wird beim Verkleinern der Grenze darauf gekappt.
// Diese Liste ist die einzige Quelle: aus ihr bauen sich die Regler im
// Popover, die Grenzen in den Einstellungen und die Kappung. Ein hier
// auskommentierter Kanal verschwindet überall und wird nicht mehr gespeichert.
//
// Die Sättigung ist stillgelegt. Sie war ursprünglich nötig, um auszugleichen,
// was Helligkeit und Farbton der Farbe an Sättigung wegnahmen - seit beide
// Regler die Sättigung von allein mitführen (siehe computeColorOffset) blieb
// ihr nur noch die Aussage "dieser Subtyp nimmt sich zurück", und dafür lohnt
// ein dritter Regler nicht. Zum Wiederbeleben: hier, in
// DEFAULT_SUBTYPE_COLOR_RANGES, im Rechenweg von computeColorOffset und bei
// rangeMax/rangeDesc in settings.js jeweils die Auskommentierung aufheben.
// downOnly: der Regler reicht nur von -Grenze bis 0. Ein Subtyp soll sich
// zurücknehmen dürfen, aber nicht kräftiger auftreten als sein TYP - bunter
// als die Hauptfarbe zieht die Aufmerksamkeit genau falsch herum.
const SUBTYPE_COLOR_CHANNELS = [
  { key: "h", label: "Farbton", unit: "°" },
  // { key: "s", label: "Sättigung", unit: "%", downOnly: true },
  { key: "l", label: "Helligkeit", unit: "%" },
];
// Subtypen sollen vor allem unterscheidbar sein: Farbton trägt dazu am
// meisten bei und bekommt den größten Spielraum, Helligkeit als zweite klar
// erkennbare Achse ebenfalls reichlich.
const DEFAULT_SUBTYPE_COLOR_RANGES = { h: 35, /* s: 40, */ l: 40 };

function colorRange(settings, key) {
  const value = Number(settings.subtypeColorRanges?.[key]);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SUBTYPE_COLOR_RANGES[key];
}

// Von wo bis wo ein Regler reicht - eine Stelle für Popover, Kappung und
// Verlaufsvorschau, damit die drei nicht auseinanderlaufen.
function channelBounds(settings, key) {
  const range = colorRange(settings, key);
  return SUBTYPE_COLOR_CHANNELS.find((channel) => channel.key === key)?.downOnly ? [-range, 0] : [-range, range];
}

// Abweichung eines Subtyps, auf die eingestellten Grenzen gekappt.
function clampedOffset(settings, offset) {
  if (!offset) return null;
  const result = {};
  for (const { key } of SUBTYPE_COLOR_CHANNELS) {
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

const inGamut = (rgb) => rgb.every((c) => c >= -0.0001 && c <= 1.0001);

// Größtes bei dieser Helligkeit und diesem Farbton in sRGB noch darstellbares
// Chroma. Diese Grenze schwankt stark - reines Gelb verträgt nur knapp unter
// Weiß viel Chroma, Blau am meisten in der Mitte -, und genau an ihr scheitert
// jede Rechnung, die Chroma absolut festhält (siehe applyColorOffset).
function maxChroma(L, H) {
  let low = 0;
  let high = 0.4; // über dem sRGB-Maximum (~0,32)
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    if (inGamut(oklchToLinear({ L, C: mid, H }))) low = mid;
    else high = mid;
  }
  return low;
}

// Liegt die Farbe außerhalb von sRGB, wird die Sättigung (Chroma) so weit
// verringert, bis sie darstellbar ist - Farbton und Helligkeit bleiben. Für
// applyColorOffset ist das nur noch ein Sicherheitsnetz: dort steht das
// Chroma ohnehin schon als Anteil des darstellbaren Maximums fest.
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

// Helligkeit des Scheitels eines Farbtons: dort trägt er das meiste Chroma.
// maxChroma steigt über die Helligkeit bis dorthin und fällt danach wieder, so
// dass die Spitze sich einkreisen lässt. Je Farbton ein fester Wert, und die
// Suche ist teuer - darum nach ganzen Grad gemerkt.
const cuspCache = new Map();

// Ab hier gilt eine Farbe als bunt. Ein reines Grau kommt aus hexToOklch nicht
// mit Chroma 0 zurück, sondern mit rund 2e-8 und einem beliebigen Farbton -
// die Matrixkonstanten sind gerundet. Auf "größer als 0" zu prüfen führte die
// Helligkeit eines Graus also dem Scheitel eines Farbtons nach, den es gar
// nicht hat. Die Schwelle liegt weit unter allem, was in 8 Bit sichtbar wäre
// (ein Schritt von 1/255 in einem Kanal ergibt rund 0,002).
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

// Dieselbe Helligkeit, aber gemessen am Scheitel des Zielfarbtons statt am
// eigenen: der Scheitel geht auf den Scheitel, Schwarz auf Schwarz und Weiß
// auf Weiß, dazwischen linear. Ohne Farbtondrehung kommt die Helligkeit
// unverändert zurück.
function remapToCusp(L, fromH, toH) {
  const from = cuspLightness(fromH);
  const to = cuspLightness(toH);
  if (L <= from) return from > 0 ? (L / from) * to : to;
  return from < 1 ? to + ((L - from) / (1 - from)) * (1 - to) : to;
}

// Die beiden Suchen nach der Gamut-Grenze kosten je Farbe rund 10 µs - zu
// viel, wenn der Dateibaum oder der Graph sie für jede Datei erneut anstößt
// (siehe colorForFile). Verschiedene Farben gibt es dabei nur eine Handvoll,
// eine je TYP/SUBTYP, also genügt ein Zwischenspeicher; beim Ziehen eines
// Reglers wächst er um jede Zwischenstellung und wird darum ab und zu geleert.
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

// Beide Regler wirken relativ zur TYP-Farbe, damit der Subtyp in der
// Familie bleibt. Absolute Werte halten nicht, was sie versprechen, denn wie
// viel Farbe sRGB überhaupt hergibt, hängt von Helligkeit UND Farbton ab:
//   l: Anteil des Wegs zu Weiß (+) bzw. Schwarz (-). Absolute OKLCH-Punkte
//      liefen bei einer ohnehin hellen TYP-Farbe schon in der ersten
//      Reglerhälfte auf reines Weiß, und der Rest des Reglers tat nichts mehr.
//   h: Grad - als einziger absolut, ABER er führt die Helligkeit mit (siehe
//      remapToCusp). Jeder Farbton trägt sein meistes Chroma auf einer anderen
//      Helligkeit: Gelb erst bei L 0,92, Orange schon bei 0,78, Blau bei 0,49.
//      Eine helle gelbe TYP-Farbe auf Orange zu drehen und dabei die
//      Helligkeit festzuhalten, setzt sie weit über den Scheitel von Orange -
//      dort trägt der Farbraum fast kein Chroma mehr, und heraus kommt ein
//      blasses Pastell, das neben seinem TYP wie ausgewaschen und viel zu hell
//      wirkt (rechnerisch ist es genauso hell, aber blass liest sich als hell).
//      Führt die Helligkeit dagegen den Scheitel nach, bleibt die Farbkraft
//      über die ganze Drehung praktisch gleich.
// Einen eigenen Regler für die Sättigung gibt es nach all dem nicht mehr - sie
// zieht bei beiden anderen von allein mit (stillgelegt, siehe
// SUBTYPE_COLOR_CHANNELS).
//
// Sind die Helligkeiten so aufeinander bezogen, ist auch das Chroma wieder
// schlicht ein Anteil an der Decke (base.C / maxChroma am Ausgangspunkt, dann
// mal maxChroma am Ziel): die Decken zweier Farbtöne sind erst dadurch
// überhaupt vergleichbar.
//
// WAS DIESER ANTEIL IST UND WAS NICHT. "Anteil an der Decke" ist eine
// Entscheidung über sRGB, keine über Wahrnehmung - das sieht man dem Code
// nicht an, weil er sonst durchweg in einem wahrnehmungsnahen Raum rechnet.
// maxChroma beschreibt die Hülle eines Ausgabegeräts. Konstant gehalten wird
// hier also "gleich weit ausgereizt", nicht "gleich bunt" (das wäre konstantes
// C) und nicht "gleich gesättigt" (das wäre konstantes C/L). Daraus folgt:
//   - Das Modell ist an sRGB gebunden. In einem weiteren Farbraum ergäben
//     dieselben Eingaben andere Farben, weil die Decke woanders liegt.
//   - remapToCusp gibt gleiche wahrgenommene Helligkeit bewusst auf: nach
//     einer Farbtondrehung ist der Subtyp nicht mehr gleich hell wie sein TYP,
//     sondern gleich nachdrücklich. Das ist hier erwünscht, aber es ist eine
//     Gestaltungsentscheidung und kein perzeptuelles Gesetz.
//   - Über die Helligkeit ist das Chroma nicht monoton. Liegt eine TYP-Farbe
//     über ihrem Scheitel, steigt es auf dem Weg nach unten erst an und fällt
//     dann wieder (ein blaues #7878dc hat bei -20 % mehr Chroma als bei 0 %
//     und bei -40 %). Der Regler fährt dort über einen Buckel.
// Für farbige Dateinamen ist all das tragbar - wer das Modell strenger haben
// will, müsste die Bezugsgröße wechseln, nicht die Formeln nachbessern.
//
// Auch OKLab selbst ist nicht spannungsfrei: seine Farbtonlinien laufen im
// Blaubereich (H 260-290) merklich an der Wahrnehmung vorbei, Blau zieht beim
// Aufhellen ins Violette. Rechnerisch bleibt der Farbton dort konstant, was
// das Problem eher verdeckt als behebt. Eine TYP-Farbe in diesem Bereich also
// lieber nachsehen als den Zahlen glauben.
function computeColorOffset(hex, offset) {
  const base = hexToOklch(hex);
  if (!base) return hex;
  const H = (base.H + (offset.h ?? 0) + 360) % 360;
  const baseCeiling = maxChroma(base.L, base.H);
  // Eine graue TYP-Farbe bleibt grau, und ihr Farbton ist bedeutungslos - dann
  // gibt es auch keinen Scheitel, dem die Helligkeit folgen könnte.
  const neutral = base.C < NEUTRAL_CHROMA || baseCeiling <= 0;
  const relative = neutral ? 0 : base.C / baseCeiling;
  const shifted = neutral ? base.L : remapToCusp(base.L, base.H, H);
  const share = (offset.l ?? 0) / 100;
  const L = Math.min(1, Math.max(0, shifted + share * (share >= 0 ? 1 - shifted : shifted)));
  const C = relative * maxChroma(L, H); /* * (1 + (offset.s ?? 0) / 100) - Sättigung stillgelegt */
  return oklchToHex({ L, C: Math.max(0, C), H });
}

function hasColorOffset(offset) {
  return !!offset && SUBTYPE_COLOR_CHANNELS.some(({ key }) => (offset[key] ?? 0) !== 0);
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
  channelBounds,
  clampedOffset,
  SUBTYPE_COLOR_CHANNELS,
  DEFAULT_SUBTYPE_COLOR_RANGES,
};
