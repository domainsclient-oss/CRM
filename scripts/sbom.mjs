// CycloneDX 1.5 SBOM of production dependencies across the workspace (T-09-04, NFR-SEC-008).
// Usage: pnpm sbom [output.json]   (default: sbom.cdx.json, git-ignored)
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const out = process.argv[2] ?? "sbom.cdx.json";
const shell = process.platform === "win32";
const raw = execFileSync("pnpm", ["list", "-r", "--prod", "--json", "--depth", "Infinity"], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
  shell,
});
const projects = JSON.parse(raw);

const components = new Map();
const dependencies = new Map();
const purl = (name, version) =>
  `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${version}`;

function walk(parentRef, deps) {
  for (const [name, info] of Object.entries(deps ?? {})) {
    if (!info.version || info.version.startsWith("link:")) {
      walk(parentRef, info.dependencies);
      continue;
    }
    const ref = purl(name, info.version);
    if (!components.has(ref)) {
      components.set(ref, {
        type: "library",
        "bom-ref": ref,
        name,
        version: info.version,
        purl: ref,
      });
    }
    dependencies.set(parentRef, (dependencies.get(parentRef) ?? new Set()).add(ref));
    walk(ref, info.dependencies);
  }
}

const root = JSON.parse(readFileSync("package.json", "utf8"));
const rootRef = `pkg:npm/${root.name}@${root.version ?? "0.0.0"}`;
for (const project of projects) {
  const ref = `pkg:npm/${project.name}@${project.version ?? "0.0.0"}`;
  dependencies.set(rootRef, (dependencies.get(rootRef) ?? new Set()).add(ref));
  components.set(ref, {
    type: "application",
    "bom-ref": ref,
    name: project.name,
    version: project.version ?? "0.0.0",
  });
  walk(ref, project.dependencies);
}

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: "application",
      "bom-ref": rootRef,
      name: root.name,
      version: root.version ?? "0.0.0",
    },
  },
  components: [...components.values()].sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"])),
  dependencies: [...dependencies].map(([ref, deps]) => ({ ref, dependsOn: [...deps].sort() })),
};
writeFileSync(out, `${JSON.stringify(bom, null, 2)}\n`);
console.log(`SBOM: ${components.size} components → ${out}`);
