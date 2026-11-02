// FR-MAIL-046-c4, in a child process whose heap limit is twice the input: 25 MiB of every byte value
// becomes octets. Heap use past that limit ends the process, so finishing is the measurement.
import { bytes } from "../src/imap/format.ts";
import { binary } from "../src/read/index.ts";

const source = new Uint8Array(25 * 1024 * 1024).map((_, i) => i % 256);
const octets = bytes(binary(source));
console.log(Buffer.compare(source, octets) === 0 ? "equal" : "different");
