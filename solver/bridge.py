#!/usr/bin/env python3
"""
Turnstile-Solver-NEW Bridge for B-Stock Command.

Provides real-browser automation, Cloudflare Turnstile challenge solving,
and session cf_clearance cookie harvesting using D3-vin/Turnstile-Solver-NEW.
"""

import sys
import os
import json
import time
import argparse
import asyncio
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

# Add solver root to sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from core.browser import BrowserConfig, launch_browser, context_options, close_browser
from cf_clearance.solve import solve as solve_cf_clearance, find_clearance
from turnstile.solve import solve as solve_turnstile, click_turnstile_checkbox


async def solve_clearance_async(target_url: str = "https://bstock.com", browser_type: str = "chrome", headless: bool = True, timeout_s: int = 45, proxy: Optional[str] = None) -> Dict[str, Any]:
    sys.stderr.write(f"[turnstile-solver] Solving Cloudflare clearance for {target_url} using {browser_type}...\n")
    start = time.monotonic()
    config = BrowserConfig(browser_type=browser_type, headless=headless)
    driver, browser = await launch_browser(config)
    try:
        ctx = await browser.new_context(**context_options(config, proxy))
        page = await ctx.new_page()

        # Execute cf_clearance solve
        bundle = await solve_cf_clearance(page, target_url, timeout_s=timeout_s)
        
        clearance_data = bundle.get("cf_clearance")
        clearance_token = clearance_data.get("value") if isinstance(clearance_data, dict) else clearance_data
        
        cookies_list = bundle.get("cookies", [])
        cookies_dict = {}
        for c in cookies_list:
            if isinstance(c, dict) and "name" in c and "value" in c:
                cookies_dict[c["name"]] = c["value"]
                if c["name"] == "cf_clearance" and not clearance_token:
                    clearance_token = c["value"]

        ua = bundle.get("user_agent") or await page.evaluate("() => navigator.userAgent")
        title = await page.title()
        current_url = page.url

        if clearance_token:
            sys.stderr.write(f"[turnstile-solver] Solved in {round(time.monotonic() - start, 2)}s!\n")
            return {
                "success": True,
                "clearance": clearance_token,
                "userAgent": ua,
                "cookies": cookies_dict,
                "title": title,
                "url": current_url,
                "elapsed": round(time.monotonic() - start, 2),
                "solvedAt": datetime.now(timezone.utc).isoformat(),
            }
        else:
            return {
                "success": False,
                "error": bundle.get("error", "Failed to obtain cf_clearance token"),
                "title": title,
                "url": current_url,
                "elapsed": round(time.monotonic() - start, 2),
                "solvedAt": datetime.now(timezone.utc).isoformat(),
            }
    except Exception as e:
        sys.stderr.write(f"[turnstile-solver] Error: {e}\n")
        return {
            "success": False,
            "error": str(e),
            "elapsed": round(time.monotonic() - start, 2),
            "solvedAt": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        await close_browser(driver, browser)


async def solve_turnstile_async(url: str, sitekey: str, action: Optional[str] = None, cdata: Optional[str] = None, browser_type: str = "chrome", headless: bool = True, proxy: Optional[str] = None) -> Dict[str, Any]:
    sys.stderr.write(f"[turnstile-solver] Solving Turnstile widget token on {url} (sitekey: {sitekey[:10]}...)\n")
    start = time.monotonic()
    config = BrowserConfig(browser_type=browser_type, headless=headless)
    driver, browser = await launch_browser(config)
    try:
        ctx = await browser.new_context(**context_options(config, proxy))
        page = await ctx.new_page()

        token, method = await solve_turnstile(page, url, sitekey, action=action, cdata=cdata)
        if token:
            sys.stderr.write(f"[turnstile-solver] Widget solved via {method} in {round(time.monotonic() - start, 2)}s!\n")
            return {
                "success": True,
                "token": token,
                "method": method,
                "elapsed": round(time.monotonic() - start, 2),
                "solvedAt": datetime.now(timezone.utc).isoformat(),
            }
        else:
            return {
                "success": False,
                "error": "Failed to harvest Turnstile token from widget",
                "elapsed": round(time.monotonic() - start, 2),
                "solvedAt": datetime.now(timezone.utc).isoformat(),
            }
    except Exception as e:
        sys.stderr.write(f"[turnstile-solver] Error: {e}\n")
        return {
            "success": False,
            "error": str(e),
            "elapsed": round(time.monotonic() - start, 2),
            "solvedAt": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        await close_browser(driver, browser)


async def scrape_lot_async(url_or_id: str, browser_type: str = "chrome", headless: bool = True, proxy: Optional[str] = None) -> Dict[str, Any]:
    url = url_or_id if url_or_id.startswith("http") else f"https://bstock.com/auction/{url_or_id}"
    sys.stderr.write(f"[turnstile-solver] Scraping lot {url}...\n")
    start = time.monotonic()
    config = BrowserConfig(browser_type=browser_type, headless=headless)
    driver, browser = await launch_browser(config)
    try:
        ctx = await browser.new_context(**context_options(config, proxy))
        page = await ctx.new_page()

        # Solve challenge if present
        bundle = await solve_cf_clearance(page, url, timeout_s=45)
        
        # Scrape page contents
        title = await page.title()
        
        # Extract images
        image_urls = await page.evaluate('''() => {
            const imgs = Array.from(document.querySelectorAll('img[src*="bfile-prod"], img[src*="cdn"], .gallery img, .auction-image img, .carousel img'));
            return Array.from(new Set(imgs.map(i => i.src).filter(s => s && s.startsWith('http'))));
        }''')
        
        # Extract table rows if manifest preview is present
        manifest_rows = await page.evaluate('''() => {
            const rows = Array.from(document.querySelectorAll('table.manifest-table tr, table.table-striped tr, .manifest tr'));
            return rows.slice(0, 15).map(r => Array.from(r.querySelectorAll('th, td')).map(c => c.textContent.trim()));
        }''')

        primary_image = image_urls[0] if image_urls else None

        return {
            "success": True,
            "url": page.url,
            "title": title,
            "images": image_urls,
            "primaryImageUrl": primary_image,
            "manifestItemsCount": len(manifest_rows),
            "manifestItemsSample": manifest_rows[:5],
            "elapsed": round(time.monotonic() - start, 2),
            "scrapedAt": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "scrapedAt": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        await close_browser(driver, browser)


def main():
    parser = argparse.ArgumentParser(description="Turnstile-Solver-NEW Bridge")
    parser.add_argument("--action", choices=["solve-clearance", "solve-turnstile", "scrape-lot", "status"], default="solve-clearance")
    parser.add_argument("--url", default="https://bstock.com")
    parser.add_argument("--sitekey", default="")
    parser.add_argument("--action-name", default=None)
    parser.add_argument("--cdata", default=None)
    parser.add_argument("--browser", choices=["chrome", "chromium", "msedge", "camoufox"], default="chrome")
    parser.add_argument("--no-headless", action="store_true")
    parser.add_argument("--timeout", type=int, default=45)
    parser.add_argument("--proxy", default=None)

    args = parser.parse_args()

    if args.action == "status":
        print(json.dumps({
            "ready": True,
            "engine": "Turnstile-Solver-NEW (Patchright)",
            "supportedBrowsers": ["chrome", "chromium", "msedge", "camoufox"],
            "version": "2.0.0",
        }))
        return

    headless = not args.no_headless

    if args.action == "solve-clearance":
        res = asyncio.run(solve_clearance_async(
            target_url=args.url,
            browser_type=args.browser,
            headless=headless,
            timeout_s=args.timeout,
            proxy=args.proxy
        ))
        print(json.dumps(res, indent=2))
    elif args.action == "solve-turnstile":
        res = asyncio.run(solve_turnstile_async(
            url=args.url,
            sitekey=args.sitekey,
            action=args.action_name,
            cdata=args.cdata,
            browser_type=args.browser,
            headless=headless,
            proxy=args.proxy
        ))
        print(json.dumps(res, indent=2))
    elif args.action == "scrape-lot":
        res = asyncio.run(scrape_lot_async(
            url_or_id=args.url,
            browser_type=args.browser,
            headless=headless,
            proxy=args.proxy
        ))
        print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
