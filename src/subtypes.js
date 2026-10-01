const { typeKeyOf, propertyValue, setCanonicalProperty, SUBTYP_PROPERTY } = require("./typ-index");

// Subtyp-Namen werden (anders als TYPen, siehe normalizeTypeName) mit großem
// Anfangsbuchstaben je Wort geschrieben, der Rest klein: "kurz GESCHICHTE" →
// "Kurz Geschichte". Die Property SUBTYP selbst bleibt in Großbuchstaben.
function normalizeSubtypeName(raw) {
  return raw.trim().replace(/\S+/g, (word) => word.charAt(0).toLocaleUpperCase("de") + word.slice(1).toLocaleLowerCase("de"));
}

// Registrierte SUBTYPen je TYP (settings.typeSubtypes):
//   { [TYP]: { [SUBTYP]: { frontmatter: {...}, floatingKeys: [...], shortcuts: {...}, manual?: false } } }
// Ein Subtyp gehört immer zu genau einem TYP; derselbe Name darf aber (als
// eigenständiger Subtyp) auch unter einem anderen TYP vorkommen. Die
// Reihenfolge der Schlüssel ist die Anzeigereihenfolge der Blöcke in der
// TYP-Detailansicht, stets unterhalb des TYP-Frontmatters. frontmatter
// ergänzt bzw. überschreibt das TYP-Frontmatter des TYPs, floatingKeys wie
// typeFloatingKeys, shortcuts wie typeShortcuts (siehe shortcuts.js) - je Key
// des Blocks ein Shortcut-Record, der Wert des Keys bleibt dabei als
// Rückfallwert stehen. Bestandsdaten führen shortcuts noch nicht, Leser müssen
// es daher als optional behandeln. manual wie settings.typeManual für TYPen -
// nur die Abweichung vom Standard wird gespeichert (siehe isSubtypeManual).
//
// Derselbe Key darf in mehreren Blöcken eines TYPs stehen (nur innerhalb
// EINES Blocks ist er zwangsläufig eindeutig):
//   - in zwei Subtyp-Blöcken: konfliktfrei, da eine Notiz höchstens einen
//     SUBTYP hat und die Blöcke damit nie gleichzeitig gelten;
//   - im TYP-Frontmatter UND einem Subtyp-Block: der Subtyp überschreibt
//     Wert und Floating-Markierung, die Zeile behält aber die Position des
//     TYP-Frontmatters (siehe getTypeDefaults in main.js und
//     orderedDefaultKeys in frontmatter-sort.js - beide müssen dieselbe
//     Regel verwenden, sonst sortiert die Frontmatter-Sortierung eine gerade
//     angelegte Notiz sofort wieder um).

// "Noch auszufüllen" - ein solcher Wert wird beim Zusammenlegen zweier
// Blöcke bzw. zweier Properties vom jeweils anderen gefüllt, statt den
// bestehenden Eintrag zu überschreiben (siehe mergeSubtypes hier und
// renameInStore in property-rename-sync.js).
function isEmptyValue(value) {
  return value === null || value === undefined || value === "";
}

function getSubtypeNames(settings, type) {
  return Object.keys(settings.typeSubtypes?.[type] ?? {});
}

function getSubtype(settings, type, subtype) {
  return settings.typeSubtypes?.[type]?.[subtype] ?? null;
}

function ensureSubtype(settings, type, subtype) {
  if (!settings.typeSubtypes) settings.typeSubtypes = {};
  if (!settings.typeSubtypes[type]) settings.typeSubtypes[type] = {};
  const byName = settings.typeSubtypes[type];
  if (!byName[subtype]) {
    byName[subtype] = { frontmatter: {}, floatingKeys: [], shortcuts: {} };
    // Ein neuer Subtyp eines nicht manuell erstellbaren TYPs ist selbst keiner:
    // ein manuell erstellbarer Subtyp setzt seinen TYP voraus, da der Picker
    // nur über ihn zu den Subtypen führt (siehe isSubtypeManual).
    if (settings.typeManual?.[type] === false) byName[subtype].manual = false;
  }
  return byName[subtype];
}

