// Offline tests for src/frontmatter-text.js (comment-preserving frontmatter writes).
// Run with `npm test`.
require("./setup");
const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { parseYaml, stringifyYaml, getFrontMatterInfo } = require("obsidian");
const { editFrontmatterText, skippedText } = require("../src/frontmatter-text.js");

const run = (content, mutate) => editFrontmatterText(content, mutate);
const reorder = (keys) => (doc) => doc.reorder(keys);
const keepOrder = (doc) => doc.reorder(doc.keys());
const body = "\n# Body\n\nText # not frontmatter\n";

// The text logic of Obsidian's processFrontMatter: parse, mutate, serialize.
// Reference for what the fallback has to produce.
function processFrontMatterText(content, fn) {
  const info = getFrontMatterInfo(content);
  let data = info.exists ? parseYaml(info.frontmatter) : {};
  if (!(data && typeof data === "object")) data = {};
  fn(data);
  if (Object.keys(data).length === 0) return info.exists ? content.slice(info.contentStart) : content;
  const yaml = stringifyYaml(data);
  return info.exists
    ? content.slice(0, info.from) + yaml + content.slice(info.to)
    : "---\n" + yaml + "---\n" + content;
}

describe("1. comments above / beside keys, header, footer", () => {
  const c = "---\n# header comment\n\n# about b\nb: 2 # inline b\na: 1\n# about c\nc: 3\n# footer\n---" + body;

  test("status", () => {
    assert.equal(run(c, reorder(["a", "b", "c"])).status, "changed");
  });
  test("text", () => {
    assert.equal(run(c, reorder(["a", "b", "c"])).content, "---\n# header comment\n\na: 1\n# about b\nb: 2 # inline b\n# about c\nc: 3\n# footer\n---" + body);
  });
  test("c first", () => {
    assert.equal(run(c, reorder(["c", "b", "a"])).content, "---\n# header comment\n\n# about c\nc: 3\n# about b\nb: 2 # inline b\na: 1\n# footer\n---" + body);
  });
  test("leading comment of first property moves with it", () => {
    assert.equal(run("---\n# about b\nb: 2\na: 1\n---\n", reorder(["a", "b"])).content, "---\na: 1\n# about b\nb: 2\n---\n");
  });
});

describe("2. lists: indented and column 0, comment in the list", () => {
  const c = "---\ntags:\n  - x\n  # inner\n  - y\nTYP: BUCH\nauthors:\n- A\n# col0 comment in list?\n- B\nz: 1\n---\n";

  test("status", () => {
    assert.equal(run(c, reorder(["TYP", "z", "authors", "tags"])).status, "changed");
  });
  test("text", () => {
    assert.equal(run(c, reorder(["TYP", "z", "authors", "tags"])).content, "---\nTYP: BUCH\nz: 1\nauthors:\n- A\n# col0 comment in list?\n- B\ntags:\n  - x\n  # inner\n  - y\n---\n");
  });
});

describe("3. block scalars with blank lines", () => {
  const c = "---\nlit: |\n  line 1\n\n  line 3\nfold: >\n  folded\n\n  para\nTYP: X\n---\n";

  test("text", () => {
    assert.equal(run(c, reorder(["TYP", "fold", "lit"])).content, "---\nTYP: X\nfold: >\n  folded\n\n  para\nlit: |\n  line 1\n\n  line 3\n---\n");
  });
  test("values equal", () => {
    const before = parseYaml(c.split("---\n")[1]);
    const after = parseYaml(run(c, reorder(["TYP", "fold", "lit"])).content.split("---\n")[1]);
    assert.deepEqual([after.lit, after.fold], [before.lit, before.fold]);
  });
  test("|+ with trailing blank, no comments -> fallback", () => {
    assert.equal(run("---\nlit: |+\n  keep\n\nb: 1\n---\n", reorder(["b", "lit"])).status, "changed");
  });
  test("|+ with comment -> skipped", () => {
    assert.equal(run("---\n# c\nlit: |+\n  keep\n\nb: 1\n---\n", reorder(["b", "lit"])).status, "skipped");
  });
});

