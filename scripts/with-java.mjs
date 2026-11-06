// Run a command with the project-local JDK (./.tools/jdk-21) on PATH when present.
// CI installs Java via setup-java, so this is a no-op there.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const jdkBin = fileURLToPath(new URL("../.tools/jdk-21/bin", import.meta.url));
const env = { ...process.env };
if (existsSync(jdkBin)) {
  const key = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  env[key] = `${jdkBin}${delimiter}${env[key] ?? ""}`;
  env.JAVA_HOME = join(jdkBin, "..");
}

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("usage: node scripts/with-java.mjs <command> [...args]");
// Windows needs a shell to resolve .cmd shims (e.g. firebase.cmd). Build one command
// string with arguments quoted, rather than passing an args array with shell:true.
// Arguments come from package.json scripts, not from untrusted input.
const child =
  process.platform === "win32"
    ? spawn(
        [command, ...args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))].join(
          " ",
        ),
        { stdio: "inherit", env, shell: true },
      )
    : spawn(command, args, { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 1));
