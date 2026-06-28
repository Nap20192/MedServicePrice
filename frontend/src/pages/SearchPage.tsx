import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import SearchBar from '../components/SearchBar';
import ServiceCard from '../components/ServiceCard';
import { SkeletonList } from '../components/SkeletonCard';
import MapView from '../components/MapView';
import { useMedicalServices } from '../hooks/useMedicalServices';
import { listSources } from '../api/api';
import { SearchFilters, SortMode, ServiceCategory, SourceDetails } from '../types';
import { categoryDot } from '../utils/format';

function srcHost(url: string) {
  try { return new URL(url).host; } catch { return url; }
}

const PRICE_MAX = 200000;
const PAGE_SIZE = 20;

const CATEGORIES: { value: ServiceCategory | ''; label: string }[] = [
  { value: '', label: 'Все категории' },
  { value: 'лаборатория', label: 'Лаборатория' },
  { value: 'диагностика', label: 'Диагностика' },
  { value: 'приём врача', label: 'Приём врача' },
  { value: 'процедура', label: 'Процедура' },
];

const SORTS: { value: SortMode; label: string }[] = [
  { value: 'price_asc', label: 'Дешевле' },
  { value: 'price_desc', label: 'Дороже' },
  { value: 'date_desc', label: 'Свежее' },
];

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get('query') || '';
  const urlCity = searchParams.get('city') || 'Все города';
  const urlCategory = (searchParams.get('category') || '') as ServiceCategory | '';

  const [query, setQuery] = useState(urlQuery);
  const [sort, setSort] = useState<SortMode>('price_asc');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [filters, setFilters] = useState<SearchFilters>({
    city: urlCity, category: urlCategory, sourceId: '', priceMin: 0, priceMax: PRICE_MAX,
    ratingMin: 0, durationDays: null, workingNow: false, onlineBooking: false,
  });
  const [sources, setSources] = useState<SourceDetails[]>([]);

  useEffect(() => { listSources().then(setSources).catch(() => {}); }, []);

  useEffect(() => {
    setQuery(searchParams.get('query') || '');
    setFilters((p) => ({
      ...p,
      city: searchParams.get('city') || 'Все города',
      category: (searchParams.get('category') || '') as ServiceCategory | '',
    }));
  }, [searchParams]);

  const [page, setPage] = useState(1);
  const { data, total, loading } = useMedicalServices(query, filters, sort, page, PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(rangeStart + data.length - 1, total);
  const mappedCount = data.filter((s) => s.lat && s.lng).length;
  const citiesOnPage = new Set(data.map((s) => s.city).filter(Boolean)).size;

  useEffect(() => { setPage(1); }, [query, JSON.stringify(filters), sort]);

  const handleSearch = useCallback((q: string, city: string) => {
    const params = new URLSearchParams();
    if (q) params.set('query', q);
    if (city && city !== 'Все города') params.set('city', city);
    setSearchParams(params);
    setQuery(q);
    setFilters((p) => ({ ...p, city }));
  }, [setSearchParams]);

  const updateFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) =>
    setFilters((p) => ({ ...p, [key]: value }));

  return (
    <div className="bg-neutral-50 min-h-screen">
      {/* Search bar strip */}
      <div className="border-b border-neutral-200 bg-neutral-50 sticky top-14 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
          <SearchBar initialQuery={query} initialCity={filters.city} onSearch={handleSearch} compact />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid lg:grid-cols-[220px_1fr] gap-6 items-start">
          {/* Filters */}
          <aside className="hidden lg:block border border-neutral-200 bg-white sticky top-32">
            <div className="px-4 py-3 border-b border-neutral-200">
              <span className="label">Фильтры</span>
            </div>

            <div className="p-4 border-b border-neutral-200">
              <span className="label">Категория</span>
              <div className="mt-2 -mx-1">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value || 'all'}
                    onClick={() => updateFilter('category', c.value)}
                    className={`w-full flex items-center gap-2 text-left text-sm px-1 py-1.5 transition-colors ${filters.category === c.value ? 'text-neutral-900 font-medium' : 'text-neutral-500 hover:text-neutral-900'}`}
                  >
                    {c.value
                      ? <span className={`w-1.5 h-1.5 rounded-full ${categoryDot[c.value] || 'bg-neutral-400'}`} />
                      : <span className="w-1.5 h-1.5 rounded-full bg-neutral-900" />}
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 border-b border-neutral-200">
              <span className="label">Источник</span>
              <select
                value={filters.sourceId}
                onChange={(e) => updateFilter('sourceId', e.target.value)}
                className="w-full mt-2 border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:border-neutral-900"
              >
                <option value="">Все источники</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>{srcHost(s.url)}</option>
                ))}
              </select>
            </div>

            <div className="p-4">
              <span className="label">Цена, ₸</span>
              <div className="flex gap-2 mt-2">
                <input
                  type="number" value={filters.priceMin || ''} placeholder="от"
                  onChange={(e) => updateFilter('priceMin', Number(e.target.value) || 0)}
                  className="w-1/2 border border-neutral-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-neutral-900"
                />
                <input
                  type="number" value={filters.priceMax === PRICE_MAX ? '' : filters.priceMax} placeholder="до"
                  onChange={(e) => updateFilter('priceMax', e.target.value ? Number(e.target.value) : PRICE_MAX)}
                  className="w-1/2 border border-neutral-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-neutral-900"
                />
              </div>
              <span className="label block mt-5">Рейтинг клиники</span>
              <div className="mt-2 grid grid-cols-4 border border-neutral-300 divide-x divide-neutral-300">
                {[0, 3.5, 4, 4.5].map((rating) => (
                  <button
                    key={rating}
                    onClick={() => updateFilter('ratingMin', rating)}
                    className={`py-1.5 text-xs font-mono transition-colors ${filters.ratingMin === rating ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}
                  >
                    {rating === 0 ? 'Все' : `${rating}+`}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setFilters({ city: filters.city, category: '', sourceId: '', priceMin: 0, priceMax: PRICE_MAX, ratingMin: 0, durationDays: null, workingNow: false, onlineBooking: false })}
                className="mt-4 w-full text-xs text-neutral-400 hover:text-neutral-900 transition-colors text-left"
              >
                Сбросить фильтры
              </button>
            </div>
          </aside>

          {/* Results */}
          <div className="min-w-0">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <div>
                <p className="text-sm text-neutral-500">
                  {loading ? 'Поиск…' : (
                    <>
                      <span className="font-mono font-semibold text-neutral-900">{total}</span> предложений
                      {query && <> · «<span className="text-neutral-900">{query}</span>»</>}
                      {total > PAGE_SIZE && <span className="text-neutral-400 font-mono"> · {rangeStart}–{rangeEnd}</span>}
                    </>
                  )}
                </p>
                {!loading && total > 0 && (
                  <p className="label mt-1">
                    {citiesOnPage} городов на странице · {mappedCount} с координатами · данные старше 30 дней помечаются
                  </p>
                )}
              </div>

              <div className="flex gap-px bg-neutral-300 border border-neutral-300">
                <div className="flex divide-x divide-neutral-300 bg-white">
                  {SORTS.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => setSort(s.value)}
                      className={`px-3 py-1.5 text-xs transition-colors ${sort === s.value ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <div className="flex divide-x divide-neutral-300 bg-white">
                  {(['list', 'map'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={`px-3 py-1.5 text-xs transition-colors ${view === v ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}
                    >
                      {v === 'list' ? 'Список' : 'Карта'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {loading ? (
              <SkeletonList count={6} />
            ) : total === 0 ? (
              <div className="border border-neutral-200 bg-white py-20 text-center">
                <p className="font-mono text-sm text-neutral-900">Ничего не найдено</p>
                <p className="text-sm text-neutral-400 mt-1">Измените запрос или сбросьте фильтры</p>
              </div>
            ) : view === 'map' ? (
              mappedCount === 0 ? (
                <div className="border border-neutral-200 bg-white py-20 text-center">
                  <p className="font-mono text-sm text-neutral-900">Нет координат для карты</p>
                  <p className="text-sm text-neutral-400 mt-1">Импортируйте клиники из Google Maps или добавьте lat/lng в БД</p>
                </div>
              ) : (
                <div className="border border-neutral-200 bg-white h-[620px]">
                  <MapView services={data.filter((s) => s.lat && s.lng)} />
                </div>
              )
            ) : (
              <>
                <div className="space-y-px bg-neutral-200 border border-neutral-200">
                  {data.map((s) => (
                    <ServiceCard key={s.service_id} service={s} showCity={filters.city === 'Все города'} />
                  ))}
                </div>

                {pageCount > 1 && (
                  <div className="flex items-center justify-center gap-px mt-6 border border-neutral-300 w-fit mx-auto divide-x divide-neutral-300" id="pagination">
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}
                      className="px-3 py-1.5 text-sm text-neutral-600 disabled:opacity-30 hover:bg-neutral-100 transition-colors">←</button>
                    {Array.from({ length: pageCount }, (_, i) => i + 1)
                      .filter((n) => n === 1 || n === pageCount || Math.abs(n - safePage) <= 1)
                      .map((n, idx, arr) => (
                        <React.Fragment key={n}>
                          {idx > 0 && n - arr[idx - 1] > 1 && <span className="px-2 py-1.5 text-neutral-300 text-sm">…</span>}
                          <button onClick={() => setPage(n)}
                            className={`px-3 py-1.5 text-sm font-mono transition-colors ${n === safePage ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}>{n}</button>
                        </React.Fragment>
                      ))}
                    <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={safePage === pageCount}
                      className="px-3 py-1.5 text-sm text-neutral-600 disabled:opacity-30 hover:bg-neutral-100 transition-colors">→</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
