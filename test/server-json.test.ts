import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { MCP_TOOLS } from "../src/mcp.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const server = JSON.parse(readFileSync(join(ROOT, "server.json"), "utf8"));
const npmPkg = server.packages.find((p: { registryType: string }) => p.registryType === "npm");

describe("server.json (official MCP Registry shape)", () => {
  it("uses an official modelcontextprotocol schema", () => {
    expect(String(server.$schema)).toMatch(/modelcontextprotocol\.io\/schemas\/.*server\.schema\.json$/);
  });

  it("registry name matches package.json#mcpName", () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.name).toBe("io.github.eliottreich/taskbounty-check");
  });

  it("registry package identifier + version match the npm package", () => {
    expect(npmPkg).toBeTruthy();
    expect(npmPkg.identifier).toBe(pkg.name);
    expect(npmPkg.version).toBe(pkg.version);
    expect(server.version).toBe(pkg.version);
  });

  it("transport is local stdio and runs `mcp`", () => {
    expect(npmPkg.transport.type).toBe("stdio");
    const args = (npmPkg.packageArguments || []).map((a: { value: string }) => a.value);
    expect(args).toContain("mcp");
  });

  it("requires no auth, secrets, or environment variables", () => {
    expect(npmPkg.environmentVariables ?? []).toHaveLength(0);
    // no hosted/remote endpoint of any kind
    expect(server.remotes ?? []).toHaveLength(0);
    expect(npmPkg.transport.url).toBeUndefined();
  });

  it("description is honest about scope and within the 100-char limit", () => {
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.description).toMatch(/GitHub Actions/i);
    expect(server.description).toMatch(/not a full security audit/i);
  });
});

// Spawn the published entrypoint and speak MCP over stdio.
function rpc(messages: object[]): Promise<Record<string, unknown>[]> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("node", [join(ROOT, "src", "index.js"), "mcp"], { stdio: ["pipe", "pipe", "ignore"] });
    let buf = "";
    const out: Record<string, unknown>[] = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error("mcp init timed out")); }, 10000);
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) out.push(JSON.parse(line));
        if (out.length >= messages.length) { clearTimeout(timer); child.kill(); resolvePromise(out); }
      }
    });
    child.on("error", reject);
    for (const m of messages) child.stdin.write(JSON.stringify(m) + "\n");
  });
}

describe("MCP initialization + tools parity (from the entrypoint)", () => {
  it("initialize succeeds and reports the package version", async () => {
    const [init] = await rpc([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }]);
    const result = init.result as { serverInfo: { name: string; version: string }; protocolVersion: string };
    expect(result.serverInfo.name).toBe("taskbounty-check");
    expect(result.serverInfo.version).toBe(pkg.version);
    expect(result.protocolVersion).toBeTruthy();
  });

  it("the advertised tools match the implemented tools", async () => {
    const replies = await rpc([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ]);
    const list = replies.find((r) => r.id === 2)!.result as { tools: { name: string }[] };
    const advertised = list.tools.map((t) => t.name).sort();
    const implemented = MCP_TOOLS.map((t) => t.name).sort();
    expect(advertised).toEqual(implemented);
  });
});
