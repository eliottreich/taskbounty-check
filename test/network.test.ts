import { describe, it, expect } from "vitest";
import { resolveNetworkPolicy } from "../src/lib.js";
import { installNoNetworkGuard, restoreNetwork } from "../src/net.js";

describe("network policy (only --gh-org uses the network)", () => {
  it("default scan: no networking, no conflict", () => {
    expect(resolveNetworkPolicy({})).toEqual({ networking: false, conflict: false });
  });

  it("--share retains the network guard (sharing is local; uploads nothing)", () => {
    expect(resolveNetworkPolicy({ share: true })).toEqual({ networking: false, conflict: false });
  });

  it("--share --no-network succeeds (no conflict)", () => {
    expect(resolveNetworkPolicy({ share: true, noNetwork: true })).toEqual({ networking: false, conflict: false });
  });

  it("--gh-org is the only mode that enables networking", () => {
    expect(resolveNetworkPolicy({ ghOrg: "acme" })).toEqual({ networking: true, conflict: false });
  });

  it("--gh-org --no-network is rejected (conflict)", () => {
    expect(resolveNetworkPolicy({ ghOrg: "acme", noNetwork: true }).conflict).toBe(true);
  });

  it("default and --share runs do NOT enable network-capable code (guard would install)", () => {
    // index.js installs the fetch guard whenever networking is false.
    expect(resolveNetworkPolicy({}).networking).toBe(false);
    expect(resolveNetworkPolicy({ share: true }).networking).toBe(false);
  });
});

describe("fetch guard is defense-in-depth (not a complete sandbox)", () => {
  it("blocks fetch when installed and restores afterward", () => {
    installNoNetworkGuard();
    try {
      expect(() => (globalThis as unknown as { fetch: () => void }).fetch()).toThrow();
    } finally {
      restoreNetwork();
    }
  });
});
