import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

export interface ScraplingStatus {
  ready: boolean;
  venvExists: boolean;
  pythonPath: string;
  bridgeScriptPath: string;
  scraplingVersion?: string;
  lastClearanceSolvedAt?: string;
  lastError?: string;
}

export interface ClearanceResult {
  success: boolean;
  status?: number;
  clearance?: string;
  userAgent?: string;
  cookies?: Record<string, string>;
  title?: string;
  url?: string;
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

export class ScraplingService {
  private readonly pythonPath: string;
  private readonly bridgeScript: string;
  private lastSolvedAt?: string;
  private lastClearance?: string;
  private lastUserAgent?: string;

  constructor(options?: { pythonPath?: string; bridgeScript?: string }) {
    const defaultVenvPython = path.resolve(process.cwd(), ".venv/bin/python");
    const fallbackPython = "python3";
    this.pythonPath = options?.pythonPath ?? (fs.existsSync(defaultVenvPython) ? defaultVenvPython : fallbackPython);
    this.bridgeScript = options?.bridgeScript ?? path.resolve(process.cwd(), "scripts/scrapling_bridge.py");
  }

  getStatus(): ScraplingStatus {
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
    return {
      ready: pythonExecutable && bridgeExists,
      venvExists: pythonExecutable,
      pythonPath: this.pythonPath,
      bridgeScriptPath: this.bridgeScript,
      lastClearanceSolvedAt: this.lastSolvedAt,
    };
  }

  private runBridge<T>(args: string[], timeoutMs = 60_000): Promise<T> {
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
        reject(new Error(`Scrapling bridge timed out after ${timeoutMs}ms. Stderr: ${stderr.slice(0, 300)}`));
      }, timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 && !stdout.trim()) {
          return reject(new Error(`Scrapling bridge failed with exit code ${code}: ${stderr.trim()}`));
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as T;
          resolve(parsed);
        } catch (err) {
          reject(new Error(`Failed to parse Scrapling output as JSON: ${(err as Error).message}. Raw output: ${stdout.slice(0, 500)}`));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async solveClearance(targetUrl = "https://bstock.com"): Promise<ClearanceResult> {
    const result = await this.runBridge<ClearanceResult>(["--action", "solve-clearance", "--url", targetUrl], 90_000);
    if (result.success && result.clearance) {
      this.lastSolvedAt = result.solvedAt;
      this.lastClearance = result.clearance;
      this.lastUserAgent = result.userAgent;
    }
    return result;
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
