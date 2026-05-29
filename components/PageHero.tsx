'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

type HeroAction = {
  href: string;
  label: string;
  variant?: 'primary' | 'secondary';
};

type HeroStat = {
  label: string;
  value: string;
};

interface PageHeroProps {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: HeroAction[];
  stats?: HeroStat[];
}

export default function PageHero({ eyebrow, title, description, actions = [], stats = [] }: PageHeroProps) {
  return (
    <section className="page-hero">
      <div className="page-shell text-center">
        <div className="page-kicker mx-auto">{eyebrow}</div>
        <h1 className="page-title mt-5 text-[36px] md:text-[52px] lg:text-[64px] max-w-4xl mx-auto">
          {title}
        </h1>
        {description && <p className="page-lead mx-auto mt-5 text-[15px] md:text-base">{description}</p>}

        {actions.length > 0 && (
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {actions.map((action) => (
              <Link
                key={action.label}
                href={action.href}
                className={action.variant === 'secondary' ? 'cta-secondary' : 'cta-primary'}
              >
                {action.label}
                {action.variant !== 'secondary' && <span>→</span>}
              </Link>
            ))}
          </div>
        )}

        {stats.length > 0 && (
          <div className="mt-10 page-grid cols-3 max-w-3xl mx-auto">
            {stats.map((stat) => (
              <div key={stat.label} className="page-panel-soft px-5 py-4 text-left">
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/35">{stat.label}</div>
                <div className="mt-2 text-lg font-semibold text-white">{stat.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}