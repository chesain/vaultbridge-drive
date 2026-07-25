import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const roots = ["src", "docs"];
const files = ["README.md", "SECURITY.md", "PRIVACY.md", ".env.example"];
for (const root of roots) collect(root, files);

const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bya29\.[A-Za-z0-9._~-]{20,}/u,
  /\b1\/\/[A-Za-z0-9._~-]{20,}/u,
  /\b\d{8,}-[A-Za-z0-9_-]{20,}\.apps\.googleusercontent\.com\b/u,
];
const findings = [];
for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  for (const pattern of patterns)
    if (pattern.test(content)) findings.push(`${file}: ${pattern.source}`);
}
if (findings.length > 0) {
  console.error(`Potential secrets found:\n${findings.join("\n")}`);
  process.exit(1);
}
console.log(`Secret scan passed (${files.length} files)`);

function collect(directory, output) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(target, output);
    else if (/\.(?:ts|md|json|css)$/u.test(entry.name)) output.push(target);
  }
}
