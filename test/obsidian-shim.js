// Stand-in for the "obsidian" module, which only exists inside the app.
// Covers what src/frontmatter-text.js needs, directly or through
// src/typ-index.js. The YAML functions match Obsidian 1.13.7: it bundles
// yaml 2.7.0 (pinned in package.json) and calls it with exactly these options.
const YAML = require("yaml");

function parseYaml(text) {
  return YAML.parse(text, null, {});
}

function stringifyYaml(obj) {
  return YAML.stringify(obj, null, { nullStr: "", lineWidth: 0, aliasDuplicateObjects: false });
}

// Obsidian 1.13.7's getFrontMatterInfo, de-minified without changing its logic.
const START = /^---(\r?\n)/g;
const END = /---(\r?\n|$)/g;
const NONE = { exists: false, contentStart: 0, from: 0, to: 0, frontmatter: "" };

function getFrontMatterInfo(content) {
  START.lastIndex = 0;
  if (!START.exec(content)) return { ...NONE };
  const from = START.lastIndex;
  END.lastIndex = from;
  let match = END.exec(content);
  while (match && content.charAt(match.index - 1) !== "\n") match = END.exec(content);
  if (!match) return { ...NONE };
  const to = match.index;
  return { exists: true, frontmatter: content.slice(from, to), from, to, contentStart: END.lastIndex };
}

// Only referenced by src/typ-index.js at load time; the tests never use them.
class Events {}
class TFile {}
const debounce = (fn) => fn;

module.exports = { parseYaml, stringifyYaml, getFrontMatterInfo, Events, TFile, debounce };
