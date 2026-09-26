import esbuild from "esbuild";
import process from "process";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.js"],
  bundle: true,
  // @codemirror/* stellt Obsidian zur Laufzeit selbst bereit (dieselben
  // Instanzen wie der Editor) - mitgebündelte Kopien würden als fremde
  // Klassen nicht erkannt.
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
