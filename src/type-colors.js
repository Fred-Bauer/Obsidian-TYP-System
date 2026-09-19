const TYP_PROPERTY = "TYP";

function colorForFile(plugin, file) {
  if (!file || file.extension !== "md") return null;
  const value = plugin.app.metadataCache.getFileCache(file)?.frontmatter?.[TYP_PROPERTY];
  if (!value) return null;
  const type = String(Array.isArray(value) ? value[0] : value).trim();
  return plugin.settings.typeColors[type] ?? null;
}

module.exports = { TYP_PROPERTY, colorForFile };