describe("4. keys in different case, rename via set", () => {
  const c = "---\ntitle: T\ntyp: zztest # my comment\nSubtyp: Arzt\n---\n";

  test("rename with inline comment", () => {
    assert.equal(run(c, (d) => d.set("TYP", "ZZTEST")).content, "---\ntitle: T\nTYP: ZZTEST # my comment\nSubtyp: Arzt\n---\n");
  });
  test("subtyp", () => {
    assert.equal(run(c, (d) => d.set("SUBTYP", "Ärztin")).content, "---\ntitle: T\ntyp: zztest # my comment\nSUBTYP: Ärztin\n---\n");
  });
  test("variants merged", () => {
    assert.equal(run("---\nTyp: a\nx: 1\n# about TYP\nTYP: b\n---\n", (d) => d.set("TYP", "NEW")).content, "---\n# about TYP\nTYP: NEW\nx: 1\n---\n");
  });
  test("list -> value", () => {
    assert.equal(run("---\n# the typ\nTYP:\n  - person\n  - buch\nb: 1\n---\n", (d) => d.set("TYP", "PERSON, BUCH")).content, "---\n# the typ\nTYP: PERSON, BUCH\nb: 1\n---\n");
  });
  test("list with inner comment -> skipped", () => {
    assert.equal(run("---\nTYP:\n  - person # p\n  - buch\nb: 1\n---\n", (d) => d.set("TYP", "X")).status, "skipped");
  });
  test("same value unchanged", () => {
    assert.equal(run("---\nTYP: A # c\n---\n", (d) => d.set("TYP", "A")).status, "unchanged");
  });
  test("quoted hash", () => {
    assert.equal(run("---\nTYP: \"a # b\"\nx: 1\n---\n", (d) => d.set("TYP", "Z")).content, "---\nTYP: Z\nx: 1\n---\n");
  });
  test("hash in plain value + comment", () => {
    assert.equal(run("---\nTYP: a#b   # c\n---\n", (d) => d.set("TYP", "Q")).content, "---\nTYP: Q   # c\n---\n");
  });
  test("empty value + comment", () => {
    assert.equal(run("---\nTYP: # c\n---\n", (d) => d.set("TYP", "Q")).content, "---\nTYP: Q # c\n---\n");
  });
});

describe("5. empty values, quote styles stay byte-equal", () => {
  test("quotes/empties", () => {
    const c = "---\na: 'single'\nb: \"double\"\nc:\nd: ''\ne: []\nf: {x: 1}\ng: 2024-01-01\nh: \"123\"\n---\n";
    assert.equal(run(c, reorder(["h", "g", "f", "e", "d", "c", "b", "a"])).content, "---\nh: \"123\"\ng: 2024-01-01\nf: {x: 1}\ne: []\nd: ''\nc:\nb: \"double\"\na: 'single'\n---\n");
  });
});

describe("6. CRLF", () => {
  const c = "---\r\n# about b\r\nb: 2\r\na: 1\r\nl:\r\n  - x\r\n---\r\nBody\r\n";

  test("reorder", () => {
    assert.equal(run(c, reorder(["a", "l", "b"])).content, "---\r\na: 1\r\nl:\r\n  - x\r\n# about b\r\nb: 2\r\n---\r\nBody\r\n");
  });
  test("new unit", () => {
    assert.equal(run(c, (d) => d.set("NEW", ["p", "q"])).content, "---\r\n# about b\r\nb: 2\r\na: 1\r\nl:\r\n  - x\r\nNEW:\r\n  - p\r\n  - q\r\n---\r\nBody\r\n");
  });
  test("set", () => {
    assert.equal(run("---\r\nTYP: a\r\n---\r\n", (d) => d.set("TYP", "B")).content, "---\r\nTYP: B\r\n---\r\n");
  });
  test("fallback", () => {
    assert.equal(run("---\r\n{b: 1, a: 2}\r\n---\r\nx\r\n", reorder(["a", "b"])).content, "---\r\na: 2\r\nb: 1\r\n---\r\nx\r\n");
  });
});

