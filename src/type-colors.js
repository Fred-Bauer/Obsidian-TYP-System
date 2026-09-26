function colorForFile(plugin, file) {
  const type = plugin.typIndex.typeOf(file);
  return type ? plugin.settings.typeColors[type] ?? null : null;
}

module.exports = { colorForFile };
