#!/usr/bin/env node
// Proves the WASI file surface in sdk/fx-sdk.js against two guests: a small C
// probe compiled on demand (writes, directories, renames) and the real terminal
// artifact (fx reading $HOME/.fx from a host filesystem).
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFxTerminal, createMemoryFileSystem, supportsJspi } from "../node.js";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const defaultWasm = resolve(scriptDir, "../../zig-out/bin/fx-term.wasm");
const termWasmPath = resolve(process.argv[2] || defaultWasm);
const probeSource = resolve(scriptDir, "fixtures/wasi-files-probe.c");

if (!supportsJspi()) {
  console.error("Node JSPI is disabled. Run with: node --experimental-wasm-jspi sdk/tests/test-wasi-files.mjs");
  process.exit(2);
}

const failures = [];
const check = (label, actual, expected) => {
  if (actual === expected) return;
  failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

function silentTerminal() {
  const chunks = [];
  return {
    chunks,
    cols: 80,
    rows: 24,
    write(bytes) { chunks.push(bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes)); },
    onData() { return () => {}; },
    onResize() { return () => {}; },
    async drain() {},
    text() { return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))); },
  };
}

// The in-memory adapter is the reference implementation hosts start from.
const memory = createMemoryFileSystem({ "/a/b/one.txt": "one", "/a/two.txt": "two" });
check("memory stat file", memory.stat("/a/b/one.txt")?.size, 3);
check("memory stat dir", memory.stat("/a/b")?.type, "dir");
check("memory stat missing", memory.stat("/a/nope"), null);
check("memory read", new TextDecoder().decode(memory.read("/a/two.txt")), "two");
check("memory list", memory.list("/a").map((entry) => `${entry.name}:${entry.type}`).sort().join(","), "b:dir,two.txt:file");
check("memory list missing", memory.list("/a/nope"), null);
memory.rename("/a/b", "/a/c");
check("memory rename dir", memory.stat("/a/c/one.txt")?.size, 3);
check("memory rename clears source", memory.stat("/a/b"), null);
memory.remove("/a/c/one.txt");
memory.rmdir("/a/c");
check("memory rmdir", memory.stat("/a/c"), null);
let rejected = "none";
try { memory.rmdir("/a"); } catch (error) { rejected = error.code; }
check("memory rmdir refuses non-empty", rejected, "ENOTEMPTY");

// A C guest exercises the write, directory, and error paths fx itself never takes.
const workDir = await mkdtemp(join(tmpdir(), "fx-wasi-files-"));
try {
  const probeWasm = join(workDir, "probe.wasm");
  const compiled = spawnSync("zig", ["cc", "-target", "wasm32-wasi", "-Oz", "-o", probeWasm, probeSource], { encoding: "utf8" });
  if (compiled.error || compiled.status !== 0) {
    console.error(`unable to compile ${probeSource} with zig cc:\n${compiled.stderr || compiled.error}`);
    process.exit(2);
  }

  const files = createMemoryFileSystem({ "/home/user/.fx/settings.json": '{"model":"sdk/wasi-files"}' });
  files.mkdir("/home/user/project");
  const probeTerminal = silentTerminal();
  const probe = await createFxTerminal({
    wasm: await readFile(probeWasm),
    terminal: probeTerminal,
    fs: files,
    env: { HOME: "/home/user" },
  });
  probe.interactive.catch(() => {}); // the probe prints and exits without reading input
  check("probe exit code", await probe.exited, 0);

  const reported = new Map(probeTerminal.text().trim().split("\n").filter(Boolean)
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  check("probe read-seeded", reported.get("read-seeded"), '{"model":"sdk/wasi-files"}');
  check("probe create", reported.get("create"), "ok");
  check("probe append", reported.get("append"), "ok");
  check("probe reread", reported.get("reread"), "first line|second line|");
  check("probe stat", reported.get("stat"), "23/1");
  check("probe stat-dir", reported.get("stat-dir"), "dir");
  check("probe mkdir", reported.get("mkdir"), "ok");
  check("probe readdir", reported.get("readdir")?.split(",").sort().join(","), "notes.txt,sub");
  check("probe rename", reported.get("rename"), "ok");
  check("probe unlink", reported.get("unlink"), "ok");
  check("probe rmdir", reported.get("rmdir"), "ok");
  check("probe missing", reported.get("missing"), "errno:44");

  const snapshot = files.snapshot();
  check("host sees no leftovers", Object.keys(snapshot).sort().join(","), "/home/user/.fx/settings.json");
  check("removed directory is gone", files.stat("/home/user/project/sub"), null);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

// The real terminal artifact resolves $HOME through the same preopen.
const opened = [];
const seeded = createMemoryFileSystem({
  "/home/user/.fx/settings.json": '{"model":"sdk/term-model"}',
  "/AGENTS.md": "# wasi files\n",
});
const observed = { ...seeded, stat: (path) => { opened.push(path); return seeded.stat(path); } };
const termTerminal = silentTerminal();
const term = await createFxTerminal({
  wasm: await readFile(termWasmPath),
  terminal: termTerminal,
  fs: observed,
  env: { HOME: "/home/user", AI_GATEWAY_API_KEY: "sdk-test-key" },
  fetch: async () => Response.json({ object: "list", data: [] }),
});
const timer = setTimeout(() => { failures.push("fx terminal never became interactive"); }, 10000);
await Promise.race([term.interactive, new Promise((resolve) => setTimeout(resolve, 10000))]);
clearTimeout(timer);
term.write("read the project instructions\r");
await new Promise((resolve) => setTimeout(resolve, 2000));
term.abort();
check("fx resolved the home config", opened.includes("/home/user/.fx/settings.json"), true);
check("fx looked for project instructions", opened.includes("/AGENTS.md"), true);

if (failures.length) {
  console.error(`FAIL\n${failures.map((line) => `  ${line}`).join("\n")}`);
  process.exit(1);
}
console.log("wasi files ok");
process.exit(0); // an aborted terminal can leave the host fetch and its timers pending