describe("7. flow mapping, anchors/aliases, complex keys, duplicates", () => {
  test("flow mapping without comments -> fallback", () => {
    assert.deepEqual(run("---\n{b: 1, a: 2}\n---\n", reorder(["a", "b"])), { status: "changed", content: "---\na: 2\nb: 1\n---\n" });
  });
  test("flow mapping with comment -> skipped", () => {
    assert.equal(run("---\n# c\n{b: 1, a: 2}\n---\n", reorder(["a", "b"])).status, "skipped");
  });
  test("alias before anchor (invalid YAML) -> skipped", () => {
    assert.equal(run("---\nb: *x\na: &x 1\n---\n", reorder(["a", "b"])).status, "skipped");
  });
  test("alias across units, no comments -> fallback like processFrontMatter", () => {
    const c = "---\na: &x [1, 2]\nb: *x\nc: 3\n---\n";
    const want = processFrontMatterText(c, (o) => {
      const saved = { ...o };
      for (const k of Object.keys(o)) delete o[k];
      for (const k of ["c", "a", "b"]) o[k] = saved[k];
    });
    assert.deepEqual(run(c, reorder(["c", "a", "b"])), { status: "changed", content: want });
  });
  test("alias with comments -> skipped", () => {
    assert.equal(run("---\na: &x 1 # c\nb: *x\n---\n", reorder(["b", "a"])).status, "skipped");
  });
  test("anchor without alias is fine", () => {
    assert.equal(run("---\nb: 2 # c\na: &x 1\n---\n", reorder(["a", "b"])).content, "---\na: &x 1\nb: 2 # c\n---\n");
  });
  test("complex key with comment -> skipped", () => {
    assert.equal(run("---\n# c\n? a\n: 1\nb: 2\n---\n", reorder(["b", "a"])).status, "skipped");
  });
  test("complex key without comment -> fallback", () => {
    assert.equal(run("---\n? a\n: 1\nb: 2\n---\n", reorder(["b", "a"])).content, "---\nb: 2\na: 1\n---\n");
  });
  test("unsafe with comments but nothing to do -> unchanged", () => {
    assert.equal(run("---\n# c\nother: &x 1\nalpha: *x\n---\n", keepOrder).status, "unchanged");
  });
  test("unsafe with comments, set same value -> unchanged", () => {
    assert.equal(run("---\na: &x 1 # c\nTYP: *x\n---\n", (d) => d.set("TYP", 1)).status, "unchanged");
  });
  test("duplicate keys -> skipped", () => {
    assert.equal(run("---\na: 1\na: 2\n---\n", keepOrder).status, "skipped");
  });
});

describe("8. no / empty frontmatter", () => {
  test("no frontmatter: reorder nothing", () => {
    assert.deepEqual(run("Just text\n", keepOrder), { status: "unchanged", content: "Just text\n" });
  });
  test("no frontmatter: set creates block", () => {
    assert.equal(run("Just text\n", (d) => d.set("TYP", "A")).content, "---\nTYP: A\n---\nJust text\n");
  });
  test("no frontmatter, CRLF: set creates CRLF block", () => {
    assert.equal(run("Line\r\nmore\r\n", (d) => d.set("TYP", "A")).content, "---\r\nTYP: A\r\n---\r\nLine\r\nmore\r\n");
  });
  test("empty file: set", () => {
    assert.equal(run("", (d) => d.set("TYP", "A")).content, "---\nTYP: A\n---\n");
  });
  test("empty block unchanged", () => {
    assert.deepEqual(run("---\n---\nx\n", keepOrder), { status: "unchanged", content: "---\n---\nx\n" });
  });
  test("empty block: set", () => {
    assert.equal(run("---\n---\nx\n", (d) => d.set("TYP", "A")).content, "---\nTYP: A\n---\nx\n");
  });
  test("comment-only block: set", () => {
    assert.equal(run("---\n# hi\n---\nx\n", (d) => d.set("TYP", "A")).content, "---\n# hi\nTYP: A\n---\nx\n");
  });
  test("delete last property removes block", () => {
    assert.equal(run("---\nTYP: A\n---\nx\n", (d) => d.delete("typ")).content, "x\n");
  });
  test("delete last property keeps comment block", () => {
    assert.equal(run("---\n# hi\n\nTYP: A\n---\nx\n", (d) => d.delete("TYP")).content, "---\n# hi\n\n---\nx\n");
  });
  test("frontmatter at end of file without newline", () => {
    assert.equal(run("---\nb: 1\na: 2\n---", reorder(["a", "b"])).content, "---\na: 2\nb: 1\n---");
  });
});

describe("9. BOM", () => {
  test("reorder", () => {
    assert.equal(run("﻿---\nb: 1 # c\na: 2\n---\nx\n", reorder(["a", "b"])).content, "﻿---\na: 2\nb: 1 # c\n---\nx\n");
  });
  test("set", () => {
    assert.equal(run("﻿---\nTYP: a\n---\n", (d) => d.set("TYP", "B")).content, "﻿---\nTYP: B\n---\n");
  });
  test("no frontmatter: set", () => {
    assert.equal(run("﻿text\n", (d) => d.set("TYP", "B")).content, "﻿---\nTYP: B\n---\ntext\n");
  });
  test("fallback", () => {
    assert.equal(run("﻿---\n{b: 1, a: 2}\n---\n", reorder(["a", "b"])).content, "﻿---\na: 2\nb: 1\n---\n");
  });
  test("delete all", () => {
    assert.equal(run("﻿---\nTYP: a\n---\nx\n", (d) => d.delete("TYP")).content, "﻿x\n");
  });
});

