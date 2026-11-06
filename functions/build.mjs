// Bundles the functions entry with @crm/core. `server-only` is a Next.js guard that throws outside
// React Server Components, so it is replaced with an empty module here (Functions are server code).
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "lib/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external: ["firebase-admin", "firebase-functions", "sharp"],
  alias: { "server-only": "./src/server-only-stub.ts" },
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
console.log("functions bundled → lib/index.js");
