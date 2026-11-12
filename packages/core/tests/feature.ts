// A requirement's generated feature, and the criteria a step file owns in it (NFR-MAIL-002, research 01a1b3ec).
import { loadFeature } from "@amiceli/vitest-cucumber";

/** The feature toolchain generated from one requirement, at features/<id>.feature in the repository root. */
export const feature = (id: string) =>
  loadFeature(new URL(`../../../features/${id}.feature`, import.meta.url).pathname);

/** The scenarios a step file implements, by criterion id: the guard reads these string literals. */
export const owns = (...ids: string[]) => ({ includeTags: ids.map((id) => `criterion-${id}`) });
