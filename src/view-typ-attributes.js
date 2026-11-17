// A note's TYP and SUBTYP as attributes of its view (.workspace-leaf-content),
// so CSS snippets can style notes per TYP or Subtyp:
//
//   .workspace-leaf-content[data-typ="MEDIA"][data-subtyp="Film"] .metadata-container { … }
//
// Only data for CSS - TYP-System renders nothing from it. Normal note tabs
// only (markdown leaves, editing and reading view); hover previews and
// embedded notes are not covered. The values are the index keys (typOf /
// subtypOf): for a clean value simply the name; a note without one has no
// attribute. Applied from active-title-colors.js, which already visits every
// markdown leaf on the right events (including the title observer that runs
// before the paint of a newly loaded note).

const TYP_ATTR = "data-typ";
const SUBTYP_ATTR = "data-subtyp";

function setAttr(el, name, value) {
  if (value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  } else if (el.hasAttribute(name)) {
    el.removeAttribute(name);
  }
}

// file: the leaf's TFile or null.
function applyViewTypAttributes(plugin, containerEl, file) {
  setAttr(containerEl, TYP_ATTR, file ? plugin.typIndex.typOf(file) : null);
  setAttr(containerEl, SUBTYP_ATTR, file ? plugin.typIndex.subtypOf(file) : null);
}

function clearViewTypAttributes(containerEl) {
  containerEl.removeAttribute(TYP_ATTR);
  containerEl.removeAttribute(SUBTYP_ATTR);
}

module.exports = { applyViewTypAttributes, clearViewTypAttributes };
