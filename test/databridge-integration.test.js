// Offline tests for src/databridge-integration.js (the Databridge hook that
// keeps TYP/SUBTYP and the sort order on imported notes). Run with `npm test`.
require("./setup");
const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const {
  existingSubtyp,
  createDatabridgeIntegration,
  registerDatabridgeIntegration,
} = require("../src/databridge-integration.js");

// Records the calls instead of touching settings.
function spyPlugin() {
  const calls = [];
  return {
    calls,
    applyTypProperties: (fm, typ, subtyp) => calls.push(["apply", typ, subtyp]),
    sortFrontmatter: (fm, typ, subtyp) => calls.push(["sort", typ, subtyp]),
  };
}

// One Databridge write: prepare, the write's own mutation, finalize.
function write(integration, frontmatter, { isNew = false, changes = [], mutate = () => {} } = {}) {
  const ctx = { definitionId: "d", path: "x.md", isNew, changes, state: {} };
  integration.prepare(frontmatter, ctx);
  mutate(frontmatter);
  integration.finalize(frontmatter, ctx);
  return ctx;
}

describe("existingSubtyp", () => {
  test("case-insensitive key, non-blank string only", () => {
    assert.equal(existingSubtyp({ Subtyp: "Kurs" }), "Kurs");
    assert.equal(existingSubtyp({ SUBTYP: "  " }), null);
    assert.equal(existingSubtyp({ SUBTYP: ["Kurs"] }), null);
    assert.equal(existingSubtyp({}), null);
  });
});

describe("integration", () => {
  test("SUBTYP captured in prepare (any spelling) and passed on", () => {
    const plugin = spyPlugin();
    const integration = createDatabridgeIntegration(plugin);
    const ctx = write(integration, { typ: "ORGA", subtyp: "Kurs", Ort: "R 1" }, { changes: [{ key: "Ort", from: "R 1", to: "R 2" }] });
    assert.equal(ctx.state.subtyp, "Kurs");
    assert.deepEqual(plugin.calls, [["apply", "ORGA", "Kurs"], ["sort", "ORGA", "Kurs"]]);
  });

  test("no TYP, a blank TYP or a list TYP: nothing is called", () => {
    const plugin = spyPlugin();
    const integration = createDatabridgeIntegration(plugin);
    write(integration, { Ort: "R 1" });
    write(integration, { TYP: " " });
    write(integration, { TYP: ["ORGA"] });
    assert.deepEqual(plugin.calls, []);
  });

  test("a new note keeps the SUBTYP its create.set wrote", () => {
    const plugin = spyPlugin();
    const integration = createDatabridgeIntegration(plugin);
    write(integration, {}, { isNew: true, mutate: (fm) => Object.assign(fm, { TYP: "ORGA", SUBTYP: "Kurs" }) });
    assert.deepEqual(plugin.calls, [["apply", "ORGA", "Kurs"], ["sort", "ORGA", "Kurs"]]);
  });

  test("a change of SUBTYP (any spelling) uses the new value", () => {
    const plugin = spyPlugin();
    const integration = createDatabridgeIntegration(plugin);
    write(integration, { TYP: "ORGA", SUBTYP: "Alt" }, {
      changes: [{ key: "Subtyp", from: "Alt", to: "Neu" }],
      mutate: (fm) => (fm.SUBTYP = "Neu"),
    });
    assert.deepEqual(plugin.calls[0], ["apply", "ORGA", "Neu"]);
  });

  test("without a SUBTYP change the value from before the write is kept", () => {
    const plugin = spyPlugin();
    const integration = createDatabridgeIntegration(plugin);
    // Even if the frontmatter object lost it meanwhile.
    write(integration, { TYP: "ORGA", SUBTYP: "Kurs" }, { mutate: (fm) => delete fm.SUBTYP });
    assert.deepEqual(plugin.calls[0], ["apply", "ORGA", "Kurs"]);
  });

  test("state is per write", () => {
    const plugin = spyPlugin();
    const integration = createDatabridgeIntegration(plugin);
    write(integration, { TYP: "ORGA", SUBTYP: "Kurs" });
    write(integration, { TYP: "ORGA" });
    assert.deepEqual(plugin.calls.filter((c) => c[0] === "apply"), [["apply", "ORGA", "Kurs"], ["apply", "ORGA", null]]);
  });
});

describe("registration", () => {
  function fakeApi() {
    const registered = [];
    return {
      registered,
      registerIntegration(integration) {
        registered.push(integration);
        return () => registered.splice(registered.indexOf(integration), 1);
      },
    };
  }

  function fakeHost(existingApi) {
    const handlers = new Map();
    const cleanups = [];
    const plugin = {
      ...spyPlugin(),
      app: {
        workspace: {
          on: (name, fn) => {
            handlers.set(name, fn);
            return { name };
          },
        },
        plugins: { plugins: existingApi ? { databridge: { api: existingApi } } : {} },
      },
      registerEvent: () => {},
      register: (fn) => cleanups.push(fn),
    };
    return { plugin, ready: (api) => handlers.get("databridge:ready")(api), unload: () => cleanups.forEach((fn) => fn()) };
  }

  test("registers at once when Databridge is already loaded", () => {
    const api = fakeApi();
    registerDatabridgeIntegration(fakeHost(api).plugin);
    assert.deepEqual(api.registered.map((i) => i.id), ["typ-system"]);
  });

  test("a later databridge:ready re-registers after the old unregister", () => {
    const first = fakeApi();
    const host = fakeHost(first);
    registerDatabridgeIntegration(host.plugin);
    const second = fakeApi();
    host.ready(second);
    assert.deepEqual(first.registered, []);
    assert.deepEqual(second.registered.map((i) => i.id), ["typ-system"]);
    // The same API again (a reload firing twice) still ends with one entry.
    host.ready(second);
    assert.equal(second.registered.length, 1);
  });

  test("without Databridge: waits for the event; unload unregisters", () => {
    const host = fakeHost(null);
    registerDatabridgeIntegration(host.plugin);
    const api = fakeApi();
    host.ready(api);
    assert.equal(api.registered.length, 1);
    host.unload();
    assert.equal(api.registered.length, 0);
  });

  test("a throwing registerIntegration or unregister is caught", () => {
    const host = fakeHost(null);
    registerDatabridgeIntegration(host.plugin);
    const error = console.error;
    console.error = () => {};
    try {
      host.ready({ registerIntegration: () => () => { throw new Error("old api gone"); } });
      assert.doesNotThrow(() => host.ready({ registerIntegration: () => { throw new Error("nope"); } }));
      assert.doesNotThrow(() => host.unload());
    } finally {
      console.error = error;
    }
  });
});
