import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useComparison } from '../context/ComparisonContext';

export default function Navbar() {
  const { items, setIsOpen } = useComparison();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-400 to-primary-600 flex items-center justify-center shadow-md group-hover:shadow-teal-300 transition-shadow">
              <span className="text-white text-lg font-bold">M</span>
            </div>
            <div className="hidden sm:block">
              <span className="font-bold text-slate-800 text-lg leading-none">MedService</span>
              <span className="font-bold text-teal-500 text-lg leading-none">Price.kz</span>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6">
            <Link to="/" className="text-slate-500 hover:text-teal-600 font-medium transition-colors text-sm">
              Главная
            </Link>
            <Link to="/search" className="text-slate-500 hover:text-teal-600 font-medium transition-colors text-sm">
              Поиск услуг
            </Link>
            <Link to="/sources" className="text-slate-500 hover:text-teal-600 font-medium transition-colors text-sm">
              Источники
            </Link>
            <button
              onClick={() => navigate('/search?category=лаборатория')}
              className="text-slate-500 hover:text-teal-600 font-medium transition-colors text-sm"
            >
              Анализы
            </button>
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {/* Comparison badge */}
            {items.length > 0 && (
              <button
                onClick={() => setIsOpen(true)}
                className="relative flex items-center gap-2 bg-teal-50 hover:bg-teal-100 border border-teal-200 text-teal-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-all animate-fade-in"
                id="nav-comparison-btn"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <span>Сравнить</span>
                <span className="absolute -top-1.5 -right-1.5 bg-teal-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                  {items.length}
                </span>
              </button>
            )}

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
              id="mobile-menu-toggle"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {menuOpen
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                }
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-slate-100 py-3 space-y-1 animate-fade-in">
            <Link to="/" onClick={() => setMenuOpen(false)} className="block px-3 py-2 text-slate-600 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors text-sm font-medium">Главная</Link>
            <Link to="/search" onClick={() => setMenuOpen(false)} className="block px-3 py-2 text-slate-600 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors text-sm font-medium">Поиск услуг</Link>
            <Link to="/sources" onClick={() => setMenuOpen(false)} className="block px-3 py-2 text-slate-600 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors text-sm font-medium">Источники</Link>
            <button onClick={() => { navigate('/search?category=лаборатория'); setMenuOpen(false); }} className="block w-full text-left px-3 py-2 text-slate-600 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors text-sm font-medium">Анализы</button>
          </div>
        )}
      </div>
    </header>
  );
}