/* --- "Manuell erstellbar" je Subtyp --------------------------------------
 * Wie settings.typeManual für TYPen (siehe renderManualToggle in typ-view.js):
 * gespeichert wird nur die Abweichung vom Standard, also allein das Abschalten
 * (manual: false); fehlender Eintrag bzw. true bedeuten "an". Steuert, ob der
 * Subtyp in getSubtypes() (siehe main.js) und damit im Subtyp-Picker auftaucht.
 *
 * TYP und Subtypen hängen dabei zusammen, weil der Picker nur über den TYP zu
 * dessen Subtypen führt: ein abgeschalteter TYP schaltet alle seine Subtypen
 * mit ab, ein angeschalteter alle mit an (setAllSubtypesManual), und ein
 * einzeln angeschalteter Subtyp schaltet seinen TYP mit an - die übrigen
 * Subtypen bleiben davon aber unberührt (siehe renderSubtypeManualToggle in
 * typ-view.js). Damit gilt immer: ein Subtyp ist höchstens dann manuell
 * erstellbar, wenn sein TYP es auch ist.
 * --------------------------------------------------------------------- */
function isSubtypeManual(settings, type, subtype) {
  return getSubtype(settings, type, subtype)?.manual !== false;
}

function setSubtypeManual(settings, type, subtype, on) {
  const data = getSubtype(settings, type, subtype);
  if (!data) return;
  if (on) delete data.manual;
  else data.manual = false;
}

function setAllSubtypesManual(settings, type, on) {
  for (const subtype of getSubtypeNames(settings, type)) setSubtypeManual(settings, type, subtype, on);
}

// Zieht diese Regel in Bestandsdaten einmalig nach: dort gab es den Schalter
// je Subtyp noch nicht, die Subtypen eines abgeschalteten TYPs stünden also
// alle auf "an" - in der Detailansicht sichtbar als vier angeschaltete
// Subtypen unter einem abgeschalteten TYP. Liefert true bei einer Änderung.
function migrateSubtypeManual(settings) {
  let changed = false;
  for (const [type, off] of Object.entries(settings.typeManual ?? {})) {
    if (off !== false) continue;
    for (const subtype of getSubtypeNames(settings, type)) {
      if (!isSubtypeManual(settings, type, subtype)) continue;
      setSubtypeManual(settings, type, subtype, false);
      changed = true;
    }
  }
  return changed;
}

// Beim Umbenennen eines TYPs: Subtypen wandern unter den neuen Namen mit.
function moveTypeSubtypes(settings, oldType, newType) {
  if (!settings.typeSubtypes?.[oldType]) return;
  settings.typeSubtypes[newType] = settings.typeSubtypes[oldType];
  delete settings.typeSubtypes[oldType];
}

function deleteTypeSubtypes(settings, type) {
  if (settings.typeSubtypes) delete settings.typeSubtypes[type];
}

// Entfernt die Markierung aboveStandard aus Bestandsdaten: Subtyp-Blöcke
// durften früher über dem TYP-Frontmatter liegen, das steht jetzt fest ganz
// oben (siehe getSectionOrder). Liefert true bei einer Änderung.
function migrateAboveStandard(settings) {
  let changed = false;
  for (const byName of Object.values(settings.typeSubtypes ?? {})) {
    for (const data of Object.values(byName)) {
      if (data.aboveStandard === undefined) continue;
      delete data.aboveStandard;
      changed = true;
    }
  }
  return changed;
}

// Die Regler der Subtyp-Farben haben zweimal ihre Bedeutung geändert, ohne
// dass sich die gespeicherten Zahlen von selbst mitbewegt hätten (siehe
// applyColorOffset und channelBounds in type-colors.js). settings.
// subtypeColorScale hält fest, welchen Stand die gespeicherten Werte haben;
// jeder Schritt läuft genau einmal. Liefert true bei einer Änderung - die
// gehört sofort gespeichert, sonst liefe die Umrechnung beim nächsten Start
// erneut. Waren die Grenzen noch die Standardwerte des jeweiligen Stands,
// gelten danach die neuen.
//   1 -> 2: Helligkeit zählte absolute OKLCH-Punkte, jetzt den Anteil des Wegs
//           zu Weiß bzw. Schwarz. Die alte Zahl lässt sich nicht umrechnen
//           (sie hing von der TYP-Farbe ab), wohl aber die Absicht dahinter:
//           was den Regler halb ausreizte, reizt ihn auch danach halb aus.
//   2 -> 3: die Sättigung geht nur noch nach unten; gespeicherte positive
//           Werte sind sonst stumm gekappt und wären beim nächsten Öffnen des
//           Popovers unangekündigt verschwunden.
const SUBTYPE_COLOR_SCALE = 3;
const PREVIOUS_SUBTYPE_COLOR_RANGES = {
  2: { h: 25, s: 30, l: 20 },
  3: { h: 35, s: 20, l: 40 },
};

