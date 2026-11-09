import { useCallback, useEffect, useMemo, useState } from "react";
import type { ListingRow } from "./api.ts";
import { api } from "./api.ts";
import "./styles.css";

const fmtMoney = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "-"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);

const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `${(n * 100).toFixed(1)}%`);

const hoursUntil = (iso: string) => (Date.parse(iso) - Date.now()) / 3600_000;

/* SVG ICONS */
function BrandIcon() {
  return (
    <svg className="brand-icon" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="36" height="36" rx="8" fill="#111722" stroke="#243046" strokeWidth="1.5" />
      <circle cx="18" cy="18" r="12" stroke="#182030" strokeWidth="1.5" strokeDasharray="2 2" />
      <path d="M12 21L18 17L24 21L18 25L12 21Z" fill="#182030" stroke="#38bdf8" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 17L18 13L24 17L18 21L12 17Z" fill="#111722" stroke="#10b981" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M18 13V21" stroke="#10b981" strokeWidth="1.5" />
      <circle cx="18" cy="13" r="2" fill="#34d399" />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "#fbbf24" : "none"} stroke={filled ? "#fbbf24" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function SyncIcon({ spin }: { spin?: boolean }) {
  return (
    <svg className={spin ? "spin-icon" : ""} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  const s = score ?? 0;
  const tone = s >= 75 ? "good" : s >= 50 ? "mid" : "low";
  return <span className={`score score-${tone}`}>{s.toFixed(0)}</span>;
}

function TierBadge({ tier }: { tier?: string | null }) {
  if (!tier) return null;
  const map: Record<string, { cls: string; label: string; icon: string }> = {
    ALPHA_GEM: { cls: "tier-alpha", label: "Alpha Gem", icon: "💎" },
    SLEEPER_SNIPE: { cls: "tier-sleeper", label: "Sleeper Snipe", icon: "⚡" },
    SOLID_VALUE: { cls: "tier-solid", label: "Solid Value", icon: "📈" },
    SPECULATIVE: { cls: "tier-speculative", label: "Speculative", icon: "🎲" },
    AVOID: { cls: "tier-avoid", label: "Avoid", icon: "⚠️" },
  };
  const t = map[tier] ?? { cls: "tier-speculative", label: tier, icon: "•" };
  return (
    <span className={`tier-badge ${t.cls}`}>
      <span>{t.icon}</span> {t.label}
    </span>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

export function App() {
  const [status, setStatus] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [facets, setFacets] = useState<any>(null);
  const [selected, setSelected] = useState<ListingRow | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);

  // Mobile navigation tab state
  const [mobileTab, setMobileTab] = useState<"auctions" | "watchlist" | "detail" | "kpis">("auctions");
  const [solvingClearance, setSolvingClearance] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [selectedTier, setSelectedTier] = useState<string>("ALL");
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const [funnelData, setFunnelData] = useState<any>(null);

  const [filters, setFilters] = useState<Record<string, string | number | undefined>>({
    q: "",
    category: "",
    site: "",
    minScore: 0,
    minRoi: 0,
    endingWithinHours: undefined,
    sort: "score",
    limit: 100,
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [st, cfg, res] = await Promise.all([api.status(), api.settings(), api.listings(filters)]);
      setStatus(st);
      setSettings(cfg);
      setListings(Array.isArray(res?.listings) ? res.listings : []);
      setFacets(res?.facets ?? null);
      api.funnelListings(filters).then(setFunnelData).catch(() => {});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const onSolveClearance = async () => {
    setSolvingClearance(true);
    setError(null);
    try {
      const res = await api.solveClearance();
      if (res.success) {
        await refresh();
      } else {
        setError(res.error || "Failed to solve Cloudflare clearance via Scrapling");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSolvingClearance(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadDetail = useCallback(async (row: ListingRow) => {
    setSelected(row);
    setDetail(null);
    try {
      const d = await api.listing(row.listingId);
      setDetail(d);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const onSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await api.sync({ pages: 4, pageSize: 80, withBidsFor: 30 });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const kpis = useMemo(() => {
    const safeListings = Array.isArray(listings) ? listings : [];
    const count = safeListings.length;
    const avgScore = count ? safeListings.reduce((s, l) => s + (l.score ?? 0), 0) / count : 0;
    const soon = safeListings.filter((l) => hoursUntil(l.endsAt) <= 6).length;
    const watched = safeListings.filter((l) => l.watched).length;
    const projectedProfit = safeListings.reduce((s, l) => {
      const projected = l.projected ?? l.currentBid ?? 0;
      const retail = l.retail ?? 0;
      return s + (retail * 0.4 - projected);
    }, 0);
    return { count, avgScore, soon, watched, projectedProfit };
  }, [listings]);

  // Filter listings by active mobile view if in watchlist mode and selected tier
  const displayedListings = useMemo(() => {
    let list = Array.isArray(listings) ? listings : [];
    if (mobileTab === "watchlist") {
      list = list.filter((l) => l.watched);
    }
    if (selectedTier !== "ALL") {
      list = list.filter((l) => l.opportunityTier === selectedTier);
    }
    return list;
  }, [listings, mobileTab, selectedTier]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filters.q) count++;
    if (filters.category) count++;
    if (filters.site) count++;
    if (Number(filters.minScore ?? 0) > 0) count++;
    if (Number(filters.minRoi ?? 0) > 0) count++;
    if (filters.endingWithinHours) count++;
    if (filters.sort !== "score") count++;
    return count;
  }, [filters]);

  const resetFilters = () => {
    setFilters({
      q: "",
      category: "",
      site: "",
      minScore: 0,
      minRoi: 0,
      endingWithinHours: undefined,
      sort: "score",
      limit: 100,
    });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <BrandIcon />
          <div className="brand-title-wrap">
            <span className="brand-title">B-STOCK COMMAND</span>
            <span className="brand-sub">TACTICAL AUCTION TERMINAL</span>
          </div>
        </div>

        {/* Desktop Status Cluster */}
        <div className="status-cluster">
          <span className={`pill pill-${status?.mode ?? "off"}`}>{status?.mode ?? "ready"}</span>
          <span className={`pill ${status?.credentials?.hasClearance ? "pill-ok" : "pill-warn"}`}>
            {status?.credentials?.hasClearance ? "clearance OK" : "no clearance"}
          </span>
          <span className={`pill ${status?.credentials?.hasToken ? "pill-ok" : "pill-warn"}`}>
            {status?.credentials?.hasToken ? "token OK" : "no token"}
          </span>
          <span className={`pill ${status?.scraper?.ready ? "pill-ok" : "pill-muted"}`} title={status?.scraper?.pythonPath ?? "Scrapling stealth engine"}>
            {status?.scraper?.ready ? "scrapling OK" : "scrapling off"}
          </span>
          <span className={`pill ${status?.storage?.initialized ? "pill-ok" : "pill-muted"}`} title={status?.storage?.storageBucket ?? "Storage"}>
            {status?.storage?.initialized ? "cloud OK" : "local cache"}
          </span>
          <span className="pill pill-muted">{status?.stats?.listings ?? listings.length} lots stored</span>
        </div>

        <div className="topbar-actions">
          <button
            className="btn-scraper"
            onClick={onSolveClearance}
            disabled={solvingClearance}
            title="Solve Cloudflare Turnstile challenge with Scrapling"
          >
            {solvingClearance ? "Solving Turnstile..." : "⚡ Solve Cloudflare"}
          </button>
          <div className="view-mode-toggle">
            <button className={`view-mode-btn ${viewMode === "table" ? "active" : ""}`} onClick={() => setViewMode("table")}>
              Table
            </button>
            <button className={`view-mode-btn ${viewMode === "cards" ? "active" : ""}`} onClick={() => setViewMode("cards")}>
              Pallets 📸
            </button>
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => setFilterModalOpen(true)}
            aria-label="Open filter settings"
            title="Filter Auctions"
          >
            <FilterIcon />
            <span>Filter{activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ""}</span>
          </button>
          <button
            className="btn btn-primary"
            onClick={onSync}
            disabled={syncing}
            aria-label="Sync auctions with market"
          >
            <SyncIcon spin={syncing} />
            <span className="btn-desktop-only">{syncing ? "Syncing..." : "Sync Market"}</span>
          </button>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open terminal trading settings"
            title="Trading Settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      {error ? (
        <div className="error-banner">
          <span>{error}</span>
          <button className="btn btn-ghost btn-icon" onClick={() => setError(null)} aria-label="Dismiss error">
            <CloseIcon />
          </button>
        </div>
      ) : null}

      {/* KPI Ribbon (Desktop) */}
      <section className="kpis">
        <Kpi label="lots in view" value={String(kpis.count)} sub={`${status?.stats?.listings ?? listings.length} stored`} />
        <Kpi label="avg score" value={kpis.avgScore.toFixed(1)} sub="0-100 composite index" />
        <Kpi label="ending soon" value={String(kpis.soon)} sub="closing under 6 hours" />
        <Kpi label="watched lots" value={String(kpis.watched)} sub="saved to review" />
        <Kpi label="projected profit" value={fmtMoney(kpis.projectedProfit)} sub="estimated at 40% recovery" />
      </section>

      {/* Mobile Quick Chips */}
      <div className="quick-chips">
        <button
          className={`chip-btn ${mobileTab === "auctions" && !filters.endingWithinHours && !filters.minRoi ? "active" : ""}`}
          onClick={() => {
            setMobileTab("auctions");
            resetFilters();
          }}
        >
          All Lots ({listings.length})
        </button>
        <button
          className={`chip-btn ${mobileTab === "watchlist" ? "active" : ""}`}
          onClick={() => setMobileTab("watchlist")}
        >
          <StarIcon filled={mobileTab === "watchlist"} />
          Watched ({kpis.watched})
        </button>
        <button
          className={`chip-btn ${filters.endingWithinHours === 6 ? "active" : ""}`}
          onClick={() => setFilters((f) => ({ ...f, endingWithinHours: f.endingWithinHours === 6 ? undefined : 6 }))}
        >
          <ClockIcon />
          Urgent &lt;6h ({kpis.soon})
        </button>
        <button
          className={`chip-btn ${filters.minScore === 75 ? "active" : ""}`}
          onClick={() => setFilters((f) => ({ ...f, minScore: f.minScore === 75 ? 0 : 75 }))}
        >
          Score 75+
        </button>
        <button
          className={`chip-btn ${filters.minRoi === 0.3 ? "active" : ""}`}
          onClick={() => setFilters((f) => ({ ...f, minRoi: f.minRoi === 0.3 ? 0 : 0.3 }))}
        >
          ROI &gt;30%
        </button>
        <button className="chip-btn" onClick={() => setFilterModalOpen(true)}>
          <FilterIcon />
          More Filters...
        </button>
      </div>

      {/* Filter Bar (Desktop) */}
      <section className="filters desktop-filters">
        <input
          className="input"
          placeholder="Search lot title, site, condition..."
          value={String(filters.q ?? "")}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        />
        <select className="select" value={String(filters.category ?? "")} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}>
          <option value="">all categories</option>
          {facets?.categories?.map((c: any) => (
            <option key={c.category} value={c.category}>
              {c.category} ({c.count})
            </option>
          ))}
        </select>
        <select className="select" value={String(filters.site ?? "")} onChange={(e) => setFilters((f) => ({ ...f, site: e.target.value }))}>
          <option value="">all marketplaces</option>
          {facets?.sites?.map((s: any) => (
            <option key={s.site_abb} value={s.site_abb}>
              {s.site_abb} ({s.count})
            </option>
          ))}
        </select>
        <label className="filter-label">
          min score
          <input type="range" min={0} max={100} value={Number(filters.minScore ?? 0)} onChange={(e) => setFilters((f) => ({ ...f, minScore: Number(e.target.value) }))} />
          <span>{filters.minScore}</span>
        </label>
        <label className="filter-label">
          min ROI
          <input type="range" min={0} max={1} step={0.05} value={Number(filters.minRoi ?? 0)} onChange={(e) => setFilters((f) => ({ ...f, minRoi: Number(e.target.value) }))} />
          <span>{fmtPct(Number(filters.minRoi ?? 0))}</span>
        </label>
        <select className="select" value={String(filters.endingWithinHours ?? "")} onChange={(e) => setFilters((f) => ({ ...f, endingWithinHours: e.target.value ? Number(e.target.value) : undefined }))}>
          <option value="">any horizon</option>
          <option value="6">&le; 6 hours</option>
          <option value="24">&le; 24 hours</option>
          <option value="72">&le; 3 days</option>
        </select>
        <select className="select" value={String(filters.sort ?? "score")} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}>
          <option value="score">sort: score</option>
          <option value="roi">sort: ROI</option>
          <option value="ending">sort: ending soon</option>
          <option value="discount">sort: cheapest</option>
          <option value="bids">sort: least contested</option>
          <option value="price">sort: lowest bid</option>
        </select>
        <button className="btn btn-ghost" onClick={refresh} disabled={loading}>
          {loading ? "..." : "apply"}
        </button>
      </section>

      {/* Main Layout */}
      <main className="layout">
        {/* Desktop Table View */}
        <section className="table-wrap">
          <table className="lots">
            <thead>
              <tr>
                <th>score</th>
                <th>lot description</th>
                <th>site</th>
                <th className="num">pallets</th>
                <th className="num">retail</th>
                <th className="num">current bid</th>
                <th className="num">max hammer</th>
                <th className="num">ROI</th>
                <th className="num">cost/retail</th>
                <th className="num">bids</th>
                <th className="num">ends</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {displayedListings.map((l) => (
                <tr key={l.listingId} className={selected?.listingId === l.listingId ? "row-selected" : ""} onClick={() => loadDetail(l)}>
                  <td><ScoreBadge score={l.score} /></td>
                  <td className="lot-cell">
                    <div className="lot-title">{l.title ?? l.listingId}</div>
                    <div className="lot-sub">{l.category} · {l.condition}</div>
                  </td>
                  <td><span className="site-chip">{l.site}</span></td>
                  <td className="num">{l.pallets ?? "-"}</td>
                  <td className="num">{fmtMoney(l.retail)}</td>
                  <td className="num">{fmtMoney(l.currentBid)}</td>
                  <td className="num accent">{fmtMoney(l.maxHammer)}</td>
                  <td className="num">{fmtPct(l.roi)}</td>
                  <td className="num">{fmtPct(l.costToRetail)}</td>
                  <td className="num">{l.bids}{l.uniqueBidders ? ` (${l.uniqueBidders})` : ""}</td>
                  <td className="num">{hoursUntil(l.endsAt).toFixed(1)}h</td>
                  <td>
                    <button
                      className={`watch-btn ${l.watched ? "watched" : ""}`}
                      aria-label={l.watched ? "Unwatch auction" : "Watch auction"}
                      onClick={(e) => {
                        e.stopPropagation();
                        (l.watched ? api.unwatch(l.listingId) : api.watch(l.listingId)).then(refresh);
                      }}
                    >
                      <StarIcon filled={l.watched} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {displayedListings.length === 0 ? (
            <div className="empty">No lots found in this view. Adjust your filters or run a market sync.</div>
          ) : null}
        </section>

        {/* Mobile Tactical Cards */}
        <section className={`mobile-cards-wrap ${mobileTab === "detail" || mobileTab === "kpis" ? "hidden-view" : ""}`}>
          {displayedListings.map((l) => {
            const endsIn = hoursUntil(l.endsAt);
            return (
              <div
                key={l.listingId}
                className={`tactical-card ${selected?.listingId === l.listingId ? "selected" : ""}`}
                onClick={() => {
                  loadDetail(l);
                  setMobileTab("detail");
                }}
              >
                <div className="card-top">
                  <div className="card-top-left">
                    <ScoreBadge score={l.score} />
                    <span className="site-chip">{l.site}</span>
                    <span className="lot-sub">{l.category}</span>
                  </div>
                  <button
                    className={`watch-btn ${l.watched ? "watched" : ""}`}
                    aria-label={l.watched ? "Unwatch lot" : "Watch lot"}
                    onClick={(e) => {
                      e.stopPropagation();
                      (l.watched ? api.unwatch(l.listingId) : api.watch(l.listingId)).then(refresh);
                    }}
                  >
                    <StarIcon filled={l.watched} />
                  </button>
                </div>

                <div className="card-title">{l.title ?? l.listingId}</div>

                <div className="card-metrics-grid">
                  <div className="card-metric">
                    <span className="card-metric-label">Max Hammer</span>
                    <span className="card-metric-val accent">{fmtMoney(l.maxHammer)}</span>
                  </div>
                  <div className="card-metric">
                    <span className="card-metric-label">Current Bid</span>
                    <span className="card-metric-val">{fmtMoney(l.currentBid)}</span>
                  </div>
                  <div className="card-metric">
                    <span className="card-metric-label">Retail Value</span>
                    <span className="card-metric-val">{fmtMoney(l.retail)}</span>
                  </div>
                  <div className="card-metric">
                    <span className="card-metric-label">Est. ROI</span>
                    <span className="card-metric-val accent">{fmtPct(l.roi)}</span>
                  </div>
                </div>

                <div className="card-bottom">
                  <span>{l.pallets ? `${l.pallets} pallets` : "LTL Lot"} · {l.condition}</span>
                  <span className={`countdown-pill ${endsIn <= 6 ? "countdown-soon" : ""}`}>
                    <ClockIcon />
                    {endsIn <= 0 ? "Ended" : `${endsIn.toFixed(1)}h left`}
                  </span>
                </div>
              </div>
            );
          })}
          {displayedListings.length === 0 ? (
            <div className="empty">No lots match active filters. Try clearing search filters.</div>
          ) : null}
        </section>

        {/* Mobile KPIs Full View */}
        {mobileTab === "kpis" ? (
          <section className="kpis mobile-view">
            <Kpi label="lots in view" value={String(kpis.count)} sub={`${status?.stats?.listings ?? listings.length} total stored`} />
            <Kpi label="avg score" value={kpis.avgScore.toFixed(1)} sub="0-100 composite index" />
            <Kpi label="closing soon" value={String(kpis.soon)} sub="urgent under 6 hours" />
            <Kpi label="watched lots" value={String(kpis.watched)} sub="saved for bidding" />
            <Kpi label="projected profit" value={fmtMoney(kpis.projectedProfit)} sub="est. at 40% recovery" />
            <div className="kpi" style={{ gridColumn: "span 2" }}>
              <div className="kpi-label">Terminal Status</div>
              <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                <span className={`pill pill-${status?.mode ?? "off"}`}>Mode: {status?.mode ?? "ready"}</span>
                <span className={`pill ${status?.credentials?.hasClearance ? "pill-ok" : "pill-warn"}`}>
                  {status?.credentials?.hasClearance ? "Clearance Active" : "No Clearance"}
                </span>
                <span className={`pill ${status?.credentials?.hasToken ? "pill-ok" : "pill-warn"}`}>
                  {status?.credentials?.hasToken ? "Auth Token Ready" : "Unauthenticated"}
                </span>
              </div>
            </div>
          </section>
        ) : null}

        {/* Detail Inspection & Execution Pane */}
        <aside className={`detail ${mobileTab === "detail" ? "active-view" : ""}`}>
          <button className="mobile-back-bar" onClick={() => setMobileTab("auctions")}>
            <ChevronLeftIcon />
            <span>Back to All Lots</span>
          </button>

          {!selected ? (
            <div className="detail-empty">
              <BoxIcon />
              <span>Select any lot from the list to inspect unit economics, bid acceleration, and place guarded orders.</span>
            </div>
          ) : (
            <DetailPanel listing={selected} detail={detail} onRefresh={refresh} settings={settings} />
          )}
        </aside>
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="bottom-nav">
        <button
          className={`nav-tab-btn ${mobileTab === "auctions" ? "active" : ""}`}
          onClick={() => setMobileTab("auctions")}
        >
          <BoxIcon />
          <span>Auctions</span>
        </button>
        <button
          className={`nav-tab-btn ${mobileTab === "watchlist" ? "active" : ""}`}
          onClick={() => setMobileTab("watchlist")}
        >
          <StarIcon filled={mobileTab === "watchlist"} />
          <span>Watch ({kpis.watched})</span>
        </button>
        <button
          className={`nav-tab-btn ${mobileTab === "detail" ? "active" : ""}`}
          onClick={() => setMobileTab("detail")}
        >
          <FilterIcon />
          <span>{selected ? "Lot Detail" : "Inspect"}</span>
        </button>
        <button
          className={`nav-tab-btn ${mobileTab === "kpis" ? "active" : ""}`}
          onClick={() => setMobileTab("kpis")}
        >
          <ActivityIcon />
          <span>Status</span>
        </button>
      </nav>

      {/* Filter Bottom Sheet / Modal */}
      {filterModalOpen ? (
        <div className="modal-backdrop" onClick={() => setFilterModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span className="block-title">Filter & Sort Auctions</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setFilterModalOpen(false)} aria-label="Close filters">
                <CloseIcon />
              </button>
            </div>
            <div className="modal-body">
              <div className="ticket-row">
                <label>Keyword Search</label>
                <input
                  className="input"
                  placeholder="Lot title, marketplace, city..."
                  value={String(filters.q ?? "")}
                  onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                />
              </div>

              <div className="ticket-row">
                <label>Category</label>
                <select className="select" value={String(filters.category ?? "")} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}>
                  <option value="">All Categories</option>
                  {facets?.categories?.map((c: any) => (
                    <option key={c.category} value={c.category}>
                      {c.category} ({c.count})
                    </option>
                  ))}
                </select>
              </div>

              <div className="ticket-row">
                <label>Marketplace Site</label>
                <select className="select" value={String(filters.site ?? "")} onChange={(e) => setFilters((f) => ({ ...f, site: e.target.value }))}>
                  <option value="">All Marketplaces</option>
                  {facets?.sites?.map((s: any) => (
                    <option key={s.site_abb} value={s.site_abb}>
                      {s.site_abb} ({s.count})
                    </option>
                  ))}
                </select>
              </div>

              <div className="ticket-row">
                <label>Minimum Arbitrage Score: {filters.minScore ?? 0}</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Number(filters.minScore ?? 0)}
                  onChange={(e) => setFilters((f) => ({ ...f, minScore: Number(e.target.value) }))}
                />
              </div>

              <div className="ticket-row">
                <label>Minimum Target ROI: {fmtPct(Number(filters.minRoi ?? 0))}</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={Number(filters.minRoi ?? 0)}
                  onChange={(e) => setFilters((f) => ({ ...f, minRoi: Number(e.target.value) }))}
                />
              </div>

              <div className="ticket-row">
                <label>Auction Closing Horizon</label>
                <select
                  className="select"
                  value={String(filters.endingWithinHours ?? "")}
                  onChange={(e) => setFilters((f) => ({ ...f, endingWithinHours: e.target.value ? Number(e.target.value) : undefined }))}
                >
                  <option value="">Any Closing Window</option>
                  <option value="6">Closing in &le; 6 hours</option>
                  <option value="24">Closing in &le; 24 hours</option>
                  <option value="72">Closing in &le; 3 days</option>
                </select>
              </div>

              <div className="ticket-row">
                <label>Sort Order</label>
                <select className="select" value={String(filters.sort ?? "score")} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}>
                  <option value="score">Composite Deal Score</option>
                  <option value="roi">Highest Target ROI</option>
                  <option value="ending">Ending Soonest</option>
                  <option value="price">Lowest Current Bid</option>
                  <option value="bids">Least Contested</option>
                </select>
              </div>

              <div className="ticket-actions" style={{ marginTop: "8px" }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    resetFilters();
                    setFilterModalOpen(false);
                  }}
                >
                  Reset
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    refresh();
                    setFilterModalOpen(false);
                  }}
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Settings Modal */}
      {settingsOpen ? (
        <SettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={(s) => {
            setSettings(s);
            setSettingsOpen(false);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function DetailPanel({ listing, detail, onRefresh, settings, onOpenImage }: { listing: ListingRow; detail: any; onRefresh: () => void; settings: any; onOpenImage?: (img: string) => void }) {
  const [amount, setAmount] = useState<number>(listing.maxHammer ?? listing.nextMinBid ?? 0);
  const [armed, setArmed] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [planToken, setPlanToken] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [scrapingPhotos, setScrapingPhotos] = useState(false);
  const [cachingImage, setCachingImage] = useState(false);
  const [scrapeNotice, setScrapeNotice] = useState<string | null>(null);

  useEffect(() => {
    setAmount(listing.maxHammer ?? listing.nextMinBid ?? 0);
    setPlanToken(null);
    setResult(null);
    setArmed(false);
    setScrapeNotice(null);
  }, [listing.listingId]);

  const onPlan = async () => {
    setBusy(true);
    setResult(null);
    try {
      const p = await api.plan(listing.listingId, amount);
      setPlanToken(p.planToken);
      setResult({ plan: p });
    } catch (err) {
      setResult({ error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const onExecute = async () => {
    if (!planToken) return;
    setBusy(true);
    try {
      const r = await api.execute({
        listingId: listing.listingId,
        planToken,
        amount,
        armed,
        dryRun,
        idempotencyKey: `${listing.listingId}-${Date.now()}`,
      });
      setResult(r);
      if (r.status === "placed" || r.status === "dry-run") onRefresh();
    } catch (err) {
      setResult({ error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const scrapeLotPhotos = async () => {
    setScrapingPhotos(true);
    setScrapeNotice(null);
    try {
      const res = await api.scrapeLot(listing.lotId, listing.listingId);
      if (res.success) {
        setScrapeNotice(`Scraped ${res.images?.length ?? 0} photos successfully!`);
        onRefresh();
      } else {
        setScrapeNotice(`Scrape notice: ${res.error}`);
      }
    } catch (err) {
      setScrapeNotice((err as Error).message);
    } finally {
      setScrapingPhotos(false);
    }
  };

  const cachePhoto = async () => {
    setCachingImage(true);
    try {
      await api.cacheListingImage(listing.listingId);
      onRefresh();
    } finally {
      setCachingImage(false);
    }
  };

  const projected = detail?.projected;
  const maxHammer = detail?.maxHammer ?? listing.maxHammer;
  const funnel = detail?.funnel;

  const allImages: string[] = [];
  if (listing.imageUrl) allImages.push(listing.imageUrl);
  if (Array.isArray(detail?.listing?.images)) {
    for (const img of detail.listing.images) {
      if (!allImages.includes(img)) allImages.push(img);
    }
  }

  return (
    <div className="detail-inner">
      <div className="detail-head">
        <div>
          <div className="detail-title">{listing.title ?? listing.listingId}</div>
          <div className="detail-sub">{listing.site} · {listing.category} · {listing.condition} · {listing.pallets ?? 1} pallets · {listing.units ?? "-"} units</div>
          <div style={{ marginTop: "6px" }}>
            <TierBadge tier={funnel?.tier ?? listing.opportunityTier ?? (listing.score && listing.score >= 75 ? "ALPHA_GEM" : "SOLID_VALUE")} />
          </div>
        </div>
        <ScoreBadge score={listing.score} />
      </div>

      {/* Pallet Image Gallery */}
      {allImages.length > 0 ? (
        <div className="detail-gallery">
          {allImages.map((img, idx) => (
            <img
              key={idx}
              src={img}
              alt="Pallet item"
              className="detail-gallery-thumb"
              onClick={() => onOpenImage?.(img)}
              onError={(e) => { (e.target as HTMLElement).style.display = "none"; }}
            />
          ))}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: "8px", margin: "6px 0 12px 0", flexWrap: "wrap" }}>
        <button className="btn-scraper" onClick={scrapeLotPhotos} disabled={scrapingPhotos}>
          {scrapingPhotos ? "Scraping Photos..." : "⚡ Scrape Deep Photos (Scrapling)"}
        </button>
        {listing.imageUrl ? (
          <button className="btn-scraper" onClick={cachePhoto} disabled={cachingImage}>
            {cachingImage ? "Caching..." : "💾 Cache to Firebase/Local"}
          </button>
        ) : null}
      </div>
      {scrapeNotice ? <div style={{ fontSize: "11px", color: "var(--accent-2)", marginBottom: "8px" }}>{scrapeNotice}</div> : null}

      <div className="detail-grid">
        <div className="metric"><span>retail value</span><b>{fmtMoney(listing.retail)}</b></div>
        <div className="metric"><span>current bid</span><b>{fmtMoney(listing.currentBid)}</b></div>
        <div className="metric"><span>next minimum</span><b>{fmtMoney(listing.nextMinBid)}</b></div>
        <div className="metric"><span>max hammer</span><b className="accent">{fmtMoney(maxHammer)}</b></div>
        <div className="metric"><span>projected close</span><b>{fmtMoney(projected?.projected ?? listing.projected)}</b></div>
        <div className="metric"><span>est. ROI</span><b className="accent">{fmtPct(listing.roi)}</b></div>
        <div className="metric"><span>cost / retail</span><b>{fmtPct(listing.costToRetail)}</b></div>
        <div className="metric"><span>cost / pallet</span><b>{fmtMoney(listing.costPerPallet)}</b></div>
      </div>

      {/* Advanced Mathematical & Algebraic Funnel Card */}
      <div className="block">
        <div className="block-title">📐 Mathematical & Algebraic Funnel Model</div>
        <div className="math-breakdown-box">
          <div className="math-row">
            <span className="math-formula">Max Allowable Hammer H_max:</span>
            <span className="math-val accent">{fmtMoney(funnel?.algebraic?.maxHammer ?? maxHammer)}</span>
          </div>
          <div className="math-row">
            <span className="math-formula">Break-Even Hammer (0% ROI):</span>
            <span className="math-val">{fmtMoney(funnel?.algebraic?.breakEvenHammer)}</span>
          </div>
          <div className="math-row">
            <span className="math-formula">ROI Elasticity d(ROI)/dH:</span>
            <span className="math-val">{funnel?.algebraic?.roiElasticity ? `${funnel.algebraic.roiElasticity}x` : "—"}</span>
          </div>
          <div className="math-row">
            <span className="math-formula">Pallet Retail Density Dr:</span>
            <span className="math-val">{fmtMoney(funnel?.density?.retailPerPallet)}/pallet</span>
          </div>
          <div className="math-row">
            <span className="math-formula">Unit Landed Cost Cu:</span>
            <span className="math-val">{fmtMoney(funnel?.density?.costPerUnit)}/unit</span>
          </div>
          <div className="math-row">
            <span className="math-formula">Bidder Shannon Entropy H:</span>
            <span className="math-val">{funnel?.pattern?.bidderEntropy !== undefined ? `${(funnel.pattern.bidderEntropy * 100).toFixed(0)}%` : "—"}</span>
          </div>
          <div className="math-row">
            <span className="math-formula">Snipe Pressure Urgency Index:</span>
            <span className="math-val">{funnel?.pattern?.snipePressureIndex !== undefined ? `${(funnel.pattern.snipePressureIndex * 100).toFixed(0)}%` : "—"}</span>
          </div>
          <div className="math-row">
            <span className="math-formula">Kelly Capital Allocation f*:</span>
            <span className="math-val accent">{funnel?.kellyFraction !== undefined ? `${(funnel.kellyFraction * 100).toFixed(1)}%` : "—"}</span>
          </div>
          <div className="math-row">
            <span className="math-formula">Opportunity Tier:</span>
            <TierBadge tier={funnel?.tier ?? listing.opportunityTier ?? "SOLID_VALUE"} />
          </div>
        </div>
      </div>

      {detail?.bids?.length ? (
        <div className="chart-block">
          <div className="block-title">bid acceleration · {detail.bids.length} bids · {detail.velocity?.uniqueBidders ?? 1} bidders</div>
          <BidCurve bids={detail.bids} />
        </div>
      ) : null}

      {listing.reasons?.length ? (
        <div className="block">
          <div className="block-title">deal advantages</div>
          <ul className="reasons">{listing.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      ) : null}

      {listing.risks?.length ? (
        <div className="block">
          <div className="block-title risk-title">risk considerations</div>
          <ul className="risks">{listing.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      ) : null}

      {/* Guarded Bidding Ticket */}
      <div className="ticket">
        <div className="block-title">guarded execution ticket</div>
        <div className="ticket-row">
          <label>Target Bid Limit (USD)</label>
          <input
            type="number"
            className="input"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
          <div className="quick-amount-buttons">
            <button className="quick-amt-btn" type="button" onClick={() => setAmount((a) => a + 25)}>+$25</button>
            <button className="quick-amt-btn" type="button" onClick={() => setAmount((a) => a + 50)}>+$50</button>
            <button className="quick-amt-btn" type="button" onClick={() => setAmount((a) => a + 100)}>+$100</button>
            {maxHammer ? (
              <button className="quick-amt-btn" type="button" onClick={() => setAmount(maxHammer)}>
                Max Hammer ({fmtMoney(maxHammer)})
              </button>
            ) : null}
          </div>
        </div>

        <div className="ticket-row ticket-row-inline">
          <label className="toggle">
            <input type="checkbox" checked={armed} onChange={(e) => setArmed(e.target.checked)} />
            <span>armed for execution</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            <span>simulation dry-run</span>
          </label>
        </div>

        <div className="ticket-actions">
          <button className="btn btn-ghost" onClick={onPlan} disabled={busy}>
            {busy ? "Signing..." : "1. Plan & Sign"}
          </button>
          <button className="btn btn-primary" onClick={onExecute} disabled={busy || !planToken}>
            {dryRun ? "2. Execute (Dry Run)" : "2. Execute (Live Order)"}
          </button>
        </div>

        {planToken ? (
          <div className="plan-ok">
            Plan signed · Valid for 10 min · Max bid {fmtMoney(amount)}
          </div>
        ) : null}

        {result ? (
          <pre className="result">{JSON.stringify(result, null, 2)}</pre>
        ) : null}
      </div>

      <div className="ticket">
        <div className="block-title">valuation overrides</div>
        <DecisionForm listing={listing} onSaved={onRefresh} />
      </div>
    </div>
  );
}

function DecisionForm({ listing, onSaved }: { listing: ListingRow; onSaved: () => void }) {
  const [recovery, setRecovery] = useState(0.4);
  const [targetRoi, setTargetRoi] = useState(0.3);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.setDecision(listing.listingId, { recoveryPct: recovery, targetRoi, notes });
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="decision-form">
      <div className="ticket-row">
        <label>Estimated Recovery Rate (fraction)</label>
        <input type="number" step="0.01" className="input" value={recovery} onChange={(e) => setRecovery(Number(e.target.value))} />
      </div>
      <div className="ticket-row">
        <label>Minimum Target ROI (fraction)</label>
        <input type="number" step="0.01" className="input" value={targetRoi} onChange={(e) => setTargetRoi(Number(e.target.value))} />
      </div>
      <div className="ticket-row">
        <label>Reseller Lot Notes</label>
        <textarea className="input" rows={2} value={notes} placeholder="Notes on packaging, manifests, or condition..." onChange={(e) => setNotes(e.target.value)} />
      </div>
      <button className="btn btn-ghost" onClick={save} disabled={busy}>
        {busy ? "Saving..." : "Save Overrides"}
      </button>
    </div>
  );
}

function BidCurve({ bids }: { bids: any[] }) {
  const sorted = [...bids].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const w = 320;
  const h = 130;
  const pad = 12;
  const amounts = sorted.map((b) => b.bidAmount);
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const range = Math.max(1, max - min);
  const pts = sorted.map((b, i) => {
    const x = pad + (i / Math.max(1, sorted.length - 1)) * (w - pad * 2);
    const y = h - pad - ((b.bidAmount - min) / range) * (h - pad * 2);
    return { x, y, winning: b.winning, amount: b.bidAmount };
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart" preserveAspectRatio="none">
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.winning ? 4.5 : 3} fill={p.winning ? "var(--good)" : "var(--accent-2)"} />
      ))}
      <text x={pad} y={14} className="chart-label">{fmtMoney(min, 0)}</text>
      <text x={pad} y={h - 4} className="chart-label">{fmtMoney(max, 0)}</text>
    </svg>
  );
}

function SettingsModal({ settings, onClose, onSaved }: { settings: any; onClose: () => void; onSaved: (s: any) => void }) {
  const [draft, setDraft] = useState<any>({ ...settings });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const s = await api.saveSettings(draft);
      onSaved(s);
    } finally {
      setSaving(false);
    }
  };

  const field = (key: string, label: string, type: "number" | "text" = "number") => (
    <div className="ticket-row">
      <label>{label}</label>
      <input
        type={type}
        className="input"
        value={draft?.[key] ?? ""}
        onChange={(e) => setDraft({ ...draft, [key]: type === "number" ? Number(e.target.value) : e.target.value })}
      />
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="block-title">Terminal Trading Parameters</span>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close settings">
            <CloseIcon />
          </button>
        </div>
        <div className="modal-body">
          {field("perBidCap", "Per-Bid Hard Cap (USD)")}
          {field("dailyCap", "Daily Spend Cap (USD)")}
          {field("minScore", "Minimum Quality Score Floor (0-100)")}
          {field("minRoi", "Target Minimum ROI Fraction (e.g. 0.25)")}
          {field("recoveryPctDefault", "Default Retail Recovery Fraction (e.g. 0.40)")}
          {field("buyerPremiumPct", "Default Buyer Premium Fraction (e.g. 0.125)")}
          {field("shippingDefault", "Default Freight Allocation (USD)")}
          <div className="ticket-row">
            <label>Trading Safety Mode</label>
            <select className="select" value={draft?.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })}>
              <option value="off">Off (Read Only)</option>
              <option value="dry-run">Dry Run (Guarded Simulation)</option>
              <option value="live">Live Bidding (Real Capital)</option>
            </select>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={Boolean(draft?.requireManifest)} onChange={(e) => setDraft({ ...draft, requireManifest: e.target.checked })} />
            <span>Require manifest data before allowing bids</span>
          </label>
          <div className="ticket-actions" style={{ marginTop: "12px" }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save Configuration"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
