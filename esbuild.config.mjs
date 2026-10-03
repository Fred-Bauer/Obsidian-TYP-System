import esbuild from "esbuild";
import process from "process";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.js"],
  bundle: true,
  // Obsidian provides @codemirror/* at runtime (the editor's own instances);
  // bundled copies would be foreign classes it doesn't recognize.
  external: ["obsidian", "electron", "@codemirror/view", "@codemirror/state", "@codemirror/language"],
  format: "cjs",
  target: "es2020",
  platform: "node",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
