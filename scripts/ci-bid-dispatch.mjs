#!/usr/bin/env node
/**
 * Autonomous Guarded Bidding CI Dispatcher (ThePopeBot serverless execution pattern).
 *
 * Runs inside GitHub Actions (`workflow_dispatch` / `repository_dispatch`) or GitLab CI,
 * performing cryptographic HMAC signing, multi-constraint safety evaluation,
 * and immutable audit logging to Git and Firestore.
 */
import fs from "node:fs";
import path from "node:path";
import { BStockClient } from "../packages/client/src/client.ts";
import { Db } from "../apps/server/src/db.ts";
import { SecretVault, PlanSigner } from "../apps/server/src/security.ts";
import { BidExecutor } from "../apps/server/src/bids.ts";
import { DEFAULT_SETTINGS } from "../apps/server/src/collector.ts";
import { FirebaseStorageService } from "../packages/storage-firebase/src/index.ts";

const args = process.argv.slice(2);
function getArg(name, fallback = "") {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}

const lotId = getArg("--lot-id", process.env.BSTOCK_LOT_ID || "");
const amountStr = getArg("--amount", process.env.BSTOCK_BID_AMOUNT || "0");
const amount = Number(amountStr);
const dryRun = !args.includes("--live") && process.env.BSTOCK_DRY_RUN !== "0";
const armed = args.includes("--armed") || process.env.BSTOCK_ARMED === "1";
const operatorNote = getArg("--note", process.env.BSTOCK_NOTE || "Autonomous CI Bid Dispatch");

if (!lotId || amount <= 0) {
  console.error("Usage: node scripts/ci-bid-dispatch.mjs --lot-id <LOT_ID> --amount <USD> [--live] [--armed] [--note <TEXT>]");
  process.exit(1);
}

fs.mkdirSync("audit", { recursive: true });

const masterKey = process.env.BSTOCK_MASTER_KEY || "ci-secret-master-key-32-chars-long";
const dbPath = path.resolve("backups/bstock.db");
const db = new Db(fs.existsSync(dbPath) ? dbPath : ":memory:");
const signer = new PlanSigner(masterKey);

const client = new BStockClient({
  clearance: process.env.BSTOCK_CLEARANCE,
  userAgent: process.env.BSTOCK_UA,
  accessToken: process.env.BSTOCK_TOKEN,
});

const settings = () => ({
  ...DEFAULT_SETTINGS,
  ...db.getSetting("trading", {}),
  mode: dryRun ? "dry-run" : (armed ? "live" : "dry-run"),
});

const executor = new BidExecutor({
  client,
  db,
  settings,
  signer,
  liveEnabled: !dryRun && armed,
});

console.log(`[ci-bid-dispatch] Preparing bid for Lot ${lotId} at $${amount} (Mode: ${dryRun ? "DRY_RUN" : "LIVE_ARMED"})...`);

let planResult;
try {
  planResult = await executor.plan(lotId, amount);
} catch (err) {
  console.error("[ci-bid-dispatch] Plan generation failed:", err.message);
  process.exit(1);
}

const { planToken, payload, guard } = planResult;
console.log(`[ci-bid-dispatch] Safety evaluation: ${guard.allowed ? "PASSED ✅" : "BLOCKED ❌"}`);

let executionResult = null;
if (guard.allowed) {
  executionResult = await executor.execute({
    listingId: lotId,
    planToken,
    amount,
    armed,
    dryRun,
    idempotencyKey: `ci-bid-${lotId}-${Date.now()}`,
  });
  console.log(`[ci-bid-dispatch] Bid execution status: ${executionResult.status}`);
} else {
  executionResult = {
    status: "blocked",
    reasons: guard.blockers,
    warnings: guard.warnings,
  };
  console.warn(`[ci-bid-dispatch] Bid blocked: ${guard.blockers.join("; ")}`);
}

// Append immutable audit log entry
const auditEntry = {
  timestamp: new Date().toISOString(),
  lotId,
  amount,
  dryRun,
  armed,
  operatorNote,
  evaluation: {
    allowed: guard.allowed,
    blockers: guard.blockers,
    warnings: guard.warnings,
  },
  execution: executionResult,
  tokenSignature: planToken ? planToken.slice(0, 20) + "..." : null,
};

const auditFile = path.resolve("audit/bid-ledger.jsonl");
fs.appendFileSync(auditFile, JSON.stringify(auditEntry) + "\n");
console.log(`[ci-bid-dispatch] Recorded audit entry in ${auditFile}`);

// Generate GitHub Actions Step Summary Receipt
const receiptMd = `# 🏷️ B-Stock Guarded Bid Dispatch Receipt
*Timestamp: \`${auditEntry.timestamp}\` | Status: \`${executionResult.status.toUpperCase()}\`*

| Parameter | Value |
| :--- | :--- |
| **Lot ID** | \`${lotId}\` |
| **Bid Amount** | **$${amount.toLocaleString()}** |
| **Execution Mode** | \`${dryRun ? "SIMULATION (Dry-Run)" : "LIVE CAPITAL"}\` |
| **Safety Armed** | \`${armed ? "YES (Confirmed)" : "NO"}\` |
| **Evaluation** | ${guard.allowed ? "✅ Approved by Safety Constraints" : "❌ Blocked by Safeguards"} |
| **Operator Note** | ${operatorNote} |

### Safeguard Checklist
${guard.checks.map((c) => `- ${c.ok ? "✅" : "❌"} **${c.name}**: ${c.detail}`).join("\n")}

${guard.blockers.length > 0 ? `\n> ⚠️ **Blockers encountered:**\n${guard.blockers.map((b) => `> - ${b}`).join("\n")}` : ""}

---
*Audit ledger synchronized with Git-as-a-database and Cloud Firestore.*
`;

if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, receiptMd + "\n");
  } catch {}
}

// Sync to Firestore collection 'bids' if configured
const firebase = new FirebaseStorageService();
if (firebase.init() && firebase.getFirestore()) {
  try {
    const firestore = firebase.getFirestore();
    await firestore.collection("bids").doc(`bid-${lotId}-${Date.now()}`).set(auditEntry);
    console.log("[ci-bid-dispatch] Synced bid audit entry to Cloud Firestore collection 'bids'.");
  } catch (err) {
    console.warn("[ci-bid-dispatch] Firestore audit push notice:", err.message);
  }
}

db.close();
process.exit(guard.allowed ? 0 : 2);
