import { readFile } from "node:fs/promises";

const [receiptPath, expectedVerdict] = process.argv.slice(2);
if (!receiptPath || !expectedVerdict) throw new Error("Usage: node scripts/assert-receipt.mjs <receipt.json> <expected-verdict>");
const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
if (receipt.verdict !== expectedVerdict) {
  throw new Error(`Expected verdict ${expectedVerdict}, received ${String(receipt.verdict)}`);
}
if (expectedVerdict === "REGRESSION" && !receipt.deltas?.some((delta) => delta.classification === "REGRESSION")) {
  throw new Error("REGRESSION receipt contains no regression delta");
}
console.log(`Receipt assertion: PASS (${expectedVerdict})`);