describe("10. misc", () => {
  test("reorder into same order -> unchanged", () => {
    assert.deepEqual(run("---\na: 1 # c\nb: 2\n---\n", keepOrder), { status: "unchanged", content: "---\na: 1 # c\nb: 2\n---\n" });
  });
  test("fallback unchanged writes nothing", () => {
    assert.deepEqual(run("---\n{a: 1}\n---\n", keepOrder), { status: "unchanged", content: "---\n{a: 1}\n---\n" });
  });
  test("nested map with comment", () => {
    assert.equal(run("---\nmeta:\n  # inner\n  x: 1\n  y: [1, 2]\nTYP: A\n---\n", reorder(["TYP", "meta"])).content, "---\nTYP: A\nmeta:\n  # inner\n  x: 1\n  y: [1, 2]\n---\n");
  });
  test("toObject/get/findKey/has", () => {
    let seen;
    run("---\ntyp: a\nb: [1]\n---\n", (d) => { seen = [d.toObject(), d.get("b"), d.findKey("TYP"), d.has("TYP")]; });
    assert.deepEqual(seen, [{ typ: "a", b: [1] }, [1], "typ", false]);
  });
  test("delete with leading comment", () => {
    assert.equal(run("---\na: 1\n# about b\nb: 2\nc: 3\n---\n", (d) => d.delete("B")).content, "---\na: 1\nc: 3\n---\n");
  });
  test("top-level list -> skipped", () => {
    assert.equal(run("---\n- a\n- b\n---\n", keepOrder).status, "skipped");
  });
  test("invalid YAML -> skipped", () => {
    assert.equal(run("---\na: [1\nb: 2\n---\n", keepOrder).status, "skipped");
  });
  test("key with colon in quotes", () => {
    assert.equal(run("---\n\"x: y\": 1 # c\na: 2\n---\n", reorder(["a", "x: y"])).content, "---\na: 2\n\"x: y\": 1 # c\n---\n");
  });
  test("mixed EOL kept per line", () => {
    assert.equal(run("---\nb: 1\r\na: 2\n---\n", reorder(["a", "b"])).content, "---\na: 2\nb: 1\r\n---\n");
  });
  test("new multi-line value with inline comment -> skipped", () => {
    assert.equal(run("---\nTYP: a # c\n---\n", (d) => d.set("TYP", ["x", "y"])).status, "skipped");
  });
  test("skippedText", () => {
    assert.deepEqual(
      [skippedText(0, "x"), skippedText(1, "re-sorted"), skippedText(3, "updated")],
      ["", " 1 note skipped (frontmatter can't be re-sorted without losing comments).", " 3 notes skipped (frontmatter can't be updated without losing comments)."],
    );
  });
  test("reorder with wrong keys throws", () => {
    assert.throws(() => run("---\na: 1\n---\n", reorder(["zz"])), { message: "reorder: keys don't match the frontmatter" });
  });
  test("--- in body untouched", () => {
    assert.equal(run("---\nb: 1\na: 2\n---\ntext\n---\nmore\n", reorder(["a", "b"])).content, "---\na: 2\nb: 1\n---\ntext\n---\nmore\n");
  });
  test("unicode keys", () => {
    assert.equal(run("---\nÜber: 1\nA: 2\n---\n", reorder(["A", "Über"])).content, "---\nA: 2\nÜber: 1\n---\n");
  });
  test("trailing blank line before ---", () => {
    assert.equal(run("---\nb: 1\na: 2\n\n---\n", reorder(["a", "b"])).content, "---\na: 2\nb: 1\n\n---\n");
  });
  test("ObjectDoc set via fallback", () => {
    assert.equal(run("---\n{typ: a, b: 1}\n---\n", (d) => d.set("TYP", "X")).content, "---\nTYP: X\nb: 1\n---\n");
  });
  test("mutate error propagates", () => {
    assert.throws(() => run("---\na: 1\n---\n", () => { throw new Error("boom"); }), { message: "boom" });
  });
  test("block scalar with # content -> reorder ok", () => {
    assert.equal(run("---\nb: |\n  # not a comment\na: 1\n---\n", reorder(["a", "b"])).content, "---\na: 1\nb: |\n  # not a comment\n---\n");
  });
  test("indented key line under list (2 levels)", () => {
    assert.equal(run("---\nb:\n  - x: 1\n    y: 2\na: 1\n---\n", reorder(["a", "b"])).content, "---\na: 1\nb:\n  - x: 1\n    y: 2\n---\n");
  });
});
