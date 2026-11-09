# Product Truth

## Overview
**B-Stock Command** is a high-velocity buying terminal and arbitrage analytics platform built specifically for pallet and truckload liquidation resellers sourcing inventory through B-Stock Supply and enterprise retail auctions. It unifies auction stream aggregation, automated landed-cost modeling, real-time bid velocity tracking, and guarded execution so resellers can identify profitable liquidation lots and execute bids without costly margin mistakes.

## Target User & Jobs to Be Done
* **Primary Reseller Persona:** High-volume pallet resellers, bin-store operators, eBay/Amazon liquidation sellers, and bulk refurbished-goods dealers operating both from dedicated warehouse workstations and on-the-go mobile devices (inspecting lots from trucks, warehouses, or on the road).
* **Core Job 1 (Market Discovery):** Quickly scan hundreds of active auctions across multiple B-Stock marketplaces, filter by condition, category, pallet count, and geography, and immediately see calculated net margins instead of raw bid prices.
* **Core Job 2 (Landed-Cost & Margin Modeling):** Automatically factor in buyer premiums (typically 10-15%), freight/shipping estimates, sales tax, restoration costs, and category recovery rates to establish an infallible "Max Hammer" price.
* **Core Job 3 (Guarded Bid Execution):** Prevent fat-finger mistakes and auction frenzies through two-phase execution: cryptographic/signed plan tokens with 10-minute validity, explicit "armed" flags, and safe dry-run simulation mode before placing live bids.
* **Core Job 4 (Mobile & Field Operation):** Monitor expiring lots on mobile phones, receive urgent auction countdowns (under 6 hours), inspect bid curves, and submit planned bids with responsive touch controls.

## Core Capabilities
1. **Real-time Auction Ingestion & Sync:** Scrapes or synchronizes active lots across B-Stock enterprise portals (e.g. Target, Amazon, Walmart, Home Depot, Wayfair) with automatic facet extraction.
2. **Proprietary 0–100 Arbitrage Scoring:** Evaluates lot velocity, retail spread, historical recovery rates, manifest completeness, and shipping distance to compute a composite deal score.
3. **Interactive Bid Curve & Velocity Analytics:** Tracks unique bidders, bid acceleration, and snipe patterns to predict final hammer price before closing.
4. **Reseller Decision Overrides:** Allows operators to customize recovery percentages, target ROI thresholds, and custom risk notes per lot.
5. **Two-Stage Guarded Bidding Engine:** Generates cryptographically verifiable bid plans with strict per-bid and daily spend caps to prevent unauthorized or runaway bidding.
6. **Adaptive Mobile Terminal:** Dedicated mobile-first layout with instant lot detail drawer/views, 44px touch targets, and high-contrast ambient dark mode readable in bright warehouse environments.

## Platform & Constraints
* **Platform:** Web application (Mobile Responsive Web & Desktop Workstation Terminal, PWA-ready).
* **Stack:** React 19, TypeScript 5.9, Vite 7, Fastify 5 backend, Firebase / Cloud Storage synchronization.
* **Design Mode:** *Operate* — Resellers make rapid capital allocation decisions. Scanability, tactile certainty, contrast compliance (WCAG AA >= 4.5:1), and zero layout lag outrank decorative flourishes.
* **Offline/Static Fallback:** Operates seamlessly with static pre-generated data fixtures (`public/data/listings.json`) when offline or during CI deployments.

## Brand Commitments & Voice
* **Tone:** Tactical, disciplined, authoritative, precise.
* **Visual Philosophy:** Industrial financial terminal meets warehouse logistics instrument. High-contrast dark surfaces, high-legibility numerals, zero extraneous decoration, zero gradient text, and real vector iconography.
* **Core Tagline:** *Tactical Liquidation & Auction Terminal*
