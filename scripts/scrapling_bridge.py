#!/usr/bin/env python3
"""
Scrapling Stealth Bridge for B-Stock Command.

Provides stealth browser automation, Cloudflare Turnstile challenge solving,
and lot/manifest/image scraping using the Scrapling framework.
"""

import sys
import json
import argparse
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

def get_scrapling():
    try:
        from scrapling.fetchers import StealthyFetcher, Fetcher
        return StealthyFetcher, Fetcher
    except ImportError as e:
        sys.stderr.write(f"Scrapling import error: {e}\n")
        sys.exit(1)

def solve_clearance(target_url: str = "https://bstock.com") -> Dict[str, Any]:
    """
    Spawns Scrapling StealthyFetcher with solve_cloudflare=True to solve
    Cloudflare Turnstile and capture the valid cf_clearance cookie and User-Agent.
    """
    StealthyFetcher, _ = get_scrapling()
    sys.stderr.write(f"[scrapling-bridge] Solving Cloudflare for {target_url}...\n")
    try:
        page = StealthyFetcher.fetch(
            target_url,
            headless=True,
            solve_cloudflare=True,
            block_webrtc=True,
            hide_canvas=True,
            allow_webgl=True,
        )
        clearance_cookie = None
        cookies_dict = {}
        for c in page.cookies:
            name = c.get("name")
            val = c.get("value")
            if name and val:
                cookies_dict[name] = val
                if name == "cf_clearance":
                    clearance_cookie = val

        user_agent = getattr(page, "useragent", None) or "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

        return {
            "success": True,
            "status": page.status,
            "title": page.css("title::text").get(),
            "url": page.url,
            "clearance": clearance_cookie,
            "userAgent": user_agent,
            "cookies": cookies_dict,
            "solvedAt": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "solvedAt": datetime.now(timezone.utc).isoformat(),
        }

def scrape_lot(url_or_id: str, clearance: Optional[str] = None) -> Dict[str, Any]:
    """
    Scrapes detailed lot data, high-resolution images, and manifest items from a B-Stock lot page.
    """
    StealthyFetcher, Fetcher = get_scrapling()
    if not url_or_id.startswith("http"):
        url = f"https://bstock.com/auction/auction/view/id/{url_or_id}"
    else:
        url = url_or_id

    sys.stderr.write(f"[scrapling-bridge] Scraping lot: {url}...\n")
    try:
        page = StealthyFetcher.fetch(
            url,
            headless=True,
            solve_cloudflare=True,
            block_webrtc=True,
            hide_canvas=True,
        )

        title = page.css("h1::text").get() or page.css(".auction-title::text").get() or page.css("title::text").get()
        if title:
            title = title.strip()

        # Extract all high-res image sources
        img_urls = set()
        for img_src in page.css("img::attr(src)").getall():
            if img_src and any(ext in img_src.lower() for ext in [".jpg", ".jpeg", ".png", ".webp"]) or "docserv" in img_src or "storage.googleapis" in img_src:
                if not any(badge in img_src.lower() for badge in ["icon", "logo", "flag", "avatar", "badge"]):
                    img_urls.add(img_src)

        for img_src in page.css("a[data-fancybox]::attr(href)").getall():
            img_urls.add(img_src)
        for img_src in page.css(".gallery img::attr(src)").getall():
            img_urls.add(img_src)
        for img_src in page.css(".fotorama img::attr(src)").getall():
            img_urls.add(img_src)

        # Extract manifest items if available in table
        items = []
        for row in page.css("table.manifest tbody tr, table.items-table tbody tr"):
            cols = [col.css("::text").get("").strip() for col in row.css("td")]
            if cols:
                items.append(cols)

        # Extract key-value specifications
        specs = {}
        for row in page.css(".auction-details tr, .product-specs tr"):
            label = row.css("th::text, td.label::text").get()
            val = row.css("td::text, td.value::text").get()
            if label and val:
                specs[label.strip().rstrip(":")] = val.strip()

        return {
            "success": True,
            "url": url,
            "title": title,
            "status": page.status,
            "images": sorted(list(img_urls)),
            "primaryImageUrl": sorted(list(img_urls))[0] if img_urls else None,
            "manifestItemsCount": len(items),
            "manifestItemsSample": items[:10],
            "specs": specs,
            "scrapedAt": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        return {
            "success": False,
            "url": url,
            "error": str(e),
            "scrapedAt": datetime.now(timezone.utc).isoformat(),
        }

def scrape_listings(url: str = "https://bstock.com/all-auctions/") -> Dict[str, Any]:
    """
    Scrapes auction cards and their primary preview images from the browse/auction page.
    """
    StealthyFetcher, _ = get_scrapling()
    sys.stderr.write(f"[scrapling-bridge] Scraping listings from {url}...\n")
    try:
        page = StealthyFetcher.fetch(
            url,
            headless=True,
            solve_cloudflare=True,
            block_webrtc=True,
            hide_canvas=True,
        )

        cards = []
        # Find auction links
        links = page.css("a[href*='/auction/']::attr(href)").getall()
        # Find all cards/items
        for link in set(links):
            if "/auction/view/id/" in link or "/auction/auction/view/" in link:
                cards.append({"url": link})

        # Collect images associated with auctions
        imgs = []
        for src in page.css("img::attr(src)").getall():
            if ("docserv" in src or "storage.googleapis.com/bfile-prod-assets-img" in src) and any(ext in src.lower() for ext in [".jpg", ".png", ".webp", "original"]):
                imgs.append(src)

        return {
            "success": True,
            "url": url,
            "status": page.status,
            "auctionLinks": cards,
            "foundImages": imgs,
            "totalLinks": len(cards),
            "totalImages": len(imgs),
            "scrapedAt": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        return {
            "success": False,
            "url": url,
            "error": str(e),
            "scrapedAt": datetime.now(timezone.utc).isoformat(),
        }

def main():
    parser = argparse.ArgumentParser(description="Scrapling bridge for bstock-command")
    parser.add_argument("--action", required=True, choices=["solve-clearance", "scrape-lot", "scrape-listings", "status"])
    parser.add_argument("--url", default="https://bstock.com")
    parser.add_argument("--lot-id", dest="lot_id", default=None)
    parser.add_argument("--clearance", default=None)

    args = parser.parse_args()

    if args.action == "status":
        StealthyFetcher, Fetcher = get_scrapling()
        import scrapling
        res = {
            "scraplingVersion": getattr(scrapling, "__version__", "0.5.1"),
            "fetchersAvailable": ["StealthyFetcher", "Fetcher"],
            "pythonVersion": sys.version,
            "ready": True,
        }
        print(json.dumps(res, indent=2))
        return

    if args.action == "solve-clearance":
        res = solve_clearance(args.url)
        print(json.dumps(res, indent=2))
        return

    if args.action == "scrape-lot":
        target = args.url if args.url != "https://bstock.com" else (args.lot_id or "59391")
        res = scrape_lot(target, args.clearance)
        print(json.dumps(res, indent=2))
        return

    if args.action == "scrape-listings":
        res = scrape_listings(args.url if args.url != "https://bstock.com" else "https://bstock.com/all-auctions/")
        print(json.dumps(res, indent=2))
        return

if __name__ == "__main__":
    main()
