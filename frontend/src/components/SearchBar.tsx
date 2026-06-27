import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAutocomplete } from '../api/api';

interface SearchBarProps {
  initialQuery?: string;
  initialCity?: string;
  onSearch?: (query: string, city: string) => void;
  compact?: boolean;
}

const CITIES = ['Все города', 'Алматы', 'Астана', 'Шымкент', 'Актобе', 'Павлодар', 'Тараз', 'Усть-Каменогорск'];

export default function SearchBar({ initialQuery = '', initialCity = 'Все города', onSearch, compact = false }: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const [city, setCity] = useState(initialCity);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const results = await getAutocomplete(query);
      setSuggestions(results);
      setShowSuggestions(true);
    }, 200);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const handleSearch = () => {
    setShowSuggestions(false);
    if (onSearch) {
      onSearch(query, city);
    } else {
      const params = new URLSearchParams();
      if (query) params.set('query', query);
      if (city && city !== 'Все города') params.set('city', city);
      navigate(`/search?${params.toString()}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      setActiveSuggestion((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      setActiveSuggestion((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      if (activeSuggestion >= 0 && suggestions[activeSuggestion]) {
        setQuery(suggestions[activeSuggestion]);
        setShowSuggestions(false);
        setActiveSuggestion(-1);
      } else {
        handleSearch();
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  return (
    <div className={`flex ${compact ? 'gap-2' : 'gap-3 flex-col sm:flex-row'} relative`}>
      {/* City selector */}
      <div className={`relative ${compact ? 'w-40 shrink-0' : 'sm:w-48'}`}>
        <select
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className={`w-full appearance-none bg-white border border-slate-200 rounded-xl font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400 transition-all cursor-pointer pr-8 ${compact ? 'px-3 py-2 text-sm' : 'px-4 py-4'}`}
          id="city-selector"
        >
          {CITIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Search input */}
      <div className="relative flex-1">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveSuggestion(-1); }}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder={compact ? 'Поиск услуги...' : 'Общий анализ крови, МРТ, УЗИ, приём терапевта...'}
          className={`w-full bg-white border border-slate-200 rounded-xl pl-11 pr-4 font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 transition-all ${compact ? 'py-2 text-sm' : 'py-4'}`}
          id="service-search-input"
        />

        {/* Autocomplete dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-100 rounded-xl shadow-xl z-50 overflow-hidden animate-fade-in">
            {suggestions.map((s, i) => (
              <button
                key={s}
                onMouseDown={() => {
                  setQuery(s);
                  setShowSuggestions(false);
                }}
                className={`w-full text-left px-4 py-3 text-sm transition-colors ${i === activeSuggestion ? 'bg-teal-50 text-teal-700' : 'text-slate-700 hover:bg-slate-50'} ${i !== 0 ? 'border-t border-slate-50' : ''}`}
              >
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  {s}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Search button */}
      <button
        onClick={handleSearch}
        className={`bg-teal-500 hover:bg-teal-600 active:bg-teal-700 text-white font-semibold rounded-xl transition-all shadow-md hover:shadow-teal-200 ${compact ? 'px-4 py-2 text-sm' : 'px-8 py-4'}`}
        id="search-submit-btn"
      >
        {compact ? 'Найти' : '🔍 Найти'}
      </button>
    </div>
  );
}
