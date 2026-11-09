---
name: B-Stock Command
description: Tactical Liquidation & Auction Terminal
colors:
  primary: "#10b981"
  primary-hover: "#34d399"
  secondary: "#38bdf8"
  bg: "#090d14"
  surface: "#111722"
  surface-elevated: "#182030"
  surface-overlay: "#202a3d"
  line: "#243046"
  line-focus: "#38bdf8"
  text-high: "#f1f5f9"
  text-body: "#cbd5e1"
  text-muted: "#94a3b8"
  good: "#34d399"
  good-bg: "#0d2b20"
  warn: "#fbbf24"
  warn-bg: "#2e2107"
  bad: "#f87171"
  bad-bg: "#321317"
typography:
  display:
    fontFamily: "'Space Grotesk', system-ui, -apple-system, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Space Grotesk', system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.02em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.bg}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "16px"
---

## Overview
B-Stock Command operates under **Operate mode**: a professional, high-density arbitrage buying terminal for pallet liquidation auctions. The interface balances maximum information density on desktop with ergonomic, thumb-first control on mobile devices. Brand authority emerges from mathematical precision, high contrast, tactile certainty, and zero decorative visual slop.

## Colors
* **Surface Background (`#090d14`):** Deep obsidian terminal canvas engineered for all-day warehouse and field viewing without glare.
* **Surface Container (`#111722`):** Primary card, sidebar, and table header background.
* **Surface Elevated (`#182030`):** Interactive inputs, modal bodies, and hovered states.
* **Line & Borders (`#243046`):** Sharp 1px structure separating metric blocks and auction rows.
* **Text Contrast Tiering (WCAG AA Compliant):**
  * High-Contrast Headlines & Values: `#f1f5f9` (14.5:1 ratio vs `#090d14`).
  * Body Text & Labels: `#cbd5e1` (10.2:1 ratio vs `#090d14`).
  * Muted Micro-copy & Functional Meta: `#94a3b8` (5.8:1 ratio vs `#090d14`, strictly exceeding the 4.5:1 floor).
* **Accents & Signals:**
  * Emerald (`#10b981` / `#34d399`): Winning bids, positive arbitrage margins, primary actions.
  * Cyan (`#38bdf8`): Data metrics, analytics curves, dry-run simulation mode.
  * Amber (`#fbbf24`): Time-urgent auctions (<= 6 hours), saved lots, caution signals.
  * Crimson (`#f87171`): Margin risk, negative ROI, guarded warnings.

## Typography
* **Primary Sans (`Space Grotesk`):** Clean geometric voice with humanist warmth for headers, titles, and controls.
* **Data & Numeric Font (`JetBrains Mono`):** Tabular figures for currency, countdown timers, scores, percentages, and quantity counts.
* **Strict Size Floors:**
  * Minimum functional UI text: `12px` (no micro-text below 11px).
  * Standard body: `14px` (`0.875rem`).
  * Section headings: `15px` - `18px`.
  * Display KPI numerals: `20px` - `24px` tabular mono.

## Layout
* **Adaptive Breakpoint Strategy:**
  * **Desktop (> 880px):** Dual-pane command terminal. The left pane provides an interactive 11-column data grid with sticky headers; the right pane displays the active lot inspection workbench and bid execution ticket. Unbounded scrolling is strictly forbidden; columns scroll internally with fixed viewport constraints.
  * **Mobile & Tablet (<= 880px):** Responsive single-pane ergonomic view. Lots transition into tactical cards optimized for thumb scanning. Tapping any card opens a dedicated Lot Detail view with back navigation, sticky action bar, and touch-sized controls.
* **Mobile Ergonomics:**
  * Bottom navigation / tab switcher for immediate access to Auctions, Watchlist, Active Bid Ticket, and Settings.
  * Minimum touch targets: `44px x 44px` on all buttons, tabs, toggles, and filters.
  * Inputs enforce `font-size: 16px` on mobile viewports to prevent iOS Safari auto-zoom.

## Elevation & Depth
* Subdued depth: Flat 1px borders (`#243046`) define modules. Zero heavy drop-shadows or gimmicky zero-blur block offsets.
* Floating drawers and modals use dark backdrop dimming (`rgba(0, 0, 0, 0.75)`) and smooth backdrop blur with subtle border elevation.

## Shapes
* Consistent `6px` - `8px` corner radiuses across containers, cards, and input fields.
* Pills and status chips use full pill geometry (`9999px`) with 1px border outlines.
* No aggressive skeuomorphism or neo-brutalist harsh corners.

## Components
* **Tactical Score Badge:** 0–100 composite deal index color-coded (Emerald >= 75, Amber 50–74, Red < 50) rendered in tabular mono with dedicated high-contrast backgrounds.
* **Lot Cards (Mobile):** High-efficiency cards featuring Score, Title, Condition, Pallets, Current Bid vs Max Hammer, projected margin, and countdown timer.
* **Bid Execution Ticket:** Two-stage guarded workflow (Plan -> Sign -> Armed Toggle -> Execute Live/Dry).
* **Filter Drawer / Modal:** Clean mobile bottom sheet consolidating search, category, marketplace site, score range, ROI threshold, and sort criteria.
* **Custom Authored SVG Icons:** Star/Watch, Filter, Sync, Settings, Chevron, Close, Clock, Box, Dollar, External Link (no emojis or unicode glyph stand-ins).

## Do's and Don'ts
* **DO:**
  * Maintain WCAG AA contrast ratio (>= 4.5:1) across all text elements including placeholders.
  * Use tabular figures (`font-variant-numeric: tabular-nums`) for financial figures and countdowns.
  * Keep all touch targets at 44px or larger on touch viewports.
  * Provide instant visual feedback (`active`, `hover`, `focus-visible`) on all interactive surfaces.
* **DON'T:**
  * Don't use text sizes below 11px anywhere in the application.
  * Don't use gradient text or colored text halos.
  * Don't use emojis as icon stand-ins; use consistent SVG icons.
  * Don't nest cards inside cards.
  * Don't allow mobile table overflows without an adaptive card alternative.
