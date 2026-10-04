// Points require("obsidian") at the stand-in, so src/ loads unchanged in Node.
// Require this before anything from src/.
const Module = require("node:module");
const path = require("node:path");

const SHIM = path.join(__dirname, "obsidian-shim.js");
const resolve = Module._resolveFilename;

Module._resolveFilename = function (request, ...rest) {
  return request === "obsidian" ? SHIM : resolve.call(this, request, ...rest);
};
