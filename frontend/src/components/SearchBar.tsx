import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAutocomplete } from '../api/api';

interface SearchBarProps {
  initialQuery?: string;
  onSearch?: (query: string) => void;
  compact?: boolean;
}

// Поиск по всему Казахстану — без фильтра по городам.
export default function SearchBar({ initialQuery = '', onSearch, compact = false }: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setQuery(initialQuery); }, [initialQuery]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.length < 2) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      const results = await getAutocomplete(query);
      setSuggestions(results);
      setShowSuggestions(true);
    }, 200);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const handleSearch = () => {
    setShowSuggestions(false);
    if (onSearch) { onSearch(query); return; }
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    navigate(`/search?${params.toString()}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActiveSuggestion((p) => Math.min(p + 1, suggestions.length - 1));
    else if (e.key === 'ArrowUp') setActiveSuggestion((p) => Math.max(p - 1, -1));
    else if (e.key === 'Enter') {
      if (activeSuggestion >= 0 && suggestions[activeSuggestion]) {
        setQuery(suggestions[activeSuggestion]); setShowSuggestions(false); setActiveSuggestion(-1);
      } else handleSearch();
    } else if (e.key === 'Escape') setShowSuggestions(false);
  };

  const field = compact ? 'h-9 text-sm' : 'h-12 text-[15px]';

  return (
    <div className="flex relative border border-neutral-900 bg-neutral-900 gap-px">
      <div className="relative flex-1 bg-white">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="square" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveSuggestion(-1); }}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder={compact ? 'Поиск услуги по Казахстану' : 'Общий анализ крови, МРТ, УЗИ, приём терапевта…'}
          className={`w-full bg-white pl-9 pr-3 text-neutral-900 placeholder:text-neutral-400 focus:outline-none ${field}`}
          id="service-search-input"
        />

        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-px bg-white border border-neutral-900 z-50 animate-fade-in">
            {suggestions.map((s, i) => (
              <button
                key={s}
                onMouseDown={() => { setQuery(s); setShowSuggestions(false); }}
                className={`w-full text-left px-3 py-2.5 text-sm transition-colors flex items-center gap-2 ${i === activeSuggestion ? 'bg-neutral-100' : 'hover:bg-neutral-100'} ${i !== 0 ? 'border-t border-neutral-200' : ''}`}
              >
                <span className="w-1 h-1 bg-neutral-900 shrink-0" />
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={handleSearch}
        className={`bg-neutral-900 text-white font-medium hover:bg-neutral-700 transition-colors ${compact ? 'px-4 text-sm' : 'px-7'}`}
        id="search-submit-btn"
      >
        Найти
      </button>
    </div>
  );
}
