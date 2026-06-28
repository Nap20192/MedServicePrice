import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import SearchBar from '../components/SearchBar';
import ServiceCard from '../components/ServiceCard';
import { SkeletonList } from '../components/SkeletonCard';
import { useMedicalServices } from '../hooks/useMedicalServices';
import { SearchFilters, SortMode, ServiceCategory } from '../types';

const PRICE_MAX = 200000;
const PAGE_SIZE = 20;

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Читаем параметры из URL
  const urlQuery = searchParams.get('query') || '';
  const urlCity = searchParams.get('city') || 'Все города';
  const urlCategory = (searchParams.get('category') || '') as ServiceCategory | '';

  const [query, setQuery] = useState(urlQuery);
  const [sort, setSort] = useState<SortMode>('price_asc');

  const [filters, setFilters] = useState<SearchFilters>({
    city: urlCity,
    category: urlCategory,
    priceMin: 0,
    priceMax: PRICE_MAX,
    durationDays: null,
    workingNow: false,
    onlineBooking: false,
  });

  // Sync URL → state when URL changes
  useEffect(() => {
    setQuery(searchParams.get('query') || '');
    setFilters((prev) => ({
      ...prev,
      city: searchParams.get('city') || 'Все города',
      category: (searchParams.get('category') || '') as ServiceCategory | '',
    }));
  }, [searchParams]);

  const { data, loading } = useMedicalServices(query, filters, sort);

  // Пагинация списка
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = data.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const rangeStart = data.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, data.length);

  // Сброс на первую страницу при смене запроса/фильтров/сортировки
  useEffect(() => {
    setPage(1);
  }, [query, JSON.stringify(filters), sort]);

  const handleSearch = useCallback((q: string, city: string) => {
    const params = new URLSearchParams();
    if (q) params.set('query', q);
    if (city && city !== 'Все города') params.set('city', city);
    setSearchParams(params);
    setQuery(q);
    setFilters((prev) => ({ ...prev, city }));
  }, [setSearchParams]);

  const updateFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const minPrice = data.length > 0 ? Math.min(...data.map((s) => s.price_kzt)) : 0;
  const maxPrice = data.length > 0 ? Math.max(...data.map((s) => s.price_kzt)) : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top search bar */}
      <div className="bg-white border-b border-slate-100 sticky top-16 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <SearchBar
            initialQuery={query}
            initialCity={filters.city}
            onSearch={handleSearch}
            compact
          />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-6">
          {/* ── Left sidebar: Filters ── */}
          <aside className="w-64 shrink-0 hidden lg:block">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 sticky top-32 space-y-6">
              <h3 className="font-semibold text-slate-800 text-sm">Фильтры</h3>

              {/* Price range */}
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">
                  Цена (₸)
                </label>
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={filters.priceMin}
                      onChange={(e) => updateFilter('priceMin', Number(e.target.value))}
                      placeholder="от"
                      className="w-1/2 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400"
                      id="filter-price-min"
                    />
                    <input
                      type="number"
                      value={filters.priceMax === PRICE_MAX ? '' : filters.priceMax}
                      onChange={(e) => updateFilter('priceMax', e.target.value ? Number(e.target.value) : PRICE_MAX)}
                      placeholder="до"
                      className="w-1/2 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400"
                      id="filter-price-max"
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={PRICE_MAX}
                    step={500}
                    value={filters.priceMax === PRICE_MAX ? PRICE_MAX : filters.priceMax}
                    onChange={(e) => updateFilter('priceMax', Number(e.target.value))}
                    className="w-full accent-teal-500"
                    id="filter-price-slider"
                  />
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">
                  Категория
                </label>
                <div className="space-y-1">
                  {[
                    { value: '', label: 'Все категории' },
                    { value: 'лаборатория', label: '🧪 Лаборатория' },
                    { value: 'диагностика', label: '🔬 Диагностика' },
                    { value: 'приём врача', label: '👨‍⚕️ Приём врача' },
                    { value: 'процедура', label: '💉 Процедура' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updateFilter('category', opt.value as ServiceCategory | '')}
                      className={`w-full text-left text-sm px-3 py-2 rounded-lg transition-colors ${filters.category === opt.value ? 'bg-teal-50 text-teal-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}
                      id={`filter-cat-${opt.value || 'all'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reset */}
              <button
                onClick={() => setFilters({ city: filters.city, category: '', priceMin: 0, priceMax: PRICE_MAX, durationDays: null, workingNow: false, onlineBooking: false })}
                className="w-full text-xs text-slate-400 hover:text-red-500 transition-colors py-1"
                id="filter-reset-btn"
              >
                Сбросить фильтры
              </button>
            </div>
          </aside>

          {/* ── Main content ── */}
          <div className="flex-1 min-w-0">
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <p className="text-sm text-slate-500">
                  {loading ? 'Поиск...' : (
                    <>
                      Найдено <span className="font-semibold text-slate-800">{data.length}</span> предложений
                      {query && <> по запросу «<span className="font-medium text-teal-600">{query}</span>»</>}
                      {data.length > PAGE_SIZE && (
                        <span className="text-slate-400"> · показаны {rangeStart}–{rangeEnd}</span>
                      )}
                    </>
                  )}
                </p>
                {!loading && data.length > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    Цены: от {new Intl.NumberFormat('ru-KZ').format(minPrice)} ₸ до {new Intl.NumberFormat('ru-KZ').format(maxPrice)} ₸
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3">
                {/* Sort tabs */}
                <div className="flex bg-white border border-slate-200 rounded-xl p-1 gap-1">
                  {([
                    { value: 'price_asc', label: 'Дешевле' },
                    { value: 'price_desc', label: 'Дороже' },
                    { value: 'date_desc', label: 'Свежее' },
                  ] as { value: SortMode; label: string }[]).map((s) => (
                    <button
                      key={s.value}
                      onClick={() => setSort(s.value)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${sort === s.value ? 'bg-teal-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      id={`sort-btn-${s.value}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Content area */}
            {(
              <div>
                {loading ? (
                  <SkeletonList count={5} />
                ) : data.length === 0 ? (
                  <div className="text-center py-20">
                    <div className="text-6xl mb-4">🔍</div>
                    <h3 className="text-xl font-semibold text-slate-700 mb-2">Ничего не найдено</h3>
                    <p className="text-slate-400">Попробуйте изменить запрос или сбросить фильтры</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-4">
                      {pageItems.map((service) => (
                        <ServiceCard key={service.service_id} service={service} showCity={filters.city === 'Все города'} />
                      ))}
                    </div>

                    {pageCount > 1 && (
                      <div className="flex items-center justify-center gap-1 mt-8" id="pagination">
                        <button
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          disabled={safePage === 1}
                          className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                          id="pagination-prev"
                        >
                          ← Назад
                        </button>
                        {Array.from({ length: pageCount }, (_, i) => i + 1)
                          .filter((n) => n === 1 || n === pageCount || Math.abs(n - safePage) <= 1)
                          .map((n, idx, arr) => (
                            <React.Fragment key={n}>
                              {idx > 0 && n - arr[idx - 1] > 1 && <span className="px-1 text-slate-300">…</span>}
                              <button
                                onClick={() => setPage(n)}
                                className={`min-w-9 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                                  n === safePage
                                    ? 'bg-teal-500 text-white border-teal-500'
                                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                }`}
                                id={`pagination-page-${n}`}
                              >
                                {n}
                              </button>
                            </React.Fragment>
                          ))}
                        <button
                          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                          disabled={safePage === pageCount}
                          className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                          id="pagination-next"
                        >
                          Вперёд →
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