function migrateSubtypeColorScale(settings, defaultRanges) {
  const from = Number(settings.subtypeColorScale) || 1;
  if (from >= SUBTYPE_COLOR_SCALE) return false;
  const allColors = function* () {
    for (const byName of Object.values(settings.typeSubtypes ?? {})) {
      for (const data of Object.values(byName)) if (data.color) yield data.color;
    }
  };
  const adoptDefaults = (step) => {
    const previous = PREVIOUS_SUBTYPE_COLOR_RANGES[step];
    if (Object.entries(previous).every(([key, value]) => Number(settings.subtypeColorRanges?.[key]) === value)) {
      settings.subtypeColorRanges = { ...defaultRanges };
    }
  };
  if (from < 2) {
    const oldRange = Number(settings.subtypeColorRanges?.l);
    adoptDefaults(2);
    const newRange = Number(settings.subtypeColorRanges?.l);
    const factor = oldRange > 0 && Number.isFinite(newRange) ? newRange / oldRange : 1;
    for (const color of allColors()) if (color.l) color.l = Math.round(color.l * factor);
  }
  if (from < 3) {
    adoptDefaults(3);
    for (const color of allColors()) if (color.s > 0) color.s = 0;
  }
  settings.subtypeColorScale = SUBTYPE_COLOR_SCALE;
  return true;
}

// Zusammenlegen zweier TYPen: Subtypen, die es nur bei source gibt, werden
// übernommen. Gleichnamige Blöcke werden vereinigt - bei gleichem Key
// gewinnen Wert und Floating-Markierung des Ziels, Keys nur aus source
// werden hinten angehängt. Steht ein übernommener Key zugleich im
// TYP-Frontmatter des Ziels, bleiben beide stehen - daraus wird die ganz
// normale Überschreibung (siehe Kommentar an typeSubtypes oben).
function mergeTypeSubtypes(settings, source, target) {
  const sourceSubtypes = settings.typeSubtypes?.[source];
  if (!sourceSubtypes) return;
  for (const [name, sourceData] of Object.entries(sourceSubtypes)) {
    const targetData = getSubtype(settings, target, name);
    if (!targetData) {
      ensureSubtype(settings, target, name);
      settings.typeSubtypes[target][name] = sourceData;
      continue;
    }
    const targetLower = new Set(Object.keys(targetData.frontmatter).map((key) => key.toLowerCase()));
    for (const [key, value] of Object.entries(sourceData.frontmatter)) {
      if (key === "" || targetLower.has(key.toLowerCase())) continue;
      targetData.frontmatter[key] = value;
      if (sourceData.floatingKeys.includes(key)) targetData.floatingKeys.push(key);
      // Der Shortcut hängt am Key und wandert deshalb mit ihm mit.
      const shortcut = sourceData.shortcuts?.[key];
      if (shortcut) (targetData.shortcuts ??= {})[key] = shortcut;
    }
  }
  delete settings.typeSubtypes[source];
}

// Umbenennen eines Subtyps innerhalb seines TYPs - der Block behält dabei
// seine Position (Anzeigereihenfolge = Schlüsselreihenfolge).
function renameSubtype(settings, type, oldName, newName) {
  const byName = settings.typeSubtypes?.[type];
  if (!byName?.[oldName] || oldName === newName) return;
  settings.typeSubtypes[type] = Object.fromEntries(
    Object.entries(byName).map(([name, data]) => [name === oldName ? newName : name, data])
  );
}

// Reihenfolge aller Blöcke eines TYPs, null = TYP-Frontmatter. Das
// TYP-Frontmatter steht immer ganz oben, die Subtypen folgen in ihrer
// Schlüsselreihenfolge. Bestimmt die Anzeige in der TYP-Detailansicht ebenso
// wie die Frontmatter-Sortierung der Notizen (siehe orderedDefaultKeys).
function getSectionOrder(settings, type) {
  return [null, ...getSubtypeNames(settings, type)];
}

