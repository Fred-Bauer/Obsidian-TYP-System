const { propertyValue, TYP_PROPERTY, SUBTYP_PROPERTY } = require("./typ-index");

// Databridge (another plugin) writes imported properties through
// processFrontMatter and lets other plugins hook into each write. This module
// gives its writes what TYP.js gives a new note: TYP and SUBTYP in canonical
// spelling, the SUBTYP surviving the import, and the TYP sort order. Databridge
// knows nothing about TYPs; without this module its notes would keep
// whatever order the import left.

// The SUBTYP belongs to the note, not to the import: it comes from the
// TYP-System or by hand and is in no source column. Read case-insensitively,
// like everywhere in the plugin (see propertyValue in typ-index.js); only a
// non-blank string counts.
function existingSubtyp(frontmatter) {
  const value = propertyValue(frontmatter, SUBTYP_PROPERTY);
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

// The integration object for api.registerIntegration(). Both hooks run
// synchronously inside Databridge's processFrontMatter call; ctx.state is
// shared by prepare and finalize of one write.
function createDatabridgeIntegration(plugin) {
  return {
    id: "typ-system",
    prepare(frontmatter, ctx) {
      ctx.state.subtyp = existingSubtyp(frontmatter);
    },
    finalize(frontmatter, ctx) {
      // Only a clean single TYP: a list or a blank value is no TYP the
      // plugin could sort by (see typKeyOf in typ-index.js).
      const typ = propertyValue(frontmatter, TYP_PROPERTY);
      if (typeof typ !== "string" || typ.trim() === "") return;
      // If this write set SUBTYP itself (create.set of a new note, or an
      // owned SUBTYP property), its value now is the one to keep. Otherwise
      // the one from before the write - applyTypProperties(fm, typ, null)
      // would delete it.
      const touched = ctx.isNew || ctx.changes.some((change) => String(change.key).toLowerCase() === "subtyp");
      const subtyp = touched ? existingSubtyp(frontmatter) : ctx.state.subtyp ?? null;
      plugin.applyTypProperties(frontmatter, typ, subtyp);
      plugin.sortFrontmatter(frontmatter, typ, subtyp);
    },
  };
}

// Registers the integration with Databridge, whichever plugin loads first:
// Databridge triggers "databridge:ready" on every (re)load with a new API
// object - the old one is dead then, so the registration is renewed - and an
// API that is already there is used at once.
function registerDatabridgeIntegration(plugin) {
  const { app } = plugin;
  let unregister = null;

  const detach = () => {
    try {
      unregister?.();
    } catch (error) {
      console.error("TYP-System: removing the Databridge integration failed", error);
    }
    unregister = null;
  };

  const attach = (api) => {
    detach();
    try {
      unregister = api.registerIntegration(createDatabridgeIntegration(plugin));
    } catch (error) {
      console.error("TYP-System: registering the Databridge integration failed", error);
    }
  };

  plugin.registerEvent(app.workspace.on("databridge:ready", attach));
  const api = app.plugins?.plugins?.databridge?.api;
  if (api) attach(api);
  plugin.register(detach);
}

module.exports = { existingSubtyp, createDatabridgeIntegration, registerDatabridgeIntegration };
