import React, { useState, useEffect, Suspense, lazy } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MedService, ServiceCategory } from '../types';
import { getClinicById } from '../api/api';
import { formatPrice, formatParsedAt, isPriceStale, isOpenNow, categoryColors } from '../utils/format';
import { SkeletonList } from '../components/SkeletonCard';
import { useComparison } from '../context/ComparisonContext';

const MapView = lazy(() => import('../components/MapView'));

const TABS: { value: ServiceCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'Все услуги' },
  { value: 'лаборатория', label: '🧪 Анализы' },
  { value: 'диагностика', label: '🔬 Диагностика' },
  { value: 'приём врача', label: '👨‍⚕️ Приём врача' },
  { value: 'процедура', label: '💉 Процедуры' },
];

export default function ClinicPage() {
  const { id } = useParams<{ id: string }>();
  const [services, setServices] = useState<MedService[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ServiceCategory | 'all'>('all');
  const [innerQuery, setInnerQuery] = useState('');
  const { addItem, removeItem, isInComparison } = useComparison();

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getClinicById(id).then((data) => {
      setServices(data);
      setLoading(false);
    });
  }, [id]);

  const clinic = services[0];
  const open = clinic ? isOpenNow(clinic.working_hours) : false;

  const filtered = services.filter((s) => {
    if (tab !== 'all' && s.category !== tab) return false;
    if (innerQuery && !s.service_name_norm.toLowerCase().includes(innerQuery.toLowerCase()) && !s.service_name_raw.toLowerCase().includes(innerQuery.toLowerCase())) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="bg-white rounded-2xl border border-slate-100 p-6 mb-6 animate-pulse">
          <div className="h-6 bg-slate-200 rounded w-48 mb-2" />
          <div className="h-4 bg-slate-100 rounded w-64" />
        </div>
        <SkeletonList count={6} />
      </div>
    );
  }

  if (!clinic) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-20 text-center">
        <div className="text-5xl mb-4">🏥</div>
        <h2 className="text-xl font-bold text-slate-700 mb-2">Клиника не найдена</h2>
        <Link to="/search" className="text-teal-500 hover:underline text-sm">← Вернуться к поиску</Link>
      </div>
    );
  }

  const minPrice = Math.min(...services.map((s) => s.price_kzt));
  const maxPrice = Math.max(...services.map((s) => s.price_kzt));

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Clinic header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <div className="flex flex-col sm:flex-row gap-6">
            {/* Clinic avatar */}
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-100 to-teal-100 flex items-center justify-center text-4xl font-bold text-teal-600 shrink-0">
              {clinic.clinic_name.charAt(0)}
            </div>

            <div className="flex-1">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900">{clinic.clinic_name}</h1>
                  <p className="text-slate-400 text-sm mt-1">{clinic.city}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${open ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                  {open ? '● Открыто сейчас' : '● Закрыто'}
                </span>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-sm text-slate-600">
                <div className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  </svg>
                  {clinic.address}
                </div>
                <div className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  <a href={`tel:${clinic.phone}`} className="hover:text-teal-600 transition-colors">{clinic.phone}</a>
                </div>
                <div className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {clinic.working_hours}
                </div>
              </div>

              <div className="flex flex-wrap gap-3 mt-4">
                <a
                  href={`https://2gis.kz/search/${encodeURIComponent(clinic.clinic_name + ' ' + clinic.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                  id="route-btn"
                >
                  🗺 Построить маршрут
                </a>
                <a
                  href={clinic.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                  id="site-btn"
                >
                  ↗ Сайт клиники
                </a>
                {clinic.online_booking && (
                  <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-200 px-3 py-2 rounded-xl text-sm font-medium">
                    ✓ Онлайн-запись
                  </span>
                )}
              </div>

              {/* Stats */}
              <div className="flex gap-6 mt-4 pt-4 border-t border-slate-50">
                <div className="text-center">
                  <p className="text-lg font-bold text-slate-800">{services.length}</p>
                  <p className="text-xs text-slate-400">услуг в прайсе</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-slate-800">{new Intl.NumberFormat('ru-KZ').format(minPrice)} ₸</p>
                  <p className="text-xs text-slate-400">минимальная цена</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-slate-800">{new Intl.NumberFormat('ru-KZ').format(maxPrice)} ₸</p>
                  <p className="text-xs text-slate-400">максимальная цена</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Mini map */}
        <div className="h-48 mb-6 rounded-2xl overflow-hidden border border-slate-200">
          <Suspense fallback={<div className="w-full h-full bg-slate-100 flex items-center justify-center text-slate-400 text-sm">Загрузка карты...</div>}>
            <MapView services={[clinic]} />
          </Suspense>
        </div>

        {/* Inner search */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm mb-4">
          <div className="p-4">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={innerQuery}
                onChange={(e) => setInnerQuery(e.target.value)}
                placeholder="Поиск по прайсу клиники..."
                className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400 transition-all"
                id="clinic-inner-search"
              />
            </div>
          </div>

          {/* Category tabs */}
          <div className="flex overflow-x-auto border-t border-slate-100 px-4">
            {TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${tab === t.value ? 'border-teal-500 text-teal-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                id={`tab-${t.value}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Services table */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p className="text-3xl mb-2">🔍</p>
              <p className="text-sm">Ничего не найдено по вашему запросу</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left px-4 py-3 text-slate-500 font-medium">Услуга</th>
                    <th className="text-left px-4 py-3 text-slate-500 font-medium hidden sm:table-cell">Категория</th>
                    <th className="text-left px-4 py-3 text-slate-500 font-medium hidden md:table-cell">Срок</th>
                    <th className="text-right px-4 py-3 text-slate-500 font-medium">Цена</th>
                    <th className="text-left px-4 py-3 text-slate-500 font-medium hidden lg:table-cell">Обновлено</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filtered.map((s) => {
                    const inComp = isInComparison(s.service_id);
                    const stale = isPriceStale(s.parsed_at);
                    return (
                      <tr key={s.service_id} className="hover:bg-slate-50/60 transition-colors group">
                        <td className="px-4 py-3.5">
                          <p className="font-medium text-slate-800">{s.service_name_norm}</p>
                          {s.service_name_raw !== s.service_name_norm && (
                            <p className="text-xs text-slate-400 mt-0.5">«{s.service_name_raw}»</p>
                          )}
                        </td>
                        <td className="px-4 py-3.5 hidden sm:table-cell">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColors[s.category] || 'bg-slate-100 text-slate-600'}`}>
                            {s.category}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-slate-500 hidden md:table-cell">
                          {s.duration_days ? `${s.duration_days} дн.` : 'В день'}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className="font-bold text-slate-900">{formatPrice(s.price_kzt)}</span>
                        </td>
                        <td className="px-4 py-3.5 hidden lg:table-cell">
                          <span className={`text-xs ${stale ? 'text-amber-500' : 'text-slate-400'}`}>
                            {stale && '⚠ '}{formatParsedAt(s.parsed_at)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2 justify-end">
                            <a
                              href={s.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-slate-400 hover:text-teal-600 transition-colors opacity-0 group-hover:opacity-100"
                              id={`table-source-${s.service_id}`}
                            >
                              ↗
                            </a>
                            <button
                              onClick={() => inComp ? removeItem(s.service_id) : addItem(s)}
                              className={`text-xs px-2.5 py-1 rounded-lg border transition-all font-medium ${inComp ? 'bg-teal-500 text-white border-teal-500' : 'border-slate-200 text-slate-500 hover:border-teal-300 hover:text-teal-600 opacity-0 group-hover:opacity-100'}`}
                              id={`table-compare-${s.service_id}`}
                            >
                              {inComp ? '✓' : '+ Сравнить'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Back link */}
        <div className="mt-6 text-center">
          <Link to="/search" className="text-sm text-slate-400 hover:text-teal-600 transition-colors">
            ← Вернуться к поиску
          </Link>
        </div>
      </div>
    </div>
  );
}
