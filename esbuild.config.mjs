import esbuild from "esbuild";
import process from "node:process";

const production = process.argv[2] === "production";
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "node:http", "node:crypto", "node:fs", "node:path"],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  define: {
    "process.env.VAULTBRIDGE_GOOGLE_CLIENT_ID": JSON.stringify(
      process.env.VAULTBRIDGE_GOOGLE_CLIENT_ID ?? "",
    ),
  },
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
