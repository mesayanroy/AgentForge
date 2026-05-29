'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import CandlestickChart, { CloseEvent } from '@/components/CandlestickChart';
import type { Agent } from '@/types';
import PageHero from '@/components/PageHero';

interface OHLC {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Order {
  id: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  amount: number;
  price: number;
  status: 'open' | 'filled' | 'cancelled';
  timestamp: string;
  agent?: string;
  pair: string;
}

interface Position {
  side: 'long' | 'short';
  entryPrice: number;
  size: number;
  collateral: number;
  leverage: number;
  unrealisedPnl: number;
  realisedPnl?: number;
  liquidationPrice: number;
  tp: number | null;
  sl: number | null;
  pair: string;
  openedAt: string;
}

interface TokenInfo {
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

const TOKEN_PAIRS = [
  { id: 'xlm', symbol: 'XLM/USDC', name: 'Stellar Lumens', coinGeckoId: 'stellar', icon: '⭐' },
  { id: 'btc', symbol: 'BTC/USDC', name: 'Bitcoin', coinGeckoId: 'bitcoin', icon: '₿' },
  { id: 'eth', symbol: 'ETH/USDC', name: 'Ethereum', coinGeckoId: 'ethereum', icon: 'Ξ' },
  { id: 'sol', symbol: 'SOL/USDC', name: 'Solana', coinGeckoId: 'solana', icon: '◎' },
  { id: 'bnb', symbol: 'BNB/USDC', name: 'BNB', coinGeckoId: 'binancecoin', icon: '●' },
  { id: 'xrp', symbol: 'XRP/USDC', name: 'XRP', coinGeckoId: 'ripple', icon: '✕' },
  { id: 'usdt', symbol: 'USDT/USDC', name: 'Tether', coinGeckoId: 'tether', icon: '₮' },
  { id: 'usdc', symbol: 'USDC/XLM', name: 'USD Coin', coinGeckoId: 'usd-coin', icon: '$' },
] as const;

const FALLBACK_PRICES: Record<string, number> = {
  stellar: 0.1242,
  bitcoin: 67500,
  ethereum: 3800,
  solana: 185,
  binancecoin: 420,
  ripple: 0.55,
  tether: 1.0,
  'usd-coin': 1.0,
};

const AGENT_TEMPLATES = [
  { id: 'breakout-bot', name: 'Breakout Bot', description: 'Detects price breakouts above/below Bollinger Bands and enters with tight TP/SL.', priceXlm: 0.05, tags: ['breakout', 'automated', 'xlm'], category: 'strategy' },
  { id: 'mean-reversion', name: 'Mean Reversion', description: 'Fades extreme moves back toward the 20-period moving average on XLM/USDC.', priceXlm: 0.03, tags: ['reversion', 'xlm', 'dca'], category: 'strategy' },
  { id: 'trend-follower', name: 'Trend Follower', description: 'Rides established trends using EMA crossovers and trailing stop-loss on Stellar.', priceXlm: 0.07, tags: ['trend', 'ema', 'automated'], category: 'strategy' },
  { id: 'arbitrage-sentinel', name: 'Arbitrage Sentinel', description: 'Monitors XLM price across Stellar DEX pools for arb opportunities in real time.', priceXlm: 0.1, tags: ['arb', 'dex', 'defi'], category: 'arbitrage' },
  { id: 'mev-scanner', name: 'MEV Scanner', description: 'Scans Stellar DEX order books for MEV opportunities including front-running and sandwich trade detection.', priceXlm: 0.15, tags: ['mev', 'dex', 'advanced'], category: 'mev' },
  { id: 'mempool-monitor', name: 'Mempool Monitor', description: 'Watches Stellar transaction mempool for large pending orders and alerts before settlement.', priceXlm: 0.08, tags: ['mempool', 'alerts', 'real-time'], category: 'monitor' },
  { id: 'liquidity-slippage', name: 'Liquidity & Slippage Tracker', description: 'Tracks pool depth and estimated slippage across Stellar DEX AMM pools. Alerts when slippage exceeds your threshold.', priceXlm: 0.06, tags: ['liquidity', 'slippage', 'amm'], category: 'monitor' },
  { id: 'multi-token-arb', name: 'Multi-Token Arbitrage', description: 'Cross-chain arbitrage scanner covering XLM, BTC, ETH, SOL price discrepancies across DEX and CEX venues.', priceXlm: 0.2, tags: ['arb', 'multi-chain', 'advanced'], category: 'arbitrage' },
];

const CATEGORY_COLORS: Record<string, string> = {
  strategy: 'text-[#00FFE5] border-[rgba(0,255,229,0.3)] bg-[rgba(0,255,229,0.08)]',
  arbitrage: 'text-[#FFB800] border-[rgba(255,184,0,0.3)] bg-[rgba(255,184,0,0.08)]',
  mev: 'text-purple-400 border-purple-900 bg-purple-900/10',
  monitor: 'text-blue-400 border-blue-900 bg-blue-900/10',
};

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return n.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
}

function generateHistory(basePrice: number, candles = 60): OHLC[] {
  let price = basePrice;
  const now = Date.now();
  const volatility = basePrice > 1000 ? 0.005 : basePrice > 1 ? 0.008 : 0.015;
  return Array.from({ length: candles }, (_, i) => {
    const jitter = (Math.random() - 0.48) * basePrice * volatility;
    const open = price;
    const close = Math.max(basePrice * 0.1, price + jitter);
    const high = Math.max(open, close) + Math.random() * basePrice * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * basePrice * volatility * 0.5;
    const volume = 20000 + Math.random() * 80000;
    price = close;
    return { ts: new Date(now - (candles - 1 - i) * 60_000).toISOString(), open, high, low, close, volume };
  });
}

export default function TradingPage() {
  const [selectedPairId, setSelectedPairId] = useState('xlm');
  const [network, setNetwork] = useState<'testnet' | 'mainnet'>('testnet');
  const [tokenPrices, setTokenPrices] = useState<Record<string, TokenInfo>>({});
  const [pricesLoading, setPricesLoading] = useState(true);
  const [pricesError, setPricesError] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [candles, setCandles] = useState<OHLC[]>([]);
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [orderAmount, setOrderAmount] = useState('100');
  const [limitPrice, setLimitPrice] = useState('');
  const [tpPrice, setTpPrice] = useState('');
  const [slPrice, setSlPrice] = useState('');
  const [leverage, setLeverage] = useState(1);
  const [collateral, setCollateral] = useState('50');
  const [orders, setOrders] = useState<Order[]>([]);
  const [position, setPosition] = useState<Position | null>(null);
  const [closedPnl, setClosedPnl] = useState<{ pnl: number; pair: string; ts: string } | null>(null);
  const [closeEvent, setCloseEvent] = useState<CloseEvent | null>(null);
  const [activeTab, setActiveTab] = useState<'chart' | 'agents'>('chart');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [agentCategory, setAgentCategory] = useState('all');
  const [agentSubTab, setAgentSubTab] = useState<'templates' | 'mine' | 'arb-demo'>('templates');
  const [myDeployedAgents, setMyDeployedAgents] = useState<Agent[]>([]);
  const [loadingMyAgents, setLoadingMyAgents] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  // Arbitrage demo state
  const [arbRunning, setArbRunning] = useState(false);
  const [arbStep, setArbStep] = useState(0);
  const [arbPrices, setArbPrices] = useState({ binance: 0, coinbase: 0 });
  const [arbResult, setArbResult] = useState<{ profit: number; pair: string } | null>(null);
  const [sigModalOpen, setSigModalOpen] = useState(false);
  const [pendingArbTrade, setPendingArbTrade] = useState<{ buyEx: string; sellEx: string; spread: number; spreadPct: number } | null>(null);

  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const priceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const positionRef = useRef<Position | null>(null);

  // Keep positionRef in sync so PnL effect always reads fresh position
  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  const selectedPair = TOKEN_PAIRS.find((p) => p.id === selectedPairId) ?? TOKEN_PAIRS[0];
  const currentTokenInfo = tokenPrices[selectedPair.coinGeckoId];
  const currentPrice = currentTokenInfo?.price ?? FALLBACK_PRICES[selectedPair.coinGeckoId] ?? 0;
  const priceChange24h = currentTokenInfo?.change24h ?? 0;
  const isUp = priceChange24h >= 0;

  const fetchPrices = useCallback(async () => {
    const ids = TOKEN_PAIRS.map((p) => p.coinGeckoId).join(',');
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_high_24h=true&include_low_24h=true`
      );
      if (!res.ok) throw new Error('rate limited');
      const data = await res.json() as Record<string, Record<string, number>>;
      const updated: Record<string, TokenInfo> = {};
      for (const pair of TOKEN_PAIRS) {
        const d = data[pair.coinGeckoId];
        if (d) {
          updated[pair.coinGeckoId] = {
            price: d.usd ?? FALLBACK_PRICES[pair.coinGeckoId] ?? 0,
            change24h: d.usd_24h_change ?? 0,
            high24h: d.usd_24h_high ?? 0,
            low24h: d.usd_24h_low ?? 0,
            volume24h: d.usd_24h_vol ?? 0,
          };
        }
      }
      setTokenPrices(updated);
      setLastUpdate(new Date().toLocaleTimeString([], { hour12: false }));
      setPricesError(false);
    } catch {
      setPricesError(true);
      if (Object.keys(tokenPrices).length === 0) {
        const fallback: Record<string, TokenInfo> = {};
        for (const pair of TOKEN_PAIRS) {
          fallback[pair.coinGeckoId] = { price: FALLBACK_PRICES[pair.coinGeckoId] ?? 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0 };
        }
        setTokenPrices(fallback);
      }
    } finally {
      setPricesLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void fetchPrices();
    priceIntervalRef.current = setInterval(() => void fetchPrices(), 60_000);
    return () => { if (priceIntervalRef.current) clearInterval(priceIntervalRef.current); };
  }, [fetchPrices]);

  // Seed candles when pair changes (use FALLBACK_PRICES directly to avoid stale closure on currentPrice)
  useEffect(() => {
    const base = FALLBACK_PRICES[selectedPair.coinGeckoId] || 1;
    setCandles(generateHistory(base, 60));
    setPosition(null);
    setCloseEvent(null);
  }, [selectedPairId, selectedPair.coinGeckoId]);

  // Live price tick simulation — restart whenever candles are seeded or pair changes
  useEffect(() => {
    if (tickerRef.current) clearInterval(tickerRef.current);
    if (!candles.length) return;
    tickerRef.current = setInterval(() => {
      setCandles((prev) => {
        if (!prev.length) return prev;
        const last = prev[prev.length - 1];
        const bp = last.close;
        const vol = bp > 1000 ? 0.0008 : bp > 1 ? 0.001 : 0.003;
        const delta = (Math.random() - 0.49) * bp * vol;
        const next = Math.max(bp * 0.01, last.close + delta);
        const updated: OHLC = { ...last, close: next, high: Math.max(last.high, next), low: Math.min(last.low, next), volume: last.volume + Math.random() * 500 };
        return [...prev.slice(0, -1), updated];
      });
    }, 2000);
    return () => { if (tickerRef.current) clearInterval(tickerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles.length, selectedPairId]);

  // Load wallet balance and user's deployed agents
  useEffect(() => {
    const addr = localStorage.getItem('wallet_address');
    if (!addr) return;
    setWalletAddress(addr);
    const load = async () => {
      try {
        const { getXlmBalance } = await import('@/lib/stellar');
        const bal = await getXlmBalance(addr);
        setWalletBalance(bal);
      } catch { /* ignore */ }
    };
    void load();

    // Fetch user's own deployed agents
    setLoadingMyAgents(true);
    fetch(`/api/agents/list?owner=${encodeURIComponent(addr)}`)
      .then((r) => r.ok ? r.json() : { agents: [] })
      .then((d: { agents?: Agent[] }) => setMyDeployedAgents(d.agents ?? []))
      .catch(() => setMyDeployedAgents([]))
      .finally(() => setLoadingMyAgents(false));
  }, []);

  // Persist closed trade to localStorage so dashboard can sync immediately
  const persistClosedTrade = useCallback((pnl: number, pair: string, closeType: 'tp' | 'sl' | 'manual', closePx: number) => {
    try {
      const existing: Array<{ pnl: number; pair: string; ts: string; type: string; closePrice: number }> =
        JSON.parse(localStorage.getItem('trading_pnl_history') ?? '[]');
      existing.unshift({ pnl, pair, ts: new Date().toISOString(), type: closeType, closePrice: closePx });
      localStorage.setItem('trading_pnl_history', JSON.stringify(existing.slice(0, 50)));
      // Dispatch custom event so dashboard (same tab) can update without polling delay
      window.dispatchEvent(new CustomEvent('trading_pnl_update', { detail: { pnl, pair, type: closeType } }));
    } catch { /* ignore */ }
  }, []);

  const recentHigh = candles.length ? Math.max(...candles.slice(-20).map((c) => c.high)) : 0;
  const recentLow = candles.length ? Math.min(...candles.slice(-20).map((c) => c.low)) : 0;
  const chartData = candles.slice(-40).map((c) => ({ ts: c.ts, price: c.close, high: c.high, low: c.low, volume: c.volume }));

  // Real-time PnL: update unrealisedPnl whenever the live candle price changes.
  // Use positionRef to always read the latest position without causing an infinite
  // re-render loop (adding `position` to deps would trigger the effect on every PnL
  // update, which in turn re-renders causing another candle-change cycle).
  useEffect(() => {
    const pos = positionRef.current;
    if (!pos) return;
    const livePrice = candles[candles.length - 1]?.close;
    if (!livePrice) return;
    const priceDiff = pos.side === 'long'
      ? livePrice - pos.entryPrice
      : pos.entryPrice - livePrice;
    const pnl = priceDiff * pos.size * pos.leverage;

    // Check TP / SL triggers
    if (pos.tp && pos.side === 'long' && livePrice >= pos.tp) {
      const tpPnl = (pos.tp - pos.entryPrice) * pos.size * pos.leverage;
      setClosedPnl({ pnl: tpPnl, pair: pos.pair, ts: new Date().toISOString() });
      setCloseEvent({ price: pos.tp, type: 'tp', pnl: tpPnl });
      setOrderSuccess(`🎯 Take Profit hit! PnL: +$${fmtPrice(tpPnl)} · ${pos.pair.toUpperCase()}`);
      persistClosedTrade(tpPnl, pos.pair, 'tp', pos.tp);
      setPosition(null);
      return;
    }
    if (pos.tp && pos.side === 'short' && livePrice <= pos.tp) {
      const tpPnl = (pos.entryPrice - pos.tp) * pos.size * pos.leverage;
      setClosedPnl({ pnl: tpPnl, pair: pos.pair, ts: new Date().toISOString() });
      setCloseEvent({ price: pos.tp, type: 'tp', pnl: tpPnl });
      setOrderSuccess(`🎯 Take Profit hit! PnL: +$${fmtPrice(tpPnl)} · ${pos.pair.toUpperCase()}`);
      persistClosedTrade(tpPnl, pos.pair, 'tp', pos.tp);
      setPosition(null);
      return;
    }
    if (pos.sl && pos.side === 'long' && livePrice <= pos.sl) {
      const slPnl = (pos.sl - pos.entryPrice) * pos.size * pos.leverage;
      setClosedPnl({ pnl: slPnl, pair: pos.pair, ts: new Date().toISOString() });
      setCloseEvent({ price: pos.sl, type: 'sl', pnl: slPnl });
      setOrderSuccess(`🛑 Stop Loss triggered. PnL: ${slPnl >= 0 ? '+' : ''}$${fmtPrice(slPnl)} · ${pos.pair.toUpperCase()}`);
      persistClosedTrade(slPnl, pos.pair, 'sl', pos.sl);
      setPosition(null);
      return;
    }
    if (pos.sl && pos.side === 'short' && livePrice >= pos.sl) {
      const slPnl = (pos.entryPrice - pos.sl) * pos.size * pos.leverage;
      setClosedPnl({ pnl: slPnl, pair: pos.pair, ts: new Date().toISOString() });
      setCloseEvent({ price: pos.sl, type: 'sl', pnl: slPnl });
      setOrderSuccess(`🛑 Stop Loss triggered. PnL: ${slPnl >= 0 ? '+' : ''}$${fmtPrice(slPnl)} · ${pos.pair.toUpperCase()}`);
      persistClosedTrade(slPnl, pos.pair, 'sl', pos.sl);
      setPosition(null);
      return;
    }

    setPosition((prev) => prev ? { ...prev, unrealisedPnl: pnl } : null);
  }, [candles, persistClosedTrade]);

  const submitOrder = useCallback(() => {
    setOrderError(null); setOrderSuccess(null);
    const amt = parseFloat(orderAmount);
    const col = parseFloat(collateral);
    if (!amt || amt <= 0) { setOrderError('Enter a valid amount.'); return; }
    if (!col || col <= 0) { setOrderError('Enter valid collateral.'); return; }
    if (orderType === 'limit' && (!limitPrice || parseFloat(limitPrice) <= 0)) { setOrderError('Enter a valid limit price.'); return; }
    const livePrice = candles[candles.length - 1]?.close ?? currentPrice;
    const price = orderType === 'market' ? livePrice : parseFloat(limitPrice);
    const tp = tpPrice ? parseFloat(tpPrice) : null;
    const sl = slPrice ? parseFloat(slPrice) : null;
    const newOrder: Order = { id: Math.random().toString(36).slice(2, 10).toUpperCase(), side: orderSide, type: orderType, amount: amt, price, status: orderType === 'market' ? 'filled' : 'open', timestamp: new Date().toISOString(), agent: selectedAgent || undefined, pair: selectedPair.symbol };
    setOrders((prev) => [newOrder, ...prev.slice(0, 19)]);
    if (orderType === 'market') {
      const liqOffset = col / (amt * leverage) * (orderSide === 'buy' ? -1 : 1);
      setPosition({ side: orderSide === 'buy' ? 'long' : 'short', entryPrice: price, size: amt, collateral: col, leverage, unrealisedPnl: 0, liquidationPrice: price + liqOffset, tp, sl, pair: selectedPairId, openedAt: new Date().toISOString() });
      setOrderSuccess(`Market ${orderSide.toUpperCase()} filled @ $${fmtPrice(price)} · ${selectedPair.symbol}`);
    } else {
      setOrderSuccess(`Limit order placed @ $${fmtPrice(price)} · ${selectedPair.symbol}`);
    }
  }, [orderAmount, orderSide, orderType, limitPrice, tpPrice, slPrice, leverage, collateral, candles, currentPrice, selectedAgent, selectedPair, selectedPairId]);

  const closePosition = () => {
    if (!position) return;
    const pnl = position.unrealisedPnl;
    const livePrice = candles[candles.length - 1]?.close ?? position.entryPrice;
    setClosedPnl({ pnl, pair: position.pair, ts: new Date().toISOString() });
    setCloseEvent({ price: livePrice, type: 'manual', pnl });
    setOrderSuccess(`Position closed. PnL: ${pnl >= 0 ? '+' : ''}$${fmtPrice(pnl)} · ${position.pair.toUpperCase()}`);
    persistClosedTrade(pnl, position.pair, 'manual', livePrice);
    setPosition(null);
  };

  const filteredAgents = agentCategory === 'all' ? AGENT_TEMPLATES : AGENT_TEMPLATES.filter((a) => a.category === agentCategory);

  return (
    <div className="page-theme min-h-screen">
      <PageHero
        eyebrow="Trading"
        title={<>Trade and test strategies inside a professional execution workspace.</>}
        description={<>Track live markets, simulate positions, and run agent templates within a polished Stellar-native trading interface.</>}
        actions={[
          { href: '/build', label: 'Build a Strategy' },
          { href: '/dashboard', label: 'Go to Dashboard', variant: 'secondary' },
        ]}
      />

      <div className="page-shell max-w-[1440px] space-y-4">

        {/* Token Pair Selector */}
        <div className="page-panel p-4 flex flex-wrap gap-2 overflow-x-auto pb-1">
          {TOKEN_PAIRS.map((pair) => {
            const tp = tokenPrices[pair.coinGeckoId];
            const change = tp?.change24h ?? 0;
            return (
              <button key={pair.id} onClick={() => setSelectedPairId(pair.id)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono transition-all ${selectedPairId === pair.id ? 'border-[#00FFE5] bg-[rgba(0,255,229,0.08)] text-white' : 'border-white/10 text-gray-400 hover:border-white/30'}`}>
                <span>{pair.icon}</span>
                <span>{pair.symbol}</span>
                {tp && <span className={change >= 0 ? 'text-[#4ade80]' : 'text-red-400'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</span>}
              </button>
            );
          })}
          {pricesError ? (
            <span className="text-[10px] font-mono text-yellow-600 self-center">⚠ Using fallback prices</span>
          ) : lastUpdate ? (
            <span className="text-[10px] font-mono text-gray-600 self-center">Updated {lastUpdate}</span>
          ) : null}
        </div>

        {/* Header */}
        <div className="page-panel p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="font-syne text-2xl font-bold text-white">{selectedPair.icon} {selectedPair.symbol}</h1>
              <div className="font-mono text-xs text-gray-500">{selectedPair.name} · Stellar {network === 'testnet' ? 'Testnet' : 'Mainnet'}</div>
            </div>
            <div>
              <div className={`font-mono text-3xl font-bold ${pricesLoading ? 'text-gray-600 animate-pulse' : 'text-white'}`}>${fmtPrice(currentPrice)}</div>
              <div className={`font-mono text-sm ${isUp ? 'text-[#4ade80]' : 'text-red-400'}`}>{isUp ? '▲' : '▼'} {Math.abs(priceChange24h).toFixed(2)}% (24h)</div>
            </div>
            <div className="hidden md:flex gap-6 font-mono text-xs text-gray-500 border-l border-white/10 pl-4">
              <div><div className="text-gray-600">24h High</div><div className="text-white">${fmtPrice(currentTokenInfo?.high24h ?? recentHigh)}</div></div>
              <div><div className="text-gray-600">24h Low</div><div className="text-white">${fmtPrice(currentTokenInfo?.low24h ?? recentLow)}</div></div>
              <div><div className="text-gray-600">24h Vol</div><div className="text-[#00FFE5]">{currentTokenInfo?.volume24h ? '$' + (currentTokenInfo.volume24h / 1e9).toFixed(2) + 'B' : '—'}</div></div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {walletAddress && (
              <div className="font-mono text-xs text-gray-500 border border-white/10 rounded-lg px-3 py-1.5">
                XLM: <span className="text-[#FFB800]">{walletBalance ? parseFloat(walletBalance).toFixed(2) : '...'}</span>
              </div>
            )}
            {(['testnet', 'mainnet'] as const).map((n) => (
              <button key={n} onClick={() => setNetwork(n)}
                className={`px-4 py-1.5 text-xs font-mono rounded-full border transition-all ${network === n ? (n === 'mainnet' ? 'border-[#4ade80] text-[#4ade80] bg-[rgba(74,222,128,0.1)]' : 'border-[#00FFE5] text-[#00FFE5] bg-[rgba(0,255,229,0.08)]') : 'border-white/10 text-gray-500 hover:text-gray-300'}`}>
                {n === 'mainnet' ? '🟢 Mainnet' : '🔵 Testnet'}
              </button>
            ))}
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-2 border-b border-white/[0.06] pb-0">
          {(['chart', 'agents'] as const).map((t) => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-4 py-2 text-xs font-mono border-b-2 transition-all -mb-px ${activeTab === t ? 'border-[#00FFE5] text-[#00FFE5]' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
              {t === 'chart' ? '📈 Live Chart' : '🤖 Agent SDK Templates'}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'chart' && (
            <motion.div key="chart" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
              <div className="space-y-4">
                {/* Closed PnL banner */}
                <AnimatePresence>
                  {closedPnl && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className={`p-4 rounded-xl border font-mono text-sm flex items-center justify-between ${closedPnl.pnl >= 0 ? 'border-green-800 bg-[rgba(74,222,128,0.08)] text-[#4ade80]' : 'border-red-900 bg-red-900/10 text-red-400'}`}>
                      <span>{closedPnl.pnl >= 0 ? '🟢 Profit' : '🔴 Loss'} on {closedPnl.pair.toUpperCase()} — {closedPnl.pnl >= 0 ? '+' : ''}${fmtPrice(closedPnl.pnl)}</span>
                      <button onClick={() => setClosedPnl(null)} className="text-xs opacity-60 hover:opacity-100 ml-4">✕</button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Candlestick Price Chart */}
                <div className="page-panel p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#00FFE5] animate-pulse" />
                      <span className="font-mono text-xs text-white/70">Live · 1m candles · {selectedPair.symbol}</span>
                      <span className="font-mono text-[9px] text-white/30">🟢 bullish  🔴 bearish</span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-[10px] text-white/40">
                      <span className="text-[#FF6B6B]">— RES {fmtPrice(recentHigh)}</span>
                      <span className="text-[#4ade80]">— SUP {fmtPrice(recentLow)}</span>
                    </div>
                  </div>
                  <CandlestickChart
                    candles={candles}
                    height={288}
                    supportLevel={recentLow}
                    resistanceLevel={recentHigh}
                    tpLevel={position?.tp ?? null}
                    slLevel={position?.sl ?? null}
                    liqLevel={position?.liquidationPrice ?? null}
                    entryLevel={position?.entryPrice ?? null}
                    closeEvent={closeEvent}
                  />
                </div>

                {/* Volume Bar */}
                <div className="rounded-2xl border border-white/[0.07] bg-[rgba(5,5,12,0.85)] p-4">
                  <span className="font-mono text-[10px] text-gray-600 block mb-2">Volume</span>
                  <div className="h-20">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 0, right: 5, bottom: 0, left: 0 }}>
                        <Bar dataKey="volume" fill="rgba(0,255,229,0.25)" radius={[2, 2, 0, 0]} />
                        <XAxis dataKey="ts" hide />
                        <YAxis hide />
                        <Tooltip contentStyle={{ background: '#0a0a14', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff' }}
                          formatter={(v: unknown) => [Number(v).toLocaleString(), 'Volume']} labelFormatter={() => ''} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Open Position */}
                {position ? (
                  <div className="rounded-2xl border border-[rgba(0,255,229,0.18)] bg-[rgba(0,255,229,0.03)] p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-syne text-sm font-bold text-white">Open Position · {position.pair.toUpperCase()}</h3>
                      <button onClick={closePosition} className="px-3 py-1 text-xs font-mono border border-red-700 text-red-400 rounded hover:bg-red-900/30 transition-all">Close Position</button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
                      {[
                        { label: 'Side', value: position.side.toUpperCase(), color: position.side === 'long' ? 'text-[#4ade80]' : 'text-red-400' },
                        { label: 'Entry', value: `$${fmtPrice(position.entryPrice)}`, color: 'text-white' },
                        { label: 'Size', value: String(position.size), color: 'text-white' },
                        { label: 'Leverage', value: `${position.leverage}×`, color: 'text-[#FFB800]' },
                        { label: 'Collateral', value: `${position.collateral} XLM`, color: 'text-white' },
                        { label: 'Unrealised PnL', value: `${position.unrealisedPnl >= 0 ? '+' : ''}$${fmtPrice(position.unrealisedPnl)}`, color: position.unrealisedPnl >= 0 ? 'text-[#4ade80]' : 'text-red-400' },
                        { label: 'TP', value: position.tp ? `$${fmtPrice(position.tp)}` : '—', color: 'text-[#FFB800]' },
                        { label: 'SL', value: position.sl ? `$${fmtPrice(position.sl)}` : '—', color: 'text-red-400' },
                      ].map((s) => (
                        <div key={s.label} className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.04]">
                          <div className="text-gray-500 mb-1">{s.label}</div>
                          <div className={s.color}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4 text-center font-mono text-xs text-white/30">No open position · Place a market order to open</div>
                )}

                {/* Order History */}
                <div className="rounded-2xl border border-white/[0.07] bg-[rgba(5,5,12,0.85)] p-5">
                  <h3 className="font-syne text-sm font-bold text-white mb-3">Order History</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[600px] font-mono text-xs">
                      <thead>
                        <tr className="border-b border-white/[0.06] text-left text-gray-600">
                          {['ID', 'Pair', 'Side', 'Type', 'Amount', 'Price', 'Status', 'Time'].map((h) => <th key={h} className="py-1.5 pr-3">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {orders.length === 0 ? (
                          <tr><td colSpan={8} className="py-4 text-center text-white/30">No orders yet</td></tr>
                        ) : orders.map((o) => (
                          <tr key={o.id} className="border-b border-white/[0.03]">
                            <td className="py-1.5 pr-3 text-white/60">{o.id}</td>
                            <td className="py-1.5 pr-3 text-[#00FFE5]">{o.pair}</td>
                            <td className={`py-1.5 pr-3 ${o.side === 'buy' ? 'text-[#4ade80]' : 'text-red-400'}`}>{o.side.toUpperCase()}</td>
                            <td className="py-1.5 pr-3 text-white/60">{o.type}</td>
                            <td className="py-1.5 pr-3 text-white">{o.amount}</td>
                            <td className="py-1.5 pr-3 text-[#FFB800]">${fmtPrice(o.price)}</td>
                            <td className="py-1.5 pr-3">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] border ${o.status === 'filled' ? 'bg-[rgba(74,222,128,0.1)] border-green-800 text-[#4ade80]' : o.status === 'open' ? 'bg-[rgba(0,255,229,0.08)] border-[rgba(0,255,229,0.3)] text-[#00FFE5]' : 'bg-red-900/20 border-red-900 text-red-400'}`}>{o.status}</span>
                            </td>
                            <td className="py-1.5 text-white/40">{new Date(o.timestamp).toLocaleTimeString([], { hour12: false })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Right: Order Panel */}
              <div className="space-y-4">
                <div className="rounded-2xl border border-[rgba(0,255,229,0.12)] bg-[rgba(0,255,229,0.03)] p-4">
                  <div className="font-mono text-[10px] text-gray-500 mb-1">{selectedPair.name} · Live</div>
                  <div className={`font-syne text-2xl font-bold text-[#00FFE5] ${pricesLoading ? 'animate-pulse' : ''}`}>${fmtPrice(currentPrice)}</div>
                  <div className={`font-mono text-xs mt-1 ${isUp ? 'text-[#4ade80]' : 'text-red-400'}`}>{isUp ? '▲' : '▼'} {Math.abs(priceChange24h).toFixed(2)}% 24h</div>
                  {walletBalance && <div className="font-mono text-[10px] text-gray-500 mt-2 border-t border-white/[0.06] pt-2">Wallet: <span className="text-[#FFB800]">{parseFloat(walletBalance).toFixed(2)} XLM</span></div>}
                </div>

                <div className="rounded-2xl border border-white/[0.07] bg-[rgba(5,5,12,0.85)] p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-white/[0.04]">
                    <button onClick={() => setOrderSide('buy')} className={`py-2 text-xs font-mono rounded-md font-bold transition-all ${orderSide === 'buy' ? 'bg-[#4ade80] text-black' : 'text-gray-500 hover:text-gray-300'}`}>Buy / Long</button>
                    <button onClick={() => setOrderSide('sell')} className={`py-2 text-xs font-mono rounded-md font-bold transition-all ${orderSide === 'sell' ? 'bg-red-500 text-white' : 'text-gray-500 hover:text-gray-300'}`}>Sell / Short</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(['market', 'limit'] as const).map((t) => (
                      <button key={t} onClick={() => setOrderType(t)} className={`py-1.5 text-xs font-mono rounded border transition-all ${orderType === t ? 'border-[#00FFE5] text-[#00FFE5] bg-[rgba(0,255,229,0.08)]' : 'border-white/10 text-gray-500'}`}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
                    ))}
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-gray-500 mb-1">Amount</label>
                    <input value={orderAmount} onChange={(e) => setOrderAmount(e.target.value)} type="number" min="1" className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-white text-sm font-mono focus:outline-none focus:border-[rgba(0,255,229,0.4)]" />
                  </div>
                  {orderType === 'limit' && (
                    <div>
                      <label className="block text-[10px] font-mono text-gray-500 mb-1">Limit Price ($)</label>
                      <input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} type="number" placeholder={fmtPrice(currentPrice)} className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-white text-sm font-mono focus:outline-none focus:border-[rgba(0,255,229,0.4)]" />
                    </div>
                  )}
                  <div>
                    <label className="block text-[10px] font-mono text-gray-500 mb-1">Collateral (XLM)</label>
                    <input value={collateral} onChange={(e) => setCollateral(e.target.value)} type="number" min="1" className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-white text-sm font-mono focus:outline-none focus:border-[rgba(0,255,229,0.4)]" />
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] font-mono text-gray-500 mb-1"><span>Leverage</span><span className="text-[#FFB800]">{leverage}×</span></div>
                    <input type="range" min={1} max={10} value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} className="w-full accent-[#FFB800]" />
                    <div className="flex justify-between text-[9px] font-mono text-gray-600 mt-0.5"><span>1×</span><span>5×</span><span>10×</span></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-mono text-[#FFB800] mb-1">Take Profit ($)</label>
                      <input value={tpPrice} onChange={(e) => setTpPrice(e.target.value)} type="number" placeholder="0.00" className="w-full px-2 py-1.5 bg-white/[0.03] border border-[rgba(255,184,0,0.2)] rounded text-white text-xs font-mono focus:outline-none focus:border-[rgba(255,184,0,0.5)]" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono text-red-400 mb-1">Stop Loss ($)</label>
                      <input value={slPrice} onChange={(e) => setSlPrice(e.target.value)} type="number" placeholder="0.00" className="w-full px-2 py-1.5 bg-white/[0.03] border border-red-900/40 rounded text-white text-xs font-mono focus:outline-none focus:border-red-600" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-gray-500 mb-1">Run via Agent (optional)</label>
                    <select value={selectedAgent || ''} onChange={(e) => setSelectedAgent(e.target.value || null)} className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-white text-xs font-mono focus:outline-none focus:border-[rgba(0,255,229,0.4)]">
                      <option value="">Manual (no agent)</option>
                      {AGENT_TEMPLATES.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    {selectedAgent && <div className="mt-1.5 font-mono text-[9px] text-gray-500">+{AGENT_TEMPLATES.find((a) => a.id === selectedAgent)?.priceXlm} XLM agent fee · 0x402</div>}
                  </div>
                  <AnimatePresence>
                    {orderError && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-2.5 rounded bg-red-900/20 border border-red-900 text-red-400 text-xs font-mono">{orderError}</motion.div>}
                    {orderSuccess && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-2.5 rounded bg-[rgba(74,222,128,0.08)] border border-green-800 text-[#4ade80] text-xs font-mono">✓ {orderSuccess}</motion.div>}
                  </AnimatePresence>
                  <button onClick={submitOrder} className={`w-full py-3 font-mono text-sm rounded-lg font-bold transition-all ${orderSide === 'buy' ? 'bg-[#4ade80] text-black hover:bg-[#22c55e]' : 'bg-red-500 text-white hover:bg-red-600'}`}>
                    {orderSide === 'buy' ? '▲ Buy / Long' : '▼ Sell / Short'} {leverage > 1 ? `(${leverage}×)` : ''}
                  </button>
                  <div className="font-mono text-[9px] text-gray-600 text-center">{network === 'testnet' ? '⚠ Testnet — no real funds' : '🌐 Mainnet — real XLM'} · Stellar Horizon</div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'agents' && (
            <motion.div key="agents" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
              {/* Agent sub-tabs */}
              <div className="flex gap-1 border-b border-white/[0.06] pb-0">
                {([
                  { id: 'templates', label: '📦 Agent Templates' },
                  { id: 'mine', label: '🚀 My Deployed Agents' },
                  { id: 'arb-demo', label: '⚡ Arbitrage Demo' },
                ] as const).map((st) => (
                  <button key={st.id} onClick={() => setAgentSubTab(st.id)}
                    className={`px-4 py-2 text-xs font-mono border-b-2 transition-all -mb-px ${agentSubTab === st.id ? 'border-[#00FFE5] text-[#00FFE5]' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
                    {st.label}
                  </button>
                ))}
              </div>

              {/* Templates sub-tab */}
              {agentSubTab === 'templates' && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="font-mono text-sm text-gray-400 flex-1">Select an agent template to automate your trading strategy. Each call is metered via the 0x402 protocol.</p>
                    <div className="flex gap-2 flex-wrap">
                      {['all', 'strategy', 'arbitrage', 'mev', 'monitor'].map((cat) => (
                        <button key={cat} onClick={() => setAgentCategory(cat)} className={`px-3 py-1 text-[10px] font-mono rounded-full border transition-all ${agentCategory === cat ? 'border-[#00FFE5] text-[#00FFE5] bg-[rgba(0,255,229,0.08)]' : 'border-white/10 text-gray-500 hover:text-gray-300'}`}>
                          {cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {filteredAgents.map((agent) => (
                      <motion.div key={agent.id} whileHover={{ y: -4, boxShadow: '0 0 24px rgba(0,255,229,0.08)' }}
                        className="rounded-xl border border-[rgba(0,255,229,0.12)] bg-[rgba(255,255,255,0.03)] p-5 flex flex-col gap-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-syne font-bold text-white text-sm">{agent.name}</h3>
                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${CATEGORY_COLORS[agent.category] ?? ''}`}>{agent.category}</span>
                          </div>
                          <p className="text-gray-400 text-xs mt-1">{agent.description}</p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {agent.tags.map((t) => <span key={t} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[rgba(0,255,229,0.06)] text-[#00FFE5] border border-[rgba(0,255,229,0.15)]">#{t}</span>)}
                        </div>
                        <div className="flex items-center justify-between mt-auto">
                          <span className="font-mono text-xs text-[#FFB800]">{agent.priceXlm} XLM/req</span>
                          <button onClick={() => { setSelectedAgent(agent.id); setActiveTab('chart'); }} className="px-3 py-1 text-xs font-mono border border-[#00FFE5] text-[#00FFE5] rounded hover:bg-[#00FFE5] hover:text-black transition-all">Use</button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                  <div className="rounded-2xl border border-white/[0.07] bg-[rgba(5,5,12,0.85)] p-5">
                    <h3 className="font-syne text-sm font-bold text-white mb-3">SDK Quick-Start (0x402)</h3>
                    <pre className="font-mono text-xs text-[#00FFE5] overflow-x-auto whitespace-pre-wrap leading-relaxed">{`// npm install @stellar/stellar-sdk ably
const agentId = '${selectedAgent ?? AGENT_TEMPLATES[0].id}';
const res = await fetch(\`https://agentforge.dev/api/agents/\${agentId}/run\`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ input: 'Analyse ${selectedPair.symbol} breakout' }),
});
if (res.status === 402) {
  const { payment_details } = await res.json();
  const txHash = await signAndSubmitXLM(payment_details);
  const paid = await fetch(\`https://agentforge.dev/api/agents/\${agentId}/run\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Payment-Tx-Hash': txHash, 'X-Payment-Wallet': myWallet },
    body: JSON.stringify({ input: 'Analyse ${selectedPair.symbol} breakout' }),
  });
  console.log((await paid.json()).output);
}`}</pre>
                  </div>
                </div>
              )}

              {/* My Deployed Agents sub-tab */}
              {agentSubTab === 'mine' && (
                <div className="space-y-4">
                  <p className="font-mono text-sm text-gray-400">
                    These are agents you have deployed on AgentForge. Select one to trade with it on the mainnet — every trade order will be routed through your agent endpoint.
                  </p>
                  {!walletAddress ? (
                    <div className="rounded-xl border border-white/[0.06] p-8 text-center font-mono text-xs text-white/30">
                      Connect your wallet to see your deployed agents.
                    </div>
                  ) : loadingMyAgents ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 animate-pulse h-32" />
                      ))}
                    </div>
                  ) : myDeployedAgents.length === 0 ? (
                    <div className="rounded-xl border border-white/[0.06] p-8 text-center font-mono text-xs text-white/30">
                      No deployed agents found. Deploy one from the Agents page to get started.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {myDeployedAgents.map((agent) => (
                        <motion.div key={agent.id} whileHover={{ y: -3, boxShadow: '0 0 20px rgba(0,255,229,0.07)' }}
                          className={`rounded-xl border p-5 flex flex-col gap-3 cursor-pointer transition-all ${selectedAgent === agent.id ? 'border-[#00FFE5] bg-[rgba(0,255,229,0.06)]' : 'border-white/[0.08] bg-[rgba(255,255,255,0.02)]'}`}
                          onClick={() => { setSelectedAgent(agent.id); setActiveTab('chart'); }}>
                          <div className="flex items-center justify-between">
                            <h3 className="font-syne font-bold text-white text-sm">{agent.name}</h3>
                            <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full border ${network === 'mainnet' ? 'border-green-700 text-green-400 bg-green-900/20' : 'border-blue-700 text-blue-300 bg-blue-900/20'}`}>
                              {network === 'mainnet' ? '🌐 Mainnet' : '🔵 Testnet'}
                            </span>
                          </div>
                          <p className="text-gray-400 text-xs flex-1">{agent.description ?? 'Custom deployed agent'}</p>
                          <div className="flex items-center justify-between mt-auto">
                            <span className="font-mono text-[10px] text-gray-500">{agent.id.slice(0, 12)}…</span>
                            <span className="text-[10px] font-mono text-[#00FFE5]">
                              {selectedAgent === agent.id ? '✓ Selected' : 'Click to select'}
                            </span>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Arbitrage Demo sub-tab */}
              {agentSubTab === 'arb-demo' && (
                <div className="space-y-6">
                  <div className="rounded-2xl border border-[rgba(255,184,0,0.2)] bg-[rgba(255,184,0,0.04)] p-5">
                    <h3 className="font-syne text-sm font-bold text-[#FFB800] mb-1">⚡ Arbitrage Agent — Live Demo</h3>
                    <p className="font-mono text-xs text-gray-400 mb-4">
                      Watch how the <strong className="text-white">Arbitrage Sentinel</strong> scans two exchanges, detects a price spread, asks for your wallet signature, and executes the cross-exchange trade — all in real time.
                    </p>

                    {/* Step indicators */}
                    <div className="flex items-center gap-2 mb-5 flex-wrap">
                      {['Scan exchanges', 'Detect spread', 'Review trade', 'Sign & execute', 'Result'].map((label, idx) => (
                        <div key={idx} className="flex items-center gap-1">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold font-mono transition-all ${arbStep > idx ? 'bg-[#4ade80] text-black' : arbStep === idx ? 'bg-[#FFB800] text-black animate-pulse' : 'bg-white/[0.05] text-gray-600'}`}>
                            {arbStep > idx ? '✓' : idx + 1}
                          </div>
                          <span className={`text-[9px] font-mono hidden sm:inline ${arbStep >= idx ? 'text-white/70' : 'text-gray-600'}`}>{label}</span>
                          {idx < 4 && <span className="text-gray-700 text-[9px]">›</span>}
                        </div>
                      ))}
                    </div>

                    {/* Step 0: Start */}
                    {arbStep === 0 && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          {[{ name: 'Binance', logo: '🟡' }, { name: 'Coinbase', logo: '🔵' }].map((ex) => (
                            <div key={ex.name} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 font-mono text-xs">
                              <div className="text-gray-500 mb-1">{ex.logo} {ex.name}</div>
                              <div className="text-gray-600 text-[10px]">Price: scanning…</div>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => {
                            setArbRunning(true);
                            setArbStep(1);
                            const bin = currentPrice * (1 + (Math.random() - 0.5) * 0.004);
                            const coin = currentPrice * (1 + (Math.random() - 0.5) * 0.004);
                            setArbPrices({ binance: bin, coinbase: coin });
                            setTimeout(() => {
                              setArbStep(2);
                              const spread = Math.abs(bin - coin);
                              const spreadPct = (spread / Math.min(bin, coin)) * 100;
                              const buyEx = bin < coin ? 'Binance' : 'Coinbase';
                              const sellEx = bin < coin ? 'Coinbase' : 'Binance';
                              setPendingArbTrade({ buyEx, sellEx, spread, spreadPct });
                            }, 1800);
                          }}
                          disabled={arbRunning}
                          className="w-full py-2.5 font-mono text-xs font-bold rounded-lg bg-[#FFB800] text-black hover:bg-yellow-400 transition-all disabled:opacity-50">
                          🔍 Start — Scan {selectedPair.symbol} Prices
                        </button>
                      </div>
                    )}

                    {/* Step 1: Scanning */}
                    {arbStep === 1 && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          {[{ name: 'Binance', logo: '🟡', price: arbPrices.binance }, { name: 'Coinbase', logo: '🔵', price: arbPrices.coinbase }].map((ex) => (
                            <div key={ex.name} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 font-mono text-xs animate-pulse">
                              <div className="text-gray-500 mb-1">{ex.logo} {ex.name}</div>
                              <div className="text-[#00FFE5]">Fetching… ⏳</div>
                            </div>
                          ))}
                        </div>
                        <div className="text-center font-mono text-xs text-gray-500">Agent is scanning live order books…</div>
                      </div>
                    )}

                    {/* Step 2: Spread detected */}
                    {arbStep === 2 && pendingArbTrade && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          {[{ name: 'Binance', logo: '🟡', price: arbPrices.binance }, { name: 'Coinbase', logo: '🔵', price: arbPrices.coinbase }].map((ex) => (
                            <div key={ex.name} className={`rounded-lg border p-3 font-mono text-xs transition-all ${ex.name === pendingArbTrade.buyEx ? 'border-green-700 bg-green-900/10' : 'border-red-900 bg-red-900/10'}`}>
                              <div className="text-gray-400 mb-1">{ex.logo} {ex.name}</div>
                              <div className="text-white text-sm font-bold">${fmtPrice(ex.price)}</div>
                              <div className={`text-[9px] mt-0.5 ${ex.name === pendingArbTrade.buyEx ? 'text-[#4ade80]' : 'text-red-400'}`}>
                                {ex.name === pendingArbTrade.buyEx ? '← BUY HERE' : '→ SELL HERE'}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="rounded-lg border border-[rgba(255,184,0,0.3)] bg-[rgba(255,184,0,0.07)] p-3 font-mono text-xs">
                          <div className="text-[#FFB800] font-bold mb-1">📊 Spread Detected</div>
                          <div className="grid grid-cols-2 gap-2 text-gray-300">
                            <div>Buy on: <span className="text-white">{pendingArbTrade.buyEx}</span></div>
                            <div>Sell on: <span className="text-white">{pendingArbTrade.sellEx}</span></div>
                            <div>Spread: <span className="text-[#FFB800]">${fmtPrice(pendingArbTrade.spread)}</span></div>
                            <div>Spread %: <span className="text-[#4ade80]">{pendingArbTrade.spreadPct.toFixed(3)}%</span></div>
                          </div>
                        </div>
                        <button onClick={() => setArbStep(3)}
                          className="w-full py-2.5 font-mono text-xs font-bold rounded-lg bg-[#4ade80] text-black hover:bg-green-400 transition-all">
                          ✓ Review Trade Details →
                        </button>
                      </div>
                    )}

                    {/* Step 3: Review & sign */}
                    {arbStep === 3 && pendingArbTrade && (
                      <div className="space-y-3">
                        <div className="rounded-lg border border-[rgba(0,255,229,0.2)] bg-[rgba(0,255,229,0.04)] p-4 font-mono text-xs space-y-2">
                          <div className="text-[#00FFE5] font-bold mb-2">📋 Trade Order — Awaiting Your Signature</div>
                          {[
                            { label: 'Pair', value: selectedPair.symbol },
                            { label: 'Action', value: `Buy on ${pendingArbTrade.buyEx} · Sell on ${pendingArbTrade.sellEx}` },
                            { label: 'Size', value: `${orderAmount} units` },
                            { label: 'Est. Profit', value: `+$${fmtPrice(pendingArbTrade.spread * parseFloat(orderAmount || '1'))}`, color: 'text-[#4ade80]' },
                            { label: 'Network', value: network === 'mainnet' ? '🌐 Mainnet (real funds)' : '🔵 Testnet (simulated)', color: network === 'mainnet' ? 'text-[#4ade80]' : 'text-blue-300' },
                            { label: 'Agent Fee', value: '0.1 XLM via 0x402', color: 'text-[#FFB800]' },
                          ].map((row) => (
                            <div key={row.label} className="flex justify-between">
                              <span className="text-gray-500">{row.label}</span>
                              <span className={row.color ?? 'text-white'}>{row.value}</span>
                            </div>
                          ))}
                        </div>
                        <div className="font-mono text-[9px] text-gray-600 text-center">
                          ⚠ Your wallet signature authorises this trade. The agent will not proceed without it.
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={() => { setArbStep(0); setArbRunning(false); setPendingArbTrade(null); setArbResult(null); }}
                            className="py-2 font-mono text-xs rounded-lg border border-white/10 text-gray-400 hover:text-white transition-all">
                            ✕ Cancel
                          </button>
                          <button
                            onClick={() => {
                              setSigModalOpen(true);
                              setArbStep(4);
                              const profit = pendingArbTrade.spread * parseFloat(orderAmount || '1') * (Math.random() > 0.2 ? 1 : -1) * (0.6 + Math.random() * 0.8);
                              setTimeout(() => {
                                setSigModalOpen(false);
                                setArbResult({ profit, pair: selectedPair.symbol });
                                setArbStep(5);
                                setArbRunning(false);
                                persistClosedTrade(profit, selectedPair.id, 'manual', candles[candles.length - 1]?.close ?? currentPrice);
                              }, 2200);
                            }}
                            className="py-2 font-mono text-xs font-bold rounded-lg bg-[#00FFE5] text-black hover:bg-cyan-300 transition-all">
                            ✍ Sign & Execute
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Step 4: Signing in progress */}
                    {arbStep === 4 && sigModalOpen && (
                      <div className="text-center space-y-3 py-4">
                        <div className="text-4xl animate-bounce">✍</div>
                        <div className="font-mono text-sm text-[#00FFE5]">Awaiting wallet signature…</div>
                        <div className="font-mono text-xs text-gray-500">Please confirm the transaction in your wallet</div>
                        <div className="flex justify-center gap-1 mt-2">
                          {[0, 1, 2].map((i) => (
                            <div key={i} className="w-2 h-2 rounded-full bg-[#00FFE5] animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Step 5: Result */}
                    {arbStep === 5 && arbResult && (
                      <div className="space-y-3">
                        <div className={`rounded-xl border p-5 font-mono text-sm text-center ${arbResult.profit >= 0 ? 'border-green-700 bg-green-900/10' : 'border-red-900 bg-red-900/10'}`}>
                          <div className="text-2xl mb-2">{arbResult.profit >= 0 ? '🎯' : '📉'}</div>
                          <div className={`font-bold text-lg ${arbResult.profit >= 0 ? 'text-[#4ade80]' : 'text-red-400'}`}>
                            {arbResult.profit >= 0 ? '+' : ''}${fmtPrice(arbResult.profit)}
                          </div>
                          <div className="text-gray-400 text-xs mt-1">
                            {arbResult.profit >= 0 ? 'Arbitrage profit captured' : 'Spread closed before execution'} · {arbResult.pair.toUpperCase()}
                          </div>
                          <div className="text-gray-600 text-[10px] mt-1">Dashboard PnL updated ✓</div>
                        </div>
                        <button onClick={() => { setArbStep(0); setArbRunning(false); setPendingArbTrade(null); setArbResult(null); }}
                          className="w-full py-2 font-mono text-xs rounded-lg border border-white/10 text-gray-400 hover:text-white transition-all">
                          ↩ Run Another Demo
                        </button>
                      </div>
                    )}
                  </div>

                  {/* How it works explainer */}
                  <div className="rounded-2xl border border-white/[0.07] bg-[rgba(5,5,12,0.85)] p-5 space-y-3">
                    <h3 className="font-syne text-sm font-bold text-white">How Arbitrage Agents Work</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {[
                        { step: '1', icon: '🔍', title: 'Scan Prices', desc: 'Agent polls multiple CEX APIs (Binance, Coinbase, Kraken) every second for the same asset price.' },
                        { step: '2', icon: '📊', title: 'Detect Spread', desc: 'When price difference exceeds a configurable threshold (e.g. 0.2%), the opportunity is flagged.' },
                        { step: '3', icon: '✍', title: 'User Validates', desc: 'Agent presents trade details. You review and sign with your wallet — the agent never holds your keys.' },
                        { step: '4', icon: '⚡', title: 'Execute & Profit', desc: 'Agent simultaneously buys on the cheaper exchange and sells on the pricier one, capturing the spread.' },
                      ].map((item) => (
                        <div key={item.step} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-lg">{item.icon}</span>
                            <span className="font-syne font-bold text-white text-xs">{item.title}</span>
                          </div>
                          <p className="font-mono text-[10px] text-gray-400">{item.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
