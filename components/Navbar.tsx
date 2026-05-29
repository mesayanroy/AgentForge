'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import WalletConnect from './WalletConnect';

const BRAND_LOGO_SRC = '/brand/Screenshot 2026-04-22 220049.png';

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/build', label: 'Build' },
  { href: '/agents', label: 'Agents' },
  { href: '/workflow', label: 'Workflow' },
  { href: '/marketplace', label: 'Marketplace' },
];
// Restore older top-level documentation and community links
const extraLinks = [
  { href: '/docs', label: 'Docs' },
  { href: '/devs', label: 'Devs' },
  { href: '/about', label: 'About' },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[rgba(5,5,8,0.86)] backdrop-blur-md border-b border-[rgba(46,242,142,0.08)]">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="group inline-flex items-center">
          <span className="relative flex h-12 w-12 items-center justify-center overflow-hidden">
            <Image
              src={BRAND_LOGO_SRC}
              alt="AgentForge logo"
              fill
              sizes="48px"
              className="object-contain"
              priority
            />
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link-pill ${pathname === link.href ? 'active' : ''}`}
            >
              {link.label}
            </Link>
          ))}
          {extraLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link-pill ${pathname === link.href ? 'active' : ''}`}
            >
              {link.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="cta-secondary hidden sm:inline-flex">
            Open Dashboard
          </Link>
          <WalletConnect />
        </div>
      </div>
    </nav>
  );
}
