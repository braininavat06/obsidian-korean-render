import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";
import { copyFile, mkdir, rm } from "node:fs/promises";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2021",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
});

if (production) {
  await context.rebuild();
  await context.dispose();
  await rm("dist/korean-render", { recursive: true, force: true });
  await mkdir("dist/korean-render", { recursive: true });
  await Promise.all([
    copyFile("main.js", "dist/korean-render/main.js"),
    copyFile("manifest.json", "dist/korean-render/manifest.json"),
  ]);
} else {
  await context.watch();
}
