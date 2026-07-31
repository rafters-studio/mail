// Root entry. Renderer only -- `./compile` is a separate entry point precisely so
// that importing this module never pulls the MJML compiler into an edge bundle.
export { createMjmlRenderer, substitute } from "./renderer.js";
export type { MjmlRenderer, CompiledTemplate } from "./renderer.js";