// Neue Block-Reihenfolge (Drag & Drop in der TYP-Detailansicht): order wie
// getSectionOrder, das führende null für das TYP-Frontmatter wird dabei
// ignoriert (es ist nicht verschiebbar). Nicht genannte Subtypen bleiben
// dahinter erhalten.
function reorderSubtypes(settings, type, order) {
  const byName = settings.typeSubtypes?.[type];
  if (!byName) return;
  const names = order.filter((name) => name !== null && byName[name]);
  const ordered = [...names, ...Object.keys(byName).filter((name) => !names.includes(name))];
  settings.typeSubtypes[type] = Object.fromEntries(ordered.map((name) => [name, byName[name]]));
}

function deleteSubtype(settings, type, name) {
  const byName = settings.typeSubtypes?.[type];
  if (!byName) return;
  delete byName[name];
  if (Object.keys(byName).length === 0) delete settings.typeSubtypes[type];
}

// Zusammenlegen zweier Subtypen desselben TYPs: die Properties von source
// wandern ans Ende des Ziel-Blocks, source verschwindet. Führt das Ziel einen
// Key bereits, behält es Position, Wert und Floating-Markierung - nur ein
// leerer Zielwert wird aus source gefüllt (dasselbe Muster wie renameInStore
// in property-rename-sync.js beim Zusammenlegen zweier Properties). Innerhalb
// eines Blocks bleibt jeder Key zwangsläufig eindeutig, blockübergreifende
// Dopplungen sind davon nicht betroffen.
function mergeSubtypes(settings, type, source, target) {
  const sourceData = getSubtype(settings, type, source);
  const targetData = getSubtype(settings, type, target);
  if (!sourceData || !targetData || source === target) return;

  const targetKeys = new Map(Object.keys(targetData.frontmatter).map((key) => [key.toLowerCase(), key]));
  for (const [key, value] of Object.entries(sourceData.frontmatter)) {
    if (key === "") continue;
    const existing = targetKeys.get(key.toLowerCase());
    if (existing === undefined) {
      targetData.frontmatter[key] = value;
      targetKeys.set(key.toLowerCase(), key);
      if (sourceData.floatingKeys.includes(key) && !targetData.floatingKeys.includes(key)) targetData.floatingKeys.push(key);
      // Der Shortcut hängt am Key und wandert deshalb mit ihm mit.
      const shortcut = sourceData.shortcuts?.[key];
      if (shortcut) (targetData.shortcuts ??= {})[key] = shortcut;
    } else if (isEmptyValue(targetData.frontmatter[existing])) {
      targetData.frontmatter[existing] = value;
    }
  }
  deleteSubtype(settings, type, source);
}

// Schreibt den SUBTYP-Wert aller Notizen mit TYP-Schlüssel type und
// SUBTYP-Schlüssel oldKey auf den Einzelwert newValue um - analog zu
// renameTypeInNotes() in typ-view.js.
async function renameSubtypeInNotes(plugin, type, oldKey, newValue) {
  let changed = 0;
  for (const file of plugin.typIndex.filesWithSubtype(type, oldKey)) {
    let matched = false;
    await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (typeKeyOf(propertyValue(frontmatter, SUBTYP_PROPERTY)) !== oldKey) return;
      setCanonicalProperty(frontmatter, SUBTYP_PROPERTY, newValue);
      matched = true;
    });
    if (matched) changed++;
  }
  return changed;
}

module.exports = {
  normalizeSubtypeName,
  isEmptyValue,
  getSubtypeNames,
  getSubtype,
  ensureSubtype,
  isSubtypeManual,
  setSubtypeManual,
  setAllSubtypesManual,
  migrateSubtypeManual,
  migrateAboveStandard,
  migrateSubtypeColorScale,
  moveTypeSubtypes,
  deleteTypeSubtypes,
  mergeTypeSubtypes,
  renameSubtype,
  getSectionOrder,
  reorderSubtypes,
  deleteSubtype,
  mergeSubtypes,
  renameSubtypeInNotes,
};
