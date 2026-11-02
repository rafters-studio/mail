// FR-MAIL-045-c3, in a child process with a 128 MB heap: readMessage returns on one shape.
import { readMessage } from "../src/read/index.ts";
import { hostile, SHAPES } from "./hostile.ts";

const shape = SHAPES.find((s) => s === process.argv[2]);
if (shape === undefined) throw new Error(`no shape ${process.argv[2]}`);
console.log(readMessage(hostile(shape)).messageId);
