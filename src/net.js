// Network guard (defense in depth). The default code path makes no outbound requests; this
// additionally replaces globalThis.fetch with a throwing stub so the most common request mechanism
// is blocked. This is NOT a complete network sandbox — it does not intercept every possible Node
// networking API (http/https/net/dns/child_process). It hardens the default no-request behavior.

let installed = false;
let original = null;

export function installNoNetworkGuard() {
  if (installed) return;
  original = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("network is disabled (--no-network / default). Outbound requests are blocked.");
  };
  installed = true;
}

export function restoreNetwork() {
  if (installed && original !== undefined) globalThis.fetch = original;
  installed = false;
}

export function isNoNetworkActive() {
  return installed;
}
