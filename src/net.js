// Network guard. In no-network mode (the default) we replace globalThis.fetch with a stub that
// throws, so an outbound request is technically prevented, not merely avoided by convention.

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
