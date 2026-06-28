import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useComparison } from '../context/ComparisonContext';

const NAV = [
  { to: '/', label: 'Главная' },
  { to: '/search', label: 'Поиск' },
  { to: '/sources', label: 'Источники' },
];

export default function Navbar() {
  const { items, setIsOpen } = useComparison();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const linkClass = (to: string) =>
    `text-sm transition-colors ${
      pathname === to ? 'text-neutral-900 font-semibold' : 'text-neutral-500 hover:text-neutral-900'
    }`;

  return (
    <header className="sticky top-0 z-50 bg-neutral-50/90 backdrop-blur border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-neutral-900 flex items-center justify-center">
              <span className="text-white font-mono font-bold text-sm">M</span>
            </div>
            <span className="font-mono font-semibold text-neutral-900 text-sm tracking-tight">
              MedServicePrice<span className="text-neutral-400">.kz</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-7">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className={linkClass(n.to)}>{n.label}</Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button
                onClick={() => setIsOpen(true)}
                className="flex items-center gap-2 border border-neutral-900 bg-neutral-900 text-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-700 transition-colors"
                id="nav-comparison-btn"
              >
                Сравнение
                <span className="font-mono bg-white text-neutral-900 px-1.5 leading-5 text-[11px]">{items.length}</span>
              </button>
            )}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden p-2 text-neutral-600 hover:bg-neutral-200 transition-colors"
              id="mobile-menu-toggle"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {menuOpen
                  ? <path strokeLinecap="square" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  : <path strokeLinecap="square" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
              </svg>
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-neutral-200 py-2 animate-fade-in">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setMenuOpen(false)}
                className="block px-2 py-2.5 text-sm text-neutral-700 hover:bg-neutral-200 transition-colors"
              >
                {n.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
