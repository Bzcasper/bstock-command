import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

export interface SolverStatus {
  ready: boolean;
  venvExists: boolean;
  pythonPath: string;
  bridgeScriptPath: string;
  engine: string;
  apiAvailable?: boolean;
  lastClearanceSolvedAt?: string;
  lastError?: string;
}

// Backward compatibility alias
export type ScraplingStatus = SolverStatus;

export interface ClearanceResult {
  success: boolean;
  status?: number;
  clearance?: string;
  userAgent?: string;
  cookies?: Record<string, string>;
  title?: string;
  url?: string;
  elapsed?: number;
  solvedAt?: string;
  error?: string;
}

export interface TurnstileWidgetResult {
  success: boolean;
  token?: string;
  method?: string;
  elapsed?: number;
  solvedAt?: string;
  error?: string;
}

export interface ScrapedLotResult {
  success: boolean;
  url?: string;
  title?: string;
  status?: number;
  images?: string[];
  primaryImageUrl?: string;
  manifestItemsCount?: number;
  manifestItemsSample?: string[][];
  specs?: Record<string, string>;
  elapsed?: number;
  scrapedAt?: string;
  error?: string;
}

export interface ScrapedListingsResult {
  success: boolean;
  url?: string;
  status?: number;
  auctionLinks?: Array<{ url: string }>;
  foundImages?: string[];
  totalLinks?: number;
  totalImages?: number;
  scrapedAt?: string;
  error?: string;
}

export class TurnstileSolverService {
  private readonly pythonPath: string;
  private readonly bridgeScript: string;
  private readonly apiUrl: string;
  private lastSolvedAt?: string;
  private lastClearance?: string;
  private lastUserAgent?: string;

  constructor(options?: { pythonPath?: string; bridgeScript?: string; apiUrl?: string }) {
    const defaultVenvPython = path.resolve(process.cwd(), ".venv/bin/python");
    const fallbackPython = "python3";
    this.pythonPath = options?.pythonPath ?? (fs.existsSync(defaultVenvPython) ? defaultVenvPython : fallbackPython);

    const solverBridge = path.resolve(process.cwd(), "solver/bridge.py");
    const legacyBridge = path.resolve(process.cwd(), "scripts/scrapling_bridge.py");
    this.bridgeScript = options?.bridgeScript ?? (fs.existsSync(solverBridge) ? solverBridge : legacyBridge);

    this.apiUrl = options?.apiUrl ?? (process.env.TURNSTILE_SOLVER_URL || "http://127.0.0.1:5072");
  }

  getStatus(): SolverStatus {
    const hasPathSep = this.pythonPath.includes(path.sep);
    let pythonExecutable = false;
    if (hasPathSep) {
      pythonExecutable = fs.existsSync(this.pythonPath);
    } else {
      try {
        const check = spawnSync(this.pythonPath, ["--version"], { stdio: "ignore" });
        pythonExecutable = check.status === 0;
      } catch {
        pythonExecutable = false;
      }
    }
    const bridgeExists = fs.existsSync(this.bridgeScript);
    const isNewSolver = this.bridgeScript.includes("solver/bridge.py");

    return {
      ready: pythonExecutable && bridgeExists,
      venvExists: pythonExecutable,
      pythonPath: this.pythonPath,
      bridgeScriptPath: this.bridgeScript,
      engine: isNewSolver ? "Turnstile-Solver-NEW (Patchright)" : "Scrapling",
      lastClearanceSolvedAt: this.lastSolvedAt,
    };
  }

  private runBridge<T>(args: string[], timeoutMs = 90_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonPath, [this.bridgeScript, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Turnstile solver timed out after ${timeoutMs}ms. Stderr: ${stderr.slice(0, 300)}`));
      }, timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 && !stdout.trim()) {
          return reject(new Error(`Turnstile solver failed with exit code ${code}: ${stderr.trim()}`));
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as T;
          resolve(parsed);
        } catch (err) {
          reject(new Error(`Failed to parse Turnstile solver output as JSON: ${(err as Error).message}. Raw output: ${stdout.slice(0, 500)}`));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Solves Cloudflare Turnstile / Managed Challenge on target URL and harvests cf_clearance.
   * Uses Turnstile-Solver-NEW (Patchright real-browser automation).
   */
  async solveClearance(targetUrl = "https://bstock.com"): Promise<ClearanceResult> {
    // If the local REST API microservice is running, attempt fast solve via API first
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const ping = await fetch(`${this.apiUrl}/cf_clearance?url=${encodeURIComponent(targetUrl)}`, {
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeout);

      if (ping && ping.ok) {
        const taskData = (await ping.json()) as { errorId?: number; taskId?: string };
        if (taskData.taskId) {
          const pollDeadline = Date.now() + 60_000;
          while (Date.now() < pollDeadline) {
            await new Promise((r) => setTimeout(r, 1000));
            const pollRes = await fetch(`${this.apiUrl}/result?id=${encodeURIComponent(taskData.taskId)}`);
            if (pollRes.ok) {
              const resJson = (await pollRes.json()) as {
                status: string;
                solution?: {
                  cf_clearance?: { name: string; value: string };
                  user_agent?: string;
                  cookies?: Array<{ name: string; value: string }>;
                  headers?: Record<string, string>;
                };
              };
              if (resJson.status === "ready" && resJson.solution) {
                const clearance = resJson.solution.cf_clearance?.value;
                const userAgent = resJson.solution.user_agent;
                const cookies: Record<string, string> = {};
                for (const c of resJson.solution.cookies || []) {
                  cookies[c.name] = c.value;
                }
                const solvedAt = new Date().toISOString();
                if (clearance) {
                  this.lastSolvedAt = solvedAt;
                  this.lastClearance = clearance;
                  this.lastUserAgent = userAgent;
                }
                return {
                  success: Boolean(clearance),
                  clearance,
                  userAgent,
                  cookies,
                  solvedAt,
                };
              } else if (resJson.status === "fail") {
                break;
              }
            }
          }
        }
      }
    } catch {}

    // Fall back to direct on-demand CLI bridge
    const result = await this.runBridge<ClearanceResult>(["--action", "solve-clearance", "--url", targetUrl], 90_000);
    if (result.success && result.clearance) {
      this.lastSolvedAt = result.solvedAt;
      this.lastClearance = result.clearance;
      this.lastUserAgent = result.userAgent;
    }
    return result;
  }

  /**
   * Solves standalone Cloudflare Turnstile widget on a page and returns validation token.
   */
  async solveTurnstile(url: string, sitekey: string, action?: string): Promise<TurnstileWidgetResult> {
    const args = ["--action", "solve-turnstile", "--url", url, "--sitekey", sitekey];
    if (action) args.push("--action-name", action);
    return this.runBridge<TurnstileWidgetResult>(args, 60_000);
  }

  async scrapeLot(urlOrLotId: string): Promise<ScrapedLotResult> {
    return this.runBridge<ScrapedLotResult>(["--action", "scrape-lot", "--url", urlOrLotId], 60_000);
  }

  async scrapeListings(url = "https://bstock.com/all-auctions/"): Promise<ScrapedListingsResult> {
    return this.runBridge<ScrapedListingsResult>(["--action", "scrape-listings", "--url", url], 60_000);
  }

  getLastClearance(): { clearance?: string; userAgent?: string; solvedAt?: string } {
    return {
      clearance: this.lastClearance,
      userAgent: this.lastUserAgent,
      solvedAt: this.lastSolvedAt,
    };
  }
}

// Backward compatibility alias for existing consumers
export { TurnstileSolverService as ScraplingService };
