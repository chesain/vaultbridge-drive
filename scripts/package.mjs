import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const version = manifest.version;
const releaseDirectory = path.resolve("release");
const staging = path.join(releaseDirectory, `vaultbridge-drive-${version}`);
const archive = path.join(releaseDirectory, `vaultbridge-drive-${version}.zip`);
const sourceArchive = path.join(releaseDirectory, `vaultbridge-drive-${version}-source.zip`);
const required = ["main.js", "manifest.json", "styles.css"];

fs.rmSync(staging, { recursive: true, force: true });
fs.rmSync(archive, { force: true });
fs.rmSync(sourceArchive, { force: true });
fs.mkdirSync(staging, { recursive: true });
for (const file of required) fs.copyFileSync(file, path.join(staging, file));

const staged = fs.readdirSync(staging).sort();
if (JSON.stringify(staged) !== JSON.stringify([...required].sort())) {
  throw new Error(`Release staging contains unexpected files: ${staged.join(", ")}`);
}
execFileSync("zip", ["-X", "-q", archive, ...required], { cwd: staging });
execFileSync(
  "zip",
  [
    "-X",
    "-q",
    "-r",
    sourceArchive,
    ".",
    "-x",
    "node_modules/*",
    "coverage/*",
    "release/*",
    "upload/*",
    ".git/*",
    ".agents/",
    ".agents/*",
    ".codex/",
    ".codex/*",
    ".env",
    "main.js",
  ],
  { cwd: path.resolve(".") },
);

const lines = [
  ...required.map((file) =>
    checksum(path.join(staging, file), `${path.basename(staging)}/${file}`),
  ),
  checksum(archive, path.basename(archive)),
  checksum(sourceArchive, path.basename(sourceArchive)),
];
fs.writeFileSync(path.join(releaseDirectory, "SHA256SUMS"), `${lines.join("\n")}\n`);
console.log(archive);
console.log(sourceArchive);

function checksum(file, label) {
  return `${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}  ${label}`;
}
