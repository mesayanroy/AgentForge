'use client';

import { useState, useEffect } from 'react';
import { truncateAddress } from '@/lib/stellar';
import { createPortal } from 'react-dom';

type WalletOption = {
  id: string;
  name: string;
  icon: string;
  description: string;
};

const WALLET_OPTIONS: WalletOption[] = [
  {
    id: 'freighter',
    name: 'Freighter',
    icon: '🚀',
    description: 'Official Stellar browser extension wallet',
  },
  {
    id: 'lobstr',
    name: 'LOBSTR',
    icon: '🦞',
    description: 'Popular Stellar wallet with WalletConnect',
  },
  {
    id: 'xbull',
    name: 'xBull Wallet',
    icon: '🐂',
    description: 'Feature-rich Stellar wallet extension',
  },
  {
    id: 'albedo',
    name: 'Albedo',
    icon: '✨',
    description: 'Non-custodial signer — no install required',
  },
];

export default function WalletConnect() {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>('0');
  const [afBalance, setAfBalance] = useState<string>('0');
  const [connecting, setConnecting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('wallet_address');
    if (saved) {
      setAddress(saved);
      fetchBalance(saved);
    }
    setMounted(true);
  }, []);

  const fetchBalance = async (addr: string) => {
    try {
      const { getXlmBalance, getAfBalance } = await import('@/lib/stellar');
      const bal = await getXlmBalance(addr);
      setBalance(parseFloat(bal).toFixed(2));
      const afBal = await getAfBalance(addr);
      setAfBalance(parseFloat(afBal).toFixed(1));
    } catch {
      setBalance('0');
      setAfBalance('0');
    }
  };

  const connectFreighter = async (): Promise<string | null> => {
    const freighter = await import('@stellar/freighter-api');
    const connectionResult = await freighter.isConnected();
    if (!connectionResult.isConnected) {
      throw new Error('Freighter extension not found. Please install it from https://freighter.app');
    }
    await freighter.requestAccess();
    const { address: pubKey, error } = await freighter.getAddress();
    if (error || !pubKey) throw new Error('Could not retrieve address from Freighter');
    return pubKey;
  };

  const connectXBull = async (): Promise<string | null> => {
    // xBull exposes window.xBullSDK after install
    const win = window as unknown as { xBullSDK?: { connect: () => Promise<{ publicKey: string }> } };
    if (!win.xBullSDK) {
      throw new Error('xBull Wallet extension not found. Please install it from https://xbull.app');
    }
    const result = await win.xBullSDK.connect();
    if (!result?.publicKey) throw new Error('xBull did not return a public key');
    return result.publicKey;
  };

  const connectAlbedo = async (): Promise<string | null> => {
    const albedo = await import(
      /* webpackIgnore: true */ 'https://albedo.link/albedo.js' as string
    ).catch(() => null);
    if (!albedo) {
      // Albedo loads as a global script; check window.albedo
      const win = window as unknown as { albedo?: { publicKey: (opts: object) => Promise<{ pubkey: string }> } };
      if (!win.albedo) {
        throw new Error('Albedo could not be loaded. Try opening https://albedo.link in a new tab first.');
      }
      const result = await win.albedo.publicKey({ require_existing: false });
      return result?.pubkey || null;
    }
    const result = await (albedo as { publicKey: (opts: object) => Promise<{ pubkey: string }> }).publicKey({ require_existing: false });
    return result?.pubkey || null;
  };

  const connectLobstr = async (): Promise<string | null> => {
    // LOBSTR exposes the Stellar Web Authentication protocol via WalletConnect or their extension
    // Check if the extension is present
    const win = window as unknown as { lobstr?: { getPublicKey: () => Promise<string> } };
    if (!win.lobstr) {
      throw new Error(
        'LOBSTR extension not found. Install from https://lobstr.co or scan the QR code with the LOBSTR mobile app.'
      );
    }
    const pubKey = await win.lobstr.getPublicKey();
    if (!pubKey) throw new Error('LOBSTR did not return a public key');
    return pubKey;
  };

  const handleWalletSelect = async (walletId: string) => {
    setConnecting(true);
    setWalletError(null);
    try {
      let pubKey: string | null = null;

      switch (walletId) {
        case 'freighter':
          pubKey = await connectFreighter();
          break;
        case 'xbull':
          pubKey = await connectXBull();
          break;
        case 'albedo':
          pubKey = await connectAlbedo();
          break;
        case 'lobstr':
          pubKey = await connectLobstr();
          break;
        default:
          throw new Error(`Unknown wallet: ${walletId}`);
      }

      if (pubKey) {
        setAddress(pubKey);
        localStorage.setItem('wallet_address', pubKey);
        localStorage.setItem('wallet_type', walletId);
        await fetchBalance(pubKey);
        setShowModal(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setWalletError(msg);
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    setAddress(null);
    setBalance('0');
    setAfBalance('0');
    localStorage.removeItem('wallet_address');
    localStorage.removeItem('wallet_type');
  };

  if (address) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded border border-[rgba(0,255,229,0.2)] bg-[rgba(0,255,229,0.04)]">
          <div className="w-2 h-2 rounded-full bg-[#00FFE5] animate-pulse" />
          <span className="font-mono text-xs text-[#00FFE5]">{truncateAddress(address)}</span>
          <span className="font-mono text-xs text-gray-400">{balance} XLM</span>
          <span className="font-mono text-xs text-[#00FFE5] font-bold">· {afBalance} AF$</span>
        </div>
        <button
          onClick={disconnect}
          className="text-xs text-gray-500 hover:text-red-400 transition-colors font-mono"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => { setShowModal(true); setWalletError(null); }}
        disabled={connecting}
        className="px-4 py-1.5 text-sm font-mono border border-[#00FFE5] text-[#00FFE5] rounded hover:bg-[#00FFE5] hover:text-black transition-all duration-200 disabled:opacity-50"
      >
        {connecting ? 'Connecting...' : 'Connect Wallet'}
      </button>

      {showModal && mounted && createPortal(
        <div className="fixed inset-0 z-[120] flex items-end justify-center px-4 pb-6 pt-6 sm:items-start sm:pt-24">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />

          {/* Modal */}
          <div className="relative z-10 w-full max-w-sm max-h-[72vh] overflow-y-auto rounded-2xl border border-[rgba(0,255,229,0.2)] bg-[#0a0a10] p-6 shadow-2xl sm:max-h-[70vh]">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-syne text-lg font-bold text-white">Connect a Wallet</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-500 hover:text-white transition-colors font-mono text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <p className="font-mono text-xs text-gray-500 mb-4">
              Select a Stellar wallet to connect to AgentForge.
            </p>

            {walletError && (
              <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-400 font-mono text-xs">
                {walletError}
              </div>
            )}

            <div className="space-y-2">
              {WALLET_OPTIONS.map((wallet) => (
                <button
                  key={wallet.id}
                  onClick={() => handleWalletSelect(wallet.id)}
                  disabled={connecting}
                  className="w-full flex items-center gap-4 p-3.5 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] hover:border-[rgba(0,255,229,0.3)] hover:bg-[rgba(0,255,229,0.04)] transition-all text-left disabled:opacity-50"
                >
                  <span className="text-2xl leading-none">{wallet.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-syne font-bold text-white text-sm">{wallet.name}</div>
                    <div className="font-mono text-xs text-gray-500 truncate">{wallet.description}</div>
                  </div>
                  <span className="text-gray-600 font-mono text-xs shrink-0">→</span>
                </button>
              ))}
            </div>

            <p className="mt-4 font-mono text-[10px] text-gray-600 text-center">
              Connecting will request access to your public key only. No funds are moved.
            </p>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
