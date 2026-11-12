// workerd's own unsafe module (research 01a1ae1d): "workerd:unsafe's evict with hibernate reproduces
// the runtime's eviction field for field". Tests only: it needs the unsafe_module flag.

/** Evicts the object behind `stub`, its sockets kept hibernating; a variable specifier keeps the bundler out of it, as the toy's did. */
export async function evict(stub) {
  const specifier = ["workerd", "unsafe"].join(":");
  const mod = await import(specifier);
  const unsafe = typeof mod === "object" && mod !== null && "default" in mod ? mod.default : mod;
  if (typeof unsafe?.evict !== "function") throw new Error("workerd:unsafe has no evict");
  await unsafe.evict(stub, { webSockets: "hibernate" });
}
