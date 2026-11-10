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

function ClockIcon({ size = 14 }: { size?: number } = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

function GemIcon({ size = 18, color }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4l3-3 3 3 3 3v6l-3 3-3 3-3-3-3-3V4z" />
      <path d="M12 1l1 3 3 3 3 3v6l-3 3-3 3-3-3-3-3-3-3z" />
    </svg>
  );
}

function PalletBoxIcon({ size = 18, color, style, className }: { size?: number; color?: string; style?: React.CSSProperties; className?: string }) {
  return (
    <svg width={size} height={size} style={style} className={className} viewBox="0 0 24 24" fill="none" stroke={color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function LightningIcon({ size = 18, color }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function ChartUpIcon({ size = 18, color }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v10a4 4 0 0 0 1.167 2.823L20 19l1.5-3.5L16 2l2.5 6.5L22 8z" />
    </svg>
  );
}

function DiceIcon({ size = 18, color }: { size?: number; color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="6" x2="9" y2="7" />
      <line x1="15" y1="13" x2="15" y2="14" />
    </svg>
  );
}

function AlertIcon({ size = 18, color }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 29v-1c0-1.1-.9-2-2-2h-1c-1.1 0-2-.9-2-2v-1c0-1.1.9-2 2-2h1c1.1 0 2 .9 2 2v1c0 1.1.9 2 2 2h1c1.1 0 2 .9 2 2v1c0 1.1-.9 2-2 2h-1c-1.1 0-2-.9-2-2v-1z" />
      <circle cx="12" cy="18" r="3" />
      <path d="M12 14v2M12 22v-2" />
    </svg>
  );
}

function SaveIcon({ size = 18, color }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function BulbIcon({ size = 18, color }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h18M3 12l1 10M13 11l1 10M3 12l1 10M13 11l1 10" />
      <path d="M9 21v-2a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2" />
      <path d="M12 17a5 5 0 0 0 5-5h0a5 5 0 0 0-5-5H7a5 5 0 0 0-5 5h0a5 5 0 0 0 5 5z" />
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

function DownloadIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ExternalLinkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function InspectIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function CheckCircleIcon({ size = 16, color = "#10b981" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CameraIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function RocketIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

function GlobeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function GitLabIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 5.5 2a.43.43 0 0 1 .4.28l2.45 7.54h7.3l2.45-7.54a.43.43 0 0 1 .4-.28.42.42 0 0 1 .39.22l2.44 7.51 1.22 3.78a.84.84 0 0 1-.3.88z" />
    </svg>
  );
}

function KeyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21 2-2 2m-1.5 1.5L14 9a5.5 5.5 0 1 0 4 4l3.5-3.5a1.5 1.5 0 0 0 0-2.12L20 6l-1.5 1.5" />
      <circle cx="7.5" cy="15.5" r="2.5" />
    </svg>
  );
}

function ShieldCheckIcon({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
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
  const map: Record<string, { cls: string; label: string; icon: React.ReactNode }> = {
    ALPHA_GEM: { cls: "tier-alpha", label: "Alpha Gem", icon: <GemIcon size={12} /> },
    SLEEPER_SNIPE: { cls: "tier-sleeper", label: "Sleeper Snipe", icon: <LightningIcon size={12} /> },
    SOLID_VALUE: { cls: "tier-solid", label: "Solid Value", icon: <ChartUpIcon size={12} /> },
    SPECULATIVE: { cls: "tier-speculative", label: "Speculative", icon: <DiceIcon size={12} /> },
    AVOID: { cls: "tier-avoid", label: "Avoid", icon: <AlertIcon size={12} /> },
  };
  const t = map[tier] ?? { cls: "tier-speculative", label: tier, icon: <span>•</span> };
  return (
    <span className={`tier-badge ${t.cls}`}>
      <span>{t.icon}</span> {t.label}
    </span>
  );
}

function Kpi({
  label,
  value,
  sub,
  onClick,
  active,
}: {
  label: string;
  value: string;
  sub?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <div
      className={`kpi ${onClick ? "interactive" : ""} ${active ? "active" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

function ExecutionReceipt({ result, amount, listing }: { result: any; amount: number; listing: ListingRow }) {
  const [copied, setCopied] = useState(false);
  const isError = Boolean(result.error);
  const isDryRun = result.status === "dry-run" || result.payload?.dryRun;
  const isLive = result.status === "placed";
  const isPlan = Boolean(result.plan);
  const token = result.plan?.planToken ?? result.payload?.planToken;

  const onCopy = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isError) {
    return (
      <div className="receipt-box receipt-error" role="alert">
        <div className="receipt-header">
          <AlertIcon size={16} color="var(--bad)" />
          <span className="receipt-status">EXECUTION REJECTED</span>
        </div>
        <div className="receipt-message">{result.error}</div>
      </div>
    );
  }

  return (
    <div className="receipt-box receipt-success" role="status">
      <div className="receipt-header">
        <CheckCircleIcon size={16} color="var(--good)" />
        <span className="receipt-status">
          {isPlan ? "PLAN SIGNED & AUTHORIZED" : isDryRun ? "DRY-RUN SIMULATION CONFIRMED" : "LIVE AUCTION BID EXECUTED"}
        </span>
        <span className="receipt-badge">{isPlan ? "10M TOKEN" : isDryRun ? "SIMULATED" : "CONFIRMED"}</span>
      </div>
      <div className="receipt-details">
        <div className="receipt-row">
          <span>Target Lot</span>
          <b>{listing.title ? (listing.title.length > 28 ? `${listing.title.slice(0, 28)}...` : listing.title) : listing.listingId}</b>
        </div>
        <div className="receipt-row">
          <span>Max Authorized Bid</span>
          <b className="accent">{fmtMoney(result.plan?.maxAmount ?? amount)}</b>
        </div>
        {token ? (
          <div className="receipt-row">
            <span>Cryptographic Token</span>
            <span
              className="receipt-token"
              onClick={() => onCopy(token)}
              title="Click to copy full token"
              style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px" }}
            >
              {token.slice(0, 20)}... <CopyIcon size={12} />
              {copied ? <span style={{ color: "var(--good)", fontSize: "12px" }}>copied!</span> : null}
            </span>
          </div>
        ) : null}
        <div className="receipt-row">
          <span>Executed At</span>
          <span>{new Date(result.timestamp ?? Date.now()).toLocaleTimeString()}</span>
        </div>
        {result.message ? <div className="receipt-note">{result.message}</div> : null}
      </div>
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
  const [credsModalOpen, setCredsModalOpen] = useState(false);

  // Mobile navigation tab state
  const [mobileTab, setMobileTab] = useState<"auctions" | "watchlist" | "detail" | "kpis">("auctions");
  const [watchedOnly, setWatchedOnly] = useState(false);
  const [solvingClearance, setSolvingClearance] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [selectedTier, setSelectedTier] = useState<string>("ALL");
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const [funnelData, setFunnelData] = useState<any>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightboxImg(null);
        setFilterModalOpen(false);
        setSettingsOpen(false);
        setStatusModalOpen(false);
        setCredsModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  // Filter listings by active view if in watchlist mode and selected tier
  const displayedListings = useMemo(() => {
    let list = Array.isArray(listings) ? listings : [];
    if (mobileTab === "watchlist" || watchedOnly) {
      list = list.filter((l) => l.watched);
    }
    if (selectedTier !== "ALL") {
      list = list.filter((l) => l.opportunityTier === selectedTier);
    }
    return list;
  }, [listings, mobileTab, watchedOnly, selectedTier]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filters.q) count++;
    if (filters.category) count++;
    if (filters.site) count++;
    if (Number(filters.minScore ?? 0) > 0) count++;
    if (Number(filters.minRoi ?? 0) > 0) count++;
    if (filters.endingWithinHours) count++;
    if (filters.sort !== "score") count++;
    if (watchedOnly) count++;
    return count;
  }, [filters, watchedOnly]);

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
    setWatchedOnly(false);
    setSelectedTier("ALL");
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
        <div className="status-cluster" onClick={() => setStatusModalOpen(true)} style={{ cursor: "pointer" }} title="Click to open Autonomous CI & Backend status">
          <span className={`pill pill-${status?.mode ?? "off"}`}>{status?.mode ? String(status.mode).toUpperCase() : "PRODUCTION"}</span>
          <span className="pill pill-ok" title="Autonomous CI Serverless Backend (GitHub Actions & GitLab CI)">
            <LightningIcon size={12} color="var(--good)" />
            <span>CI: Free Backend</span>
          </span>
          <span
            className={`pill ${status?.credentials?.hasClearance ? "pill-ok" : "pill-warn"}`}
            onClick={(e) => {
              e.stopPropagation();
              setCredsModalOpen(true);
            }}
            style={{ cursor: "pointer" }}
            title="Click to view or enter Cloudflare Token"
          >
            <KeyIcon size={12} />
            <span>{status?.credentials?.hasClearance ? "clearance OK" : "enter CF token"}</span>
          </span>
          <span
            className={`pill ${status?.credentials?.hasToken ? "pill-ok" : "pill-warn"}`}
            onClick={(e) => {
              e.stopPropagation();
              setCredsModalOpen(true);
            }}
            style={{ cursor: "pointer" }}
            title="Click to configure B-Stock Bearer token"
          >
            {status?.credentials?.hasToken ? "token OK" : "no token"}
          </span>
          <span className={`pill ${status?.storage?.initialized ? "pill-ok" : "pill-muted"}`} title={status?.storage?.storageBucket ?? "Storage"}>
            {status?.storage?.initialized ? "cloud OK" : "local cache"}
          </span>
          <span className="pill pill-muted">{status?.stats?.listings ?? listings.length} lots</span>
        </div>

        <div className="topbar-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setCredsModalOpen(true)}
            title="Configure Cloudflare clearance and API credentials"
          >
            <KeyIcon size={14} />
            <span>CF Token</span>
          </button>
          <button
            className="btn-scraper"
            onClick={onSolveClearance}
            disabled={solvingClearance}
            title="Solve Cloudflare Turnstile challenge with Scrapling"
          >
            <LightningIcon size={14} />
            <span>{solvingClearance ? "Solving Turnstile..." : "Solve Cloudflare"}</span>
          </button>
          <div className="view-mode-toggle">
            <button className={`view-mode-btn ${viewMode === "table" ? "active" : ""}`} onClick={() => setViewMode("table")}>
              Table
            </button>
            <button className={`view-mode-btn ${viewMode === "cards" ? "active" : ""}`} onClick={() => setViewMode("cards")}>
              <CameraIcon size={13} />
              <span>Pallets</span>
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
        <Kpi
          label="lots in view"
          value={String(kpis.count)}
          sub={`${status?.stats?.listings ?? listings.length} stored`}
          onClick={resetFilters}
          active={activeFiltersCount === 0 && !watchedOnly && selectedTier === "ALL"}
        />
        <Kpi
          label="avg score"
          value={kpis.avgScore.toFixed(1)}
          sub="0-100 composite index"
          onClick={() => setFilters((f) => ({ ...f, minScore: f.minScore === 75 ? 0 : 75 }))}
          active={filters.minScore === 75}
        />
        <Kpi
          label="ending soon"
          value={String(kpis.soon)}
          sub="closing under 6 hours"
          onClick={() => setFilters((f) => ({ ...f, endingWithinHours: f.endingWithinHours === 6 ? undefined : 6 }))}
          active={filters.endingWithinHours === 6}
        />
        <Kpi
          label="watched lots"
          value={String(kpis.watched)}
          sub="saved to review"
          onClick={() => setWatchedOnly((w) => !w)}
          active={watchedOnly || mobileTab === "watchlist"}
        />
        <Kpi
          label="projected profit"
          value={fmtMoney(kpis.projectedProfit)}
          sub="estimated at 40% recovery"
          onClick={() => setFilters((f) => ({ ...f, minRoi: f.minRoi === 0.3 ? 0 : 0.3 }))}
          active={filters.minRoi === 0.3}
        />
      </section>

      {/* Mobile Quick Chips */}
      <div className="quick-chips">
        <button
          className={`chip-btn ${mobileTab === "auctions" && !filters.endingWithinHours && !filters.minRoi && !watchedOnly ? "active" : ""}`}
          onClick={() => {
            setMobileTab("auctions");
            resetFilters();
          }}
        >
          All Lots ({listings.length})
        </button>
        <button
          className={`chip-btn ${mobileTab === "watchlist" || watchedOnly ? "active" : ""}`}
          onClick={() => {
            setMobileTab("watchlist");
            setWatchedOnly(true);
          }}
        >
          <StarIcon filled={mobileTab === "watchlist" || watchedOnly} />
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
        <button
          className={`btn ${watchedOnly ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setWatchedOnly((w) => !w)}
          title="Filter to watched lots"
        >
          <StarIcon filled={watchedOnly} />
          <span>Watched ({kpis.watched})</span>
        </button>
        <button
          className="btn-export"
          onClick={() => api.downloadCsv(displayedListings)}
          title="Export current view to CSV"
        >
          <DownloadIcon size={14} />
          <span>Export CSV</span>
        </button>
        {activeFiltersCount > 0 || watchedOnly || selectedTier !== "ALL" ? (
          <button className="btn btn-ghost" onClick={resetFilters} title="Reset all filters">
            reset
          </button>
        ) : null}
      </section>

      {/* Mathematical Funnel Pipeline Stepper */}
      <div className="funnel-pipeline-bar">
        <div className={`funnel-step ${selectedTier === "ALL" ? "active" : ""}`} onClick={() => setSelectedTier("ALL")}>
          <div className="funnel-step-icon">
            <PalletBoxIcon size={14} />
          </div>
          <div className="funnel-step-meta">
            <span className="funnel-step-name">Ingested Lots</span>
            <span className="funnel-step-count">{funnelData?.totalIngested ?? listings.length}</span>
          </div>
        </div>
        <span className="funnel-arrow">→</span>
        <div className={`funnel-step ${selectedTier === "SOLID_VALUE" ? "active" : ""}`} onClick={() => setSelectedTier("SOLID_VALUE")}>
          <div className="funnel-step-icon">
            <ChartUpIcon size={14} />
          </div>
          <div className="funnel-step-meta">
            <span className="funnel-step-name">Stage 1: Viable</span>
            <span className="funnel-step-count">{funnelData?.stage1Viable ?? listings.length}</span>
          </div>
        </div>
        <span className="funnel-arrow">→</span>
        <div className={`funnel-step ${selectedTier === "SLEEPER_SNIPE" ? "active" : ""}`} onClick={() => setSelectedTier("SLEEPER_SNIPE")}>
          <div className="funnel-step-icon">
            <LightningIcon size={14} />
          </div>
          <div className="funnel-step-meta">
            <span className="funnel-step-name">Stage 2: Pattern Filter</span>
            <span className="funnel-step-count">{funnelData?.stage2PatternApproved ?? listings.length}</span>
          </div>
        </div>
        <span className="funnel-arrow">→</span>
        <div className={`funnel-step ${selectedTier === "ALPHA_GEM" ? "active" : ""}`} onClick={() => setSelectedTier("ALPHA_GEM")}>
          <div className={`funnel-step-icon ${selectedTier === "ALPHA_GEM" ? "active" : ""}`}>
            <GemIcon size={14} />
          </div>
          <div className="funnel-step-meta">
            <span className="funnel-step-name">Stage 3: Alpha Gems</span>
            <span className="funnel-step-count" style={{ color: "#34d399" }}>{funnelData?.tierCounts?.ALPHA_GEM ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Main Layout */}
      <main className="layout">
        {/* Desktop View (Table or Card Grid) */}
        <section className="table-wrap">
          {viewMode === "table" ? (
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
                      <div className="lot-cell-content">
                        <div
                          className="lot-thumb-wrap"
                          onClick={(e) => {
                            if (l.imageUrl) {
                              e.stopPropagation();
                              setLightboxImg(l.imageUrl);
                            }
                          }}
                        >
                          {l.imageUrl ? (
                            <img src={l.imageUrl} alt="" className="lot-thumb" onError={(ev) => { (ev.target as HTMLElement).style.display = "none"; }} />
                          ) : (
                            <span className="lot-thumb-placeholder"><PalletBoxIcon /></span>
                          )}
                        </div>
                        <div>
                          <div className="lot-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span>{l.title ?? l.listingId}</span>
                            <TierBadge tier={l.opportunityTier} />
                          </div>
                          <div className="lot-sub">{l.category} · {l.condition}</div>
                        </div>
                      </div>
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
          ) : (
            <div className="card-grid">
              {displayedListings.map((l) => (
                <div
                  key={l.listingId}
                  className={`pallet-card ${selected?.listingId === l.listingId ? "selected" : ""}`}
                  onClick={() => loadDetail(l)}
                >
                  <div className="pallet-card-media">
                    {l.imageUrl ? (
                      <img
                        src={l.imageUrl}
                        alt={l.title ?? ""}
                        className="pallet-card-img"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLightboxImg(l.imageUrl);
                        }}
                        onError={(ev) => { (ev.target as HTMLElement).style.display = "none"; }}
                      />
                    ) : (
                      <PalletBoxIcon size={44} style={{ opacity: 0.4 }} />
                    )}
                    <div className="pallet-card-badge-row">
                      <ScoreBadge score={l.score} />
                      <TierBadge tier={l.opportunityTier} />
                    </div>
                  </div>
                  <div className="pallet-card-body">
                    <div className="pallet-card-title">{l.title ?? l.listingId}</div>
                    <div className="pallet-card-sub">{l.site} · {l.category} · {l.pallets ?? 1} pallet(s)</div>
                    <div className="pallet-card-grid">
                      <div className="pallet-card-stat">
                        <span>Current Bid</span>
                        <b>{fmtMoney(l.currentBid)}</b>
                      </div>
                      <div className="pallet-card-stat">
                        <span>Max Hammer</span>
                        <b className="accent">{fmtMoney(l.maxHammer)}</b>
                      </div>
                      <div className="pallet-card-stat">
                        <span>Retail</span>
                        <b>{fmtMoney(l.retail)}</b>
                      </div>
                      <div className="pallet-card-stat">
                        <span>Est. ROI</span>
                        <b className="accent">{fmtPct(l.roi)}</b>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
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
                <span className={`pill pill-${status?.mode ?? "off"}`}>Mode: {status?.mode ? String(status.mode).toUpperCase() : "PRODUCTION"}</span>
                <span
                  className={`pill ${status?.credentials?.hasClearance ? "pill-ok" : "pill-warn"}`}
                  onClick={() => setCredsModalOpen(true)}
                  style={{ cursor: "pointer" }}
                  title="Configure Cloudflare token"
                >
                  <KeyIcon size={12} />
                  <span>{status?.credentials?.hasClearance ? "Clearance Active ✓" : "Enter CF Token !"}</span>
                </span>
                <span
                  className={`pill ${status?.credentials?.hasToken ? "pill-ok" : "pill-warn"}`}
                  onClick={() => setCredsModalOpen(true)}
                  style={{ cursor: "pointer" }}
                  title="Configure B-Stock Bearer token"
                >
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
            <DetailPanel listing={selected} detail={detail} onRefresh={refresh} settings={settings} onOpenImage={(img) => setLightboxImg(img)} />
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
          <InspectIcon />
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
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={watchedOnly}
                    onChange={(e) => setWatchedOnly(e.target.checked)}
                  />
                  <span>Show Watched Lots Only ({kpis.watched})</span>
                </label>
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
          onOpenCreds={() => {
            setSettingsOpen(false);
            setCredsModalOpen(true);
          }}
          onSaved={(s) => {
            setSettings(s);
            setSettingsOpen(false);
            refresh();
          }}
        />
      ) : null}

      {/* Cloudflare & Credentials Modal */}
      {credsModalOpen ? (
        <CredentialsModal
          onClose={() => setCredsModalOpen(false)}
          onSaved={() => refresh()}
        />
      ) : null}

      {/* CI Automation & Serverless Backend Modal */}
      {statusModalOpen ? (
        <CiStatusModal
          status={status}
          onClose={() => setStatusModalOpen(false)}
          onTriggerSuccess={() => {
            setTimeout(refresh, 2500);
          }}
        />
      ) : null}

      {/* Image Lightbox Modal */}
      {lightboxImg ? (
        <div className="image-modal-overlay" onClick={() => setLightboxImg(null)}>
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="image-modal-close" onClick={() => setLightboxImg(null)} aria-label="Close image">
              <CloseIcon />
            </button>
            <img src={lightboxImg} alt="Pallet preview" className="image-modal-img" />
          </div>
        </div>
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
  const [manifestData, setManifestData] = useState<any>(null);
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);

  const loadManifest = async () => {
    setLoadingManifest(true);
    setManifestError(null);
    try {
      const res = await api.manifest(listing.listingId);
      setManifestData(res);
    } catch (err) {
      setManifestError((err as Error).message);
    } finally {
      setLoadingManifest(false);
    }
  };
  const [scrapeNotice, setScrapeNotice] = useState<string | null>(null);

  useEffect(() => {
    setAmount(listing.maxHammer ?? listing.nextMinBid ?? 0);
    setPlanToken(null);
    setResult(null);
    setArmed(false);
    setScrapeNotice(null);
    setManifestData(null);
    setManifestError(null);
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
          <div className="detail-title" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span>{listing.title ?? listing.listingId}</span>
            <a
              href={api.getAuctionUrl(listing)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
              title="Open auction on B-Stock Marketplace"
            >
              <span>B-Stock</span>
              <ExternalLinkIcon size={12} />
            </a>
          </div>
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
          <LightningIcon size={13} />
          <span>{scrapingPhotos ? "Scraping Photos..." : "Scrape Photos"}</span>
        </button>
        {listing.imageUrl ? (
          <button className="btn-scraper" onClick={cachePhoto} disabled={cachingImage}>
            <SaveIcon size={13} />
            <span>{cachingImage ? "Caching..." : "Cache Photos"}</span>
          </button>
        ) : null}
      </div>
      {scrapeNotice ? <div style={{ fontSize: "12px", color: "var(--accent-2)", marginBottom: "8px" }}>{scrapeNotice}</div> : null}

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
        <div className="block-title">Mathematical & Algebraic Funnel Model</div>
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

      {/* Manifest & Comps Secondary Market Valuation */}
      <div className="block">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <div className="block-title" style={{ margin: 0 }}>Manifest & Line-Item Comps</div>
          <button className="btn-scraper" onClick={loadManifest} disabled={loadingManifest} style={{ fontSize: "12px", padding: "4px 10px" }}>
            {loadingManifest ? "Analyzing Comps..." : manifestData ? "↻ Refresh Comps" : "Load Manifest & Comps"}
          </button>
        </div>

        {manifestError ? <div style={{ fontSize: "12px", color: "var(--risk-red)", marginBottom: "6px" }}>{manifestError}</div> : null}

        {manifestData ? (
          <div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px", flexWrap: "wrap" }}>
              <span className={`tier-badge tier-${manifestData.verdict}`}>
                {manifestData.verdict === "HIGH_CONFIDENCE_ALPHA" ? (
                  <><GemIcon size={12} /> HIGH CONFIDENCE ALPHA</>
                ) : manifestData.verdict === "SOLID_VALUE" ? (
                  <><ChartUpIcon size={12} /> SOLID VALUE</>
                ) : manifestData.verdict === "INFLATED_RETAIL_RISK" ? (
                  <><AlertIcon size={12} /> INFLATED RETAIL RISK</>
                ) : (
                  <><CheckCircleIcon size={12} color="currentColor" /> FAIR VALUE</>
                )}
              </span>
              <span style={{ fontSize: "12px", color: "var(--text-mute)" }}>
                {manifestData.totalUnits} units across {manifestData.itemCount} line items
              </span>
            </div>

            <div style={{ fontSize: "12px", color: "var(--fg)", marginBottom: "10px", lineHeight: 1.4 }}>
              {manifestData.verdictReason}
            </div>

            <div className="detail-grid" style={{ marginBottom: "10px" }}>
              <div className="metric"><span>Stated Retail</span><b>{fmtMoney(manifestData.totalStatedRetail)}</b></div>
              <div className="metric"><span>Estimated Resale</span><b className="accent">{fmtMoney(manifestData.totalEstimatedResale)}</b></div>
              <div className="metric"><span>Real Recovery</span><b className="accent">{(manifestData.effectiveRecoveryPct * 100).toFixed(1)}%</b></div>
              <div className="metric">
                <span>Recovery Alpha</span>
                <b style={{ color: manifestData.recoveryAlphaPct >= 0 ? "var(--accent)" : "var(--risk-red)" }}>
                  {manifestData.recoveryAlphaPct >= 0 ? `+${(manifestData.recoveryAlphaPct * 100).toFixed(1)}%` : `${(manifestData.recoveryAlphaPct * 100).toFixed(1)}%`}
                </b>
              </div>
            </div>

            {/* Brand Equity Tiers */}
            <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-mute)", marginBottom: "6px" }}>BRAND EQUITY DISTRIBUTION</div>
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
              <span className="brand-tier-1">
                Tier 1 Premium: {manifestData.brandTiers?.[1]?.unitSharePct ?? 0}%
              </span>
              <span className="brand-tier-2">
                Tier 2 Established: {manifestData.brandTiers?.[2]?.unitSharePct ?? 0}%
              </span>
              <span className="brand-tier-3">
                Tier 3 Mass: {manifestData.brandTiers?.[3]?.unitSharePct ?? 0}%
              </span>
              <span className="brand-tier-4">
                Tier 4 Unbranded: {manifestData.brandTiers?.[4]?.unitSharePct ?? 0}%
              </span>
            </div>

            {/* Top Brands Table */}
            {manifestData.topBrands?.length > 0 ? (
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-mute)", marginBottom: "6px" }}>TOP BRANDS BY VALUE</div>
                <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: "var(--text-mute)", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                      <th style={{ padding: "4px 6px" }}>Brand</th>
                      <th style={{ padding: "4px 6px" }}>Tier</th>
                      <th style={{ padding: "4px 6px" }}>Units</th>
                      <th style={{ padding: "4px 6px" }}>Retail</th>
                      <th style={{ padding: "4px 6px" }}>Est. Resale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manifestData.topBrands.map((b: any, idx: number) => (
                      <tr key={idx} style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.05)" }}>
                        <td style={{ padding: "4px 6px", fontWeight: 600 }}>{b.brand}</td>
                        <td style={{ padding: "4px 6px" }}>T{b.tier}</td>
                        <td style={{ padding: "4px 6px" }}>{b.units}</td>
                        <td style={{ padding: "4px 6px" }}>{fmtMoney(b.extRetail)}</td>
                        <td style={{ padding: "4px 6px", color: "var(--accent)" }}>{fmtMoney(b.estimatedResale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {/* Sample Line Items Table */}
            {manifestData.sampleItems?.length > 0 ? (
              <div>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-mute)", marginBottom: "6px" }}>ITEMIZED MANIFEST SAMPLE ({manifestData.sampleItems.length})</div>
                <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
                  <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "rgba(255, 255, 255, 0.03)", color: "var(--text-mute)", textAlign: "left", position: "sticky", top: 0 }}>
                        <th style={{ padding: "4px 6px" }}>Item / ASIN</th>
                        <th style={{ padding: "4px 6px" }}>Cond</th>
                        <th style={{ padding: "4px 6px" }}>Qty</th>
                        <th style={{ padding: "4px 6px" }}>Unit Retail</th>
                        <th style={{ padding: "4px 6px" }}>Est. Comp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manifestData.sampleItems.map((it: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.04)" }}>
                          <td style={{ padding: "4px 6px", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {it.asin ? <span style={{ color: "var(--accent-2)", marginRight: "4px" }}>[{it.asin}]</span> : null}
                            {it.title}
                          </td>
                          <td style={{ padding: "4px 6px" }}>{it.condition}</td>
                          <td style={{ padding: "4px 6px" }}>{it.quantity}</td>
                          <td style={{ padding: "4px 6px" }}>{fmtMoney(it.unitRetail)}</td>
                          <td style={{ padding: "4px 6px", color: "var(--accent)" }}>{fmtMoney(it.estimatedUnitResale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ fontSize: "12px", color: "var(--text-mute)", padding: "8px 0" }}>
            Click "Load Manifest & Comps" to fetch item-level brand classifications, secondary market valuations, and line-item ASIN details.
          </div>
        )}
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
          <ExecutionReceipt result={result} amount={amount} listing={listing} />
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

function SettingsModal({ settings, onClose, onSaved, onOpenCreds }: { settings: any; onClose: () => void; onSaved: (s: any) => void; onOpenCreds?: () => void }) {
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
          {onOpenCreds ? (
            <div className="ticket" style={{ marginTop: "14px", background: "var(--bg-2)" }}>
              <div className="block-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <KeyIcon size={14} />
                <span>Cloudflare & API Access</span>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-mute)", margin: "0 0 10px" }}>
                Live auction crawling and guarded bidding require an active Cloudflare clearance token.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onOpenCreds}
              >
                <KeyIcon size={13} />
                <span>Manage CF Token & Credentials</span>
              </button>
            </div>
          ) : null}
          <div className="ticket-actions" style={{ marginTop: "14px" }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save Configuration"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CredentialsModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (creds: any) => void;
}) {
  const [creds, setCreds] = useState<any>(() => api.getCredentialsSync());
  const [solving, setSolving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      await api.saveCredentials(creds);
      setFeedback("success:Cloudflare token & credentials saved to active session!");
      onSaved(creds);
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      setFeedback(`error:${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const onSolve = async () => {
    setSolving(true);
    setFeedback(null);
    try {
      const res = await api.solveClearance();
      if (res.success && res.clearance) {
        const updated = {
          ...creds,
          clearance: res.clearance,
          userAgent: res.userAgent || creds.userAgent || navigator.userAgent,
        };
        setCreds(updated);
        await api.saveCredentials(updated);
        setFeedback("success:Turnstile challenge solved! Valid cf_clearance captured and active.");
        onSaved(updated);
      } else {
        setFeedback(`error:${res.error || "Auto-solve unavailable on static host. Please paste cf_clearance below."}`);
      }
    } catch (err: any) {
      setFeedback(`error:${err.message}`);
    } finally {
      setSolving(false);
    }
  };

  const onReset = async () => {
    await api.clearCredentials();
    const defaults = api.getCredentialsSync();
    setCreds(defaults);
    setFeedback("success:Reset to default verified production clearance.");
    onSaved(defaults);
  };

  const tokenActive = Boolean(creds?.clearance && creds.clearance.trim().length > 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: "680px" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <KeyIcon size={18} />
            <span className="block-title">Cloudflare & Marketplace Credentials</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close modal">
            <CloseIcon />
          </button>
        </div>
        <div className="modal-body">
          {/* Active status indicator badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              background: tokenActive ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
              border: `1px solid ${tokenActive ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
              marginBottom: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {tokenActive ? <ShieldCheckIcon size={18} color="var(--good)" /> : <AlertIcon size={18} color="var(--bad)" />}
              <div>
                <div style={{ fontWeight: 700, fontSize: "13px", color: tokenActive ? "var(--good)" : "var(--bad)" }}>
                  {tokenActive ? "Cloudflare Clearance Active (Production Ready)" : "No Cloudflare Clearance Configured"}
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-mute)" }}>
                  {tokenActive
                    ? `Active token length: ${creds.clearance.length} characters • Valid for bstock.com API requests`
                    : "Live B-Stock search, bid and auction endpoints require a valid Cloudflare clearance token."}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onSolve}
              disabled={solving}
              title="Auto-solve Turnstile challenge"
            >
              <LightningIcon size={13} />
              <span>{solving ? "Solving..." : "Auto-Solve"}</span>
            </button>
          </div>

          <div className="ticket" style={{ marginBottom: "16px" }}>
            <div className="block-title">Cloudflare cf_clearance Token</div>
            <p style={{ fontSize: "12px", color: "var(--text-mute)", margin: "0 0 10px" }}>
              Paste your <code style={{ color: "var(--accent)" }}>cf_clearance</code> cookie value from any browser session that visited bstock.com:
            </p>
            <textarea
              className="input"
              rows={3}
              style={{ fontFamily: "monospace", fontSize: "12px", resize: "vertical" }}
              placeholder="Paste cf_clearance cookie value here (e.g. CoZSSEyX...)"
              value={creds?.clearance || ""}
              onChange={(e) => setCreds({ ...creds, clearance: e.target.value.trim() })}
            />
          </div>

          <div className="ticket" style={{ marginBottom: "16px" }}>
            <div className="block-title">Matching Browser User-Agent</div>
            <p style={{ fontSize: "12px", color: "var(--text-mute)", margin: "0 0 10px" }}>
              Cloudflare validates that requests match the User-Agent that passed the challenge:
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                className="input"
                style={{ fontFamily: "monospace", fontSize: "12px", flex: 1 }}
                value={creds?.userAgent || ""}
                onChange={(e) => setCreds({ ...creds, userAgent: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setCreds({ ...creds, userAgent: navigator.userAgent })}
                title="Detect and use this browser's User-Agent"
              >
                Use My UA
              </button>
            </div>
          </div>

          <div className="ticket" style={{ marginBottom: "16px" }}>
            <div className="block-title">B-Stock Account Bearer Token (Optional)</div>
            <p style={{ fontSize: "12px", color: "var(--text-mute)", margin: "0 0 10px" }}>
              Optional FusionAuth JWT for placing live guarded bids on bstock.com:
            </p>
            <input
              type="password"
              className="input"
              placeholder="eyJhbGciOi... (optional for read-only tracking)"
              value={creds?.accessToken || ""}
              onChange={(e) => setCreds({ ...creds, accessToken: e.target.value.trim() })}
            />
          </div>

          {/* Helper Instructions Box */}
          <div style={{ background: "var(--bg-3)", border: "1px solid var(--line)", borderRadius: "var(--radius-md)", padding: "12px", fontSize: "12px", marginBottom: "16px" }}>
            <div style={{ fontWeight: 600, color: "var(--text-bright)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
              <BulbIcon size={14} />
              <span>How to copy your cf_clearance token in 15 seconds:</span>
            </div>
            <ol style={{ margin: 0, paddingLeft: "18px", color: "var(--text-dim)", lineHeight: "1.6" }}>
              <li>Open <strong>bstock.com</strong> in your browser and pass the Turnstile check.</li>
              <li>Press <strong>F12</strong> (Developer Tools) &rarr; <strong>Application</strong> (or Storage) &rarr; <strong>Cookies</strong> &rarr; <strong>https://bstock.com</strong>.</li>
              <li>Double click the <strong>cf_clearance</strong> value, copy it, and paste it into the field above.</li>
            </ol>
          </div>

          {feedback ? (
            <div
              style={{
                marginBottom: "14px",
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                background: feedback.startsWith("error:") ? "rgba(239, 68, 68, 0.15)" : "rgba(16, 185, 129, 0.15)",
                border: `1px solid ${feedback.startsWith("error:") ? "rgba(239, 68, 68, 0.3)" : "rgba(16, 185, 129, 0.3)"}`,
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                color: feedback.startsWith("error:") ? "var(--bad)" : "var(--good)",
              }}
            >
              {feedback.startsWith("error:") ? <AlertIcon size={16} color="var(--bad)" /> : <CheckCircleIcon size={16} color="var(--good)" />}
              <span>{feedback.replace(/^(error:|success:)/, "")}</span>
            </div>
          ) : null}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              <SaveIcon size={14} />
              <span>{saving ? "Saving..." : "Save & Apply Credentials"}</span>
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onReset}>
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CiStatusModal({ status, onClose, onTriggerSuccess }: { status: any; onClose: () => void; onTriggerSuccess: () => void }) {
  const [ciSettings, setCiSettings] = useState<any>(() => api.ciSettings());
  const [triggeringGh, setTriggeringGh] = useState(false);
  const [triggeringGl, setTriggeringGl] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const saveSettings = () => {
    api.saveCiSettings(ciSettings);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const onTriggerGithub = async (mode: "mock" | "live") => {
    setTriggeringGh(true);
    setFeedback(null);
    try {
      const res = await api.triggerGithubCrawl({ mode, pages: "5" });
      setFeedback(res.message);
      onTriggerSuccess();
    } catch (err) {
      setFeedback(`error: ${(err as Error).message}`);
    } finally {
      setTriggeringGh(false);
    }
  };

  const onTriggerGitlab = async () => {
    setTriggeringGl(true);
    setFeedback(null);
    try {
      const res = await api.triggerGitlabCrawl();
      setFeedback(`GitLab pipeline #${res.pipeline?.id ?? "active"} initiated successfully!`);
      onTriggerSuccess();
    } catch (err) {
      setFeedback(`error: ${(err as Error).message}`);
    } finally {
      setTriggeringGl(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: "680px" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <LightningIcon size={18} color="var(--accent-2)" />
            <span className="block-title">Autonomous CI Serverless Backend</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close modal">
            <CloseIcon />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ background: "rgba(0, 229, 255, 0.05)", border: "1px solid rgba(0, 229, 255, 0.2)", borderRadius: "var(--radius-md)", padding: "12px", marginBottom: "16px", fontSize: "12px", lineHeight: "1.5" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, color: "var(--accent-2)", marginBottom: "4px" }}>
              <BulbIcon size={16} />
              <span>Zero-Cost Serverless Execution Architecture</span>
            </div>
            <p style={{ margin: 0, color: "var(--text-dim)" }}>
              The backend runs 100% free using <strong>GitHub Actions</strong> and <strong>GitLab CI</strong> scheduled cron workers, committing state snapshots directly into Git (Git-as-a-database) and replicating to Firebase Cloud Firestore. No paid VMs, no 24/7 host servers.
            </p>
          </div>

          <div className="ticket" style={{ marginBottom: "14px" }}>
            <div className="block-title">Current Snapshot State</div>
            <div className="ticket-row">
              <label>Engine Mode</label>
              <span className="pill pill-ok">{status?.mode || "static"}</span>
            </div>
            <div className="ticket-row">
              <label>Snapshot Generated</label>
              <span>{status?.generatedAt ? new Date(status.generatedAt).toLocaleString() : "Live Memory"}</span>
            </div>
            {status?.tierCounts ? (
              <div className="ticket-row">
                <label>Opportunity Tiers</label>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <span className="pill pill-ok"><GemIcon size={12} /> {status.tierCounts.ALPHA_GEM} Gems</span>
                  <span className="pill pill-info"><ChartUpIcon size={12} /> {status.tierCounts.SOLID_VALUE} Solid</span>
                  <span className="pill pill-warn"><ClockIcon size={12} /> {status.tierCounts.SLEEPER_SNIPE} Sleepers</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="ticket" style={{ marginBottom: "14px" }}>
            <div className="block-title">Trigger Autonomous Run</div>
            <p style={{ fontSize: "12px", color: "var(--text-mute)", margin: "0 0 10px" }}>
              Dispatch an immediate serverless crawl job to GitHub Actions or GitLab CI runners.
            </p>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                className="btn btn-primary"
                onClick={() => onTriggerGithub("mock")}
                disabled={triggeringGh || !ciSettings?.githubToken}
                title={!ciSettings?.githubToken ? "Configure GitHub PAT below" : "Trigger GitHub Actions run"}
              >
                <RocketIcon size={14} />
                <span>{triggeringGh ? "Dispatching..." : "Run GitHub Actions (Mock)"}</span>
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => onTriggerGithub("live")}
                disabled={triggeringGh || !ciSettings?.githubToken}
                title={!ciSettings?.githubToken ? "Configure GitHub PAT below" : "Trigger Live GitHub Actions crawl"}
              >
                <GlobeIcon size={14} />
                <span>Run GitHub (Live)</span>
              </button>
              <button
                className="btn btn-ghost"
                onClick={onTriggerGitlab}
                disabled={triggeringGl || !ciSettings?.gitlabToken}
                title={!ciSettings?.gitlabToken ? "Configure GitLab Trigger Token below" : "Trigger GitLab CI pipeline"}
              >
                <GitLabIcon size={14} />
                <span>Run GitLab Pipeline</span>
              </button>
            </div>
            {feedback ? (
              <div style={{ marginTop: "10px", padding: "8px 12px", borderRadius: "var(--radius-sm)", background: "var(--bg-3)", border: "1px solid var(--line)", fontSize: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
                {feedback.startsWith("error:") ? <AlertIcon size={16} color="var(--bad)" /> : <CheckCircleIcon size={16} color="var(--good)" />}
                <span>{feedback.replace(/^error:\s*/, "")}</span>
              </div>
            ) : null}
          </div>

          <div className="ticket">
            <div className="block-title">Operator Tokens (Stored in Browser LocalStorage)</div>
            <div className="ticket-row">
              <label>GitHub Personal Access Token (PAT)</label>
              <input
                type="password"
                className="input"
                placeholder="ghp_... (needs repo workflow permissions)"
                value={ciSettings?.githubToken || ""}
                onChange={(e) => setCiSettings({ ...ciSettings, githubToken: e.target.value })}
              />
            </div>
            <div className="ticket-row">
              <label>GitHub Repository</label>
              <input
                type="text"
                className="input"
                placeholder="owner/repo"
                value={ciSettings?.githubRepo || "Bzcasper/bstock-command"}
                onChange={(e) => setCiSettings({ ...ciSettings, githubRepo: e.target.value })}
              />
            </div>
            <div className="ticket-row">
              <label>GitLab Trigger Token</label>
              <input
                type="password"
                className="input"
                placeholder="glptt-... (Settings > CI/CD > Pipeline triggers)"
                value={ciSettings?.gitlabToken || ""}
                onChange={(e) => setCiSettings({ ...ciSettings, gitlabToken: e.target.value })}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" }}>
              <button className="btn btn-primary" onClick={saveSettings}>
                {savedNotice ? "Saved to Browser!" : "Save Tokens"}
              </button>
              <div style={{ display: "flex", gap: "10px", fontSize: "12px", alignItems: "center" }}>
                <a
                  href={`https://github.com/${ciSettings?.githubRepo || "Bzcasper/bstock-command"}/actions`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: "4px" }}
                >
                  <span>View GitHub Actions</span>
                  <ExternalLinkIcon size={12} />
                </a>
                <a
                  href="https://gitlab.com/tinydigitalproductlab/bstock-command/-/pipelines"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: "4px" }}
                >
                  <span>View GitLab Pipelines</span>
                  <ExternalLinkIcon size={12} />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
