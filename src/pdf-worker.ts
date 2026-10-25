import { parentPort, workerData } from "node:worker_threads";
import { extractPdf } from "./pdf-extractor.js";

try {
  const result = await extractPdf(workerData as Uint8Array, (progress) => parentPort?.postMessage({ type: "progress", progress }));
  parentPort?.postMessage({ type: "ready", result });
} catch (error) {
  const message = error instanceof Error ? error.message : "This PDF couldn't be read. Try exporting it again.";
  // Only known, actionable extraction errors cross the API boundary.
  parentPort?.postMessage({ type: "failed", error: /^(This PDF|This file|Choose a PDF|No readable text)/.test(message) ? message : "This PDF couldn't be read. Try a smaller file or re-export the pages." });
}
