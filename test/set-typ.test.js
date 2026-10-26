// Offline tests for src/set-typ.js: the Templater task around script
// shortcuts and "New note with TYP" when an after-action renames the note
// (Databridge's fill does). Run with `npm test`.
require("./setup");
const { describe, test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { Notice } = require("obsidian");
const { setTypOfFile, createNoteWithTyp, __test } = require("../src/set-typ.js");

// A vault in a Map, a Templater with its pending-task set, and a script
// shortcut "fill" on Vorname whose after-action moves the note to `moveTo`
// (null = leaves it where it is).
function fakeApp({ moveTo = null, createdContent = null } = {}) {
  const files = new Map();
  const pending = new Set();
  const ended = [];
  const opened = [];
  const fileAt = (path) => ({ path, basename: path.replace(/^.*\//, "").replace(/\.md$/, "") });
  const app = {
    vault: {
      create: async (path, content) => {
        files.set(path, createdContent ?? content);
        return fileAt(path);
      },
      process: async (file, fn) => {
        files.set(file.path, fn(files.get(file.path) ?? ""));
      },
      getAbstractFileByPath: (path) => (files.has(path) ? fileAt(path) : null),
    },
    fileManager: {
      getNewFileParent: () => ({ path: "Inbox", isRoot: () => false }),
      renameFile: async (file, path) => {
        files.set(path, files.get(file.path));
        files.delete(file.path);
        Object.assign(file, fileAt(path));
      },
    },
    workspace: {
      getActiveFile: () => null,
      getLeaf: () => ({ openFile: async (file, state) => opened.push({ path: file.path, state }) }),
    },
    metadataCache: { getFileCache: () => null },
    plugins: {
      plugins: {
        "templater-obsidian": {
          templater: {
            start_templater_task: (path) => pending.add(path),
            end_templater_task: async (path) => {
              ended.push(path);
              pending.delete(path);
            },
            create_running_config: () => ({}),
            functions_generator: {
              generate_object: async () => ({
                user: {
                  fill: async (tp, newFile, ctx) => {
                    if (moveTo) ctx.after(() => app.fileManager.renameFile(newFile, moveTo));
                    return null;
                  },
                },
              }),
            },
          },
        },
      },
    },
  };
  return { app, files, pending, ended, opened };
}

function fakePlugin(app) {
  return {
    app,
    settings: { globalPropertyOrder: [], typDefaultFrontmatter: { KONTAKT: { Vorname: null } } },
    pickTypAndSubtyp: async () => ({ typ: "KONTAKT", subtyp: null }),
    getTypDefaults: () => ({ Vorname: null }),
    getTypShortcuts: () => ({ Vorname: { name: "fill", params: null, args: {}, fallback: null } }),
    resolveShortcutArgs: (params, args, { newFile, ctx }) => [newFile, ctx],
    collectBlocks: () => ({ defaults: { Vorname: null }, shortcuts: {} }),
  };
}

beforeEach(() => {
  Notice.messages = [];
});

describe("Templater task", () => {
  test("ended under the path it was started with, though the file was renamed meanwhile", async () => {
    const { app, pending, ended } = fakeApp();
    const file = { path: "Inbox/Untitled.md" };
    const run = await __test.openTemplaterRun(app, file);
    assert.ok(run);
    assert.deepEqual([...pending], ["Inbox/Untitled.md"]);
    file.path = "Kontakte/Anna Alpha.md";
    await run.end();
    assert.deepEqual(ended, ["Inbox/Untitled.md"]);
    assert.equal(pending.size, 0);
  });

  test("setTypOfFile: an after-action that moves the note leaves no pending task", async () => {
    const { app, files, pending, ended } = fakeApp({ moveTo: "Kontakte/Anna Alpha.md" });
    files.set("Inbox/Untitled.md", "");
    const file = { path: "Inbox/Untitled.md", basename: "Untitled" };
    const status = await setTypOfFile(fakePlugin(app), file, { typ: "KONTAKT", subtyp: null });
    assert.equal(status, "changed");
    assert.equal(file.path, "Kontakte/Anna Alpha.md");
    assert.deepEqual(ended, ["Inbox/Untitled.md"]);
    assert.equal(pending.size, 0);
    assert.match(files.get("Kontakte/Anna Alpha.md"), /^---\nTYP: KONTAKT\nVorname:/);
  });
});

describe("New note with TYP", () => {
  test("opened with the title selected for renaming while it is still the new Untitled", async () => {
    const { app, opened, pending } = fakeApp();
    await createNoteWithTyp(fakePlugin(app));
    assert.deepEqual(opened, [{ path: "Inbox/Untitled.md", state: { active: true, state: { mode: "source" }, eState: { rename: "all" } } }]);
    assert.equal(pending.size, 0);
  });

  test("renamed by an after-action: opened without the rename state", async () => {
    const { app, opened, pending } = fakeApp({ moveTo: "Kontakte/Anna Alpha.md" });
    await createNoteWithTyp(fakePlugin(app));
    assert.deepEqual(opened, [{ path: "Kontakte/Anna Alpha.md", state: { active: true, state: { mode: "source" } } }]);
    assert.equal(pending.size, 0);
  });

  test("frontmatter that can't be written without losing comments: a notice, still opened", async () => {
    const { app, opened } = fakeApp({ createdContent: "---\n# c\n{b: 1, a: 2}\n---\n" });
    await createNoteWithTyp(fakePlugin(app));
    assert.deepEqual(Notice.messages, ['TYP of "Untitled" couldn\'t be set without losing comments in its frontmatter.']);
    assert.equal(opened.length, 1);
  });
});
