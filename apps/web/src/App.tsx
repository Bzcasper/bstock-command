import { useCallback, useEffect, useMemo, useState } from "react";
import type { ListingRow } from "./api.ts";
import { api } from "./api.ts";
import "./styles.css";

const fmtMoney = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);

const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(1)}%`);

const hoursUntil = (iso: string) => (Date.parse(iso) - Date.now()) / 3600_000;

function ScoreBadge({ score }: { score: number | null }) {
  const s = score ?? 0;
  const tone = s >= 75 ? "good" : s >= 50 ? "mid" : "low";
  return <span className={`score score-${tone}`}>{s.toFixed(0)}</span>;
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
      setListings(res.listings);
      setFacets(res.facets);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

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
    const count = listings.length;
    const avgScore = count ? listings.reduce((s, l) => s + (l.score ?? 0), 0) / count : 0;
    const soon = listings.filter((l) => hoursUntil(l.endsAt) <= 6).length;
    const watched = listings.filter((l) => l.watched).length;
    const projectedProfit = listings.reduce((s, l) => {
      const projected = l.projected ?? l.currentBid ?? 0;
      const retail = l.retail ?? 0;
      return s + (retail * 0.4 - projected);
    }, 0);
    return { count, avgScore, soon, watched, projectedProfit };
  }, [listings]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">BS</span>
          <div>
            <div className="brand-title">B-STOCK COMMAND</div>
            <div className="brand-sub">pallet buying terminal · reseller desk</div>
          </div>
        </div>
        <div className="status-cluster">
          <span className={`pill pill-${status?.mode ?? "off"}`}>{status?.mode ?? "…"}</span>
          <span className={`pill ${status?.credentials?.hasClearance ? "pill-ok" : "pill-warn"}`}>
            {status?.credentials?.hasClearance ? "clearance ✓" : "no clearance"}
          </span>
          <span className={`pill ${status?.credentials?.hasToken ? "pill-ok" : "pill-warn"}`}>
            {status?.credentials?.hasToken ? "token ✓" : "no token"}
          </span>
          <span className="pill pill-muted">{status?.stats?.listings ?? 0} lots</span>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-ghost" onClick={() => setSettingsOpen(true)}>settings</button>
          <button className="btn btn-primary" onClick={onSync} disabled={syncing}>
            {syncing ? "syncing…" : "sync market"}
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="kpis">
        <Kpi label="lots in view" value={String(kpis.count)} sub={`${status?.stats?.listings ?? 0} stored`} />
        <Kpi label="avg score" value={kpis.avgScore.toFixed(1)} sub="0–100 composite" />
        <Kpi label="ending ≤6h" value={String(kpis.soon)} sub="urgent auctions" />
        <Kpi label="watched" value={String(kpis.watched)} sub="saved for review" />
        <Kpi label="est. profit @40%" value={fmtMoney(kpis.projectedProfit)} sub="projected close" />
      </section>

      <section className="filters">
        <input
          className="input"
          placeholder="search title, site, region…"
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
          <option value="">all sites</option>
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
          <option value="6">≤ 6 hours</option>
          <option value="24">≤ 24 hours</option>
          <option value="72">≤ 3 days</option>
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
          {loading ? "…" : "apply"}
        </button>
      </section>

      <main className="layout">
        <section className="table-wrap">
          <table className="lots">
            <thead>
              <tr>
                <th>score</th>
                <th>lot</th>
                <th>site</th>
                <th>pallets</th>
                <th>retail</th>
                <th>current bid</th>
                <th>max hammer</th>
                <th>ROI</th>
                <th>cost/retail</th>
                <th>bids</th>
                <th>ends</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {listings.map((l) => (
                <tr key={l.listingId} className={selected?.listingId === l.listingId ? "row-selected" : ""} onClick={() => loadDetail(l)}>
                  <td><ScoreBadge score={l.score} /></td>
                  <td className="lot-cell">
                    <div className="lot-title">{l.title ?? l.listingId}</div>
                    <div className="lot-sub">{l.category} · {l.condition}</div>
                  </td>
                  <td><span className="site-chip">{l.site}</span></td>
                  <td className="num">{l.pallets ?? "—"}</td>
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
                      onClick={(e) => {
                        e.stopPropagation();
                        (l.watched ? api.unwatch(l.listingId) : api.watch(l.listingId)).then(refresh);
                      }}
                    >
                      {l.watched ? "★" : "☆"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {listings.length === 0 ? <div className="empty">no lots in view — run a sync</div> : null}
        </section>

        <aside className="detail">
          {!selected ? (
            <div className="detail-empty">select a lot to inspect economics, bid curve and execution</div>
          ) : (
            <DetailPanel listing={selected} detail={detail} onRefresh={refresh} settings={settings} />
          )}
        </aside>
      </main>

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

function DetailPanel({ listing, detail, onRefresh, settings }: { listing: ListingRow; detail: any; onRefresh: () => void; settings: any }) {
  const [amount, setAmount] = useState<number>(listing.maxHammer ?? listing.nextMinBid ?? 0);
  const [armed, setArmed] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [planToken, setPlanToken] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAmount(listing.maxHammer ?? listing.nextMinBid ?? 0);
    setPlanToken(null);
    setResult(null);
    setArmed(false);
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

  const e = detail?.economics;
  const projected = detail?.projected;
  const maxHammer = detail?.maxHammer ?? listing.maxHammer;

  return (
    <div className="detail-inner">
      <div className="detail-head">
        <div>
          <div className="detail-title">{listing.title}</div>
          <div className="detail-sub">{listing.site} · {listing.category} · {listing.condition} · {listing.pallets} pallets · {listing.units} units</div>
        </div>
        <ScoreBadge score={listing.score} />
      </div>

      <div className="detail-grid">
        <div className="metric"><span>retail value</span><b>{fmtMoney(listing.retail)}</b></div>
        <div className="metric"><span>current bid</span><b>{fmtMoney(listing.currentBid)}</b></div>
        <div className="metric"><span>next minimum</span><b>{fmtMoney(listing.nextMinBid)}</b></div>
        <div className="metric"><span>max hammer</span><b className="accent">{fmtMoney(maxHammer)}</b></div>
        <div className="metric"><span>projected close</span><b>{fmtMoney(projected?.projected ?? listing.projected)}</b></div>
        <div className="metric"><span>ROI now</span><b>{fmtPct(listing.roi)}</b></div>
        <div className="metric"><span>cost / retail</span><b>{fmtPct(listing.costToRetail)}</b></div>
        <div className="metric"><span>cost / pallet</span><b>{fmtMoney(listing.costPerPallet)}</b></div>
      </div>

      {detail?.bids?.length ? (
        <div className="chart-block">
          <div className="block-title">bid curve · {detail.bids.length} bids · {detail.velocity?.uniqueBidders} bidders</div>
          <BidCurve bids={detail.bids} />
        </div>
      ) : null}

      {listing.reasons?.length ? (
        <div className="block">
          <div className="block-title">why it ranks</div>
          <ul className="reasons">{listing.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      ) : null}
      {listing.risks?.length ? (
        <div className="block">
          <div className="block-title risk-title">risks</div>
          <ul className="risks">{listing.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      ) : null}

      <div className="ticket">
        <div className="block-title">bid ticket</div>
        <div className="ticket-row">
          <label>amount (USD)</label>
          <input type="number" className="input" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </div>
        <div className="ticket-row ticket-row-inline">
          <label className="toggle">
            <input type="checkbox" checked={armed} onChange={(e) => setArmed(e.target.checked)} />
            <span>armed (required for live)</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            <span>dry run</span>
          </label>
        </div>
        <div className="ticket-actions">
          <button className="btn btn-ghost" onClick={onPlan} disabled={busy}>plan bid</button>
          <button className="btn btn-primary" onClick={onExecute} disabled={busy || !planToken}>
            {dryRun ? "execute (dry)" : "execute (live)"}
          </button>
        </div>
        {planToken ? <div className="plan-ok">plan signed · expires in 10 min · max {fmtMoney(amount)}</div> : null}
        {result ? (
          <pre className="result">{JSON.stringify(result, null, 2)}</pre>
        ) : null}
      </div>

      <div className="ticket">
        <div className="block-title">decision overrides</div>
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
        <label>recovery %</label>
        <input type="number" step="0.01" className="input" value={recovery} onChange={(e) => setRecovery(Number(e.target.value))} />
      </div>
      <div className="ticket-row">
        <label>target ROI</label>
        <input type="number" step="0.01" className="input" value={targetRoi} onChange={(e) => setTargetRoi(Number(e.target.value))} />
      </div>
      <div className="ticket-row">
        <label>notes</label>
        <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <button className="btn btn-ghost" onClick={save} disabled={busy}>save overrides</button>
    </div>
  );
}

function BidCurve({ bids }: { bids: any[] }) {
  const sorted = [...bids].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const w = 320;
  const h = 120;
  const pad = 8;
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
    <svg viewBox={`0 0 ${w} ${h}`} className="chart">
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.winning ? 3.5 : 2} fill={p.winning ? "var(--good)" : "var(--accent)"} />
      ))}
      <text x={pad} y={12} className="chart-label">{fmtMoney(min, 0)}</text>
      <text x={pad} y={h - 2} className="chart-label">{fmtMoney(max, 0)}</text>
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
          <div className="block-title">trading settings</div>
          <button className="btn btn-ghost" onClick={onClose}>close</button>
        </div>
        <div className="modal-body">
          {field("perBidCap", "per-bid cap (USD)")}
          {field("dailyCap", "daily cap (USD)")}
          {field("minScore", "min score")}
          {field("minRoi", "min ROI (fraction)")}
          {field("recoveryPctDefault", "default recovery %")}
          {field("targetRoiDefault", "target ROI (fraction)")}
          {field("buyerPremiumPct", "buyer premium (fraction)")}
          {field("taxPct", "tax (fraction)")}
          {field("shippingDefault", "default shipping (USD)")}
          {field("otherFeesDefault", "other fees (USD)")}
          <div className="ticket-row">
            <label>mode</label>
            <select className="select" value={draft?.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })}>
              <option value="off">off</option>
              <option value="dry-run">dry-run</option>
              <option value="live">live</option>
            </select>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={Boolean(draft?.requireManifest)} onChange={(e) => setDraft({ ...draft, requireManifest: e.target.checked })} />
            <span>require manifest</span>
          </label>
          <div className="ticket-actions">
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "saving…" : "save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}