import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MedService, ServiceCategory } from '../types';
import { getClinicById } from '../api/api';
import { formatPrice, formatParsedAt, isPriceStale, categoryDot } from '../utils/format';
import { SkeletonList } from '../components/SkeletonCard';
import { useComparison } from '../context/ComparisonContext';

const TABS: { value: ServiceCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'лаборатория', label: 'Лаборатория' },
  { value: 'диагностика', label: 'Диагностика' },
  { value: 'приём врача', label: 'Приём врача' },
  { value: 'процедура', label: 'Процедура' },
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
    getClinicById(id).then((data) => { setServices(data); setLoading(false); });
  }, [id]);

  const clinic = services[0];
  const filtered = services.filter((s) => {
    if (tab !== 'all' && s.category !== tab) return false;
    if (innerQuery && !s.service_name_norm.toLowerCase().includes(innerQuery.toLowerCase())) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="border border-neutral-200 bg-white p-6 mb-px h-24 animate-shimmer" />
        <SkeletonList count={6} />
      </div>
    );
  }

  if (!clinic) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-24 text-center">
        <p className="font-mono text-neutral-900">Клиника не найдена</p>
        <Link to="/search" className="text-sm text-neutral-500 hover:text-neutral-900 mt-2 inline-block">← к поиску</Link>
      </div>
    );
  }

  const minPrice = Math.min(...services.map((s) => s.price_kzt));
  const maxPrice = Math.max(...services.map((s) => s.price_kzt));
  const fmt = (n: number) => new Intl.NumberFormat('ru-KZ').format(n) + ' ₸';

  return (
    <div className="bg-neutral-50 min-h-screen">
      {/* Header */}
      <div className="border-b border-neutral-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 bg-neutral-900 flex items-center justify-center text-white font-mono text-2xl font-bold shrink-0">
              {clinic.clinic_name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">{clinic.clinic_name}</h1>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-neutral-500">
                {clinic.city && <span>{clinic.city}</span>}
                {clinic.address && <span>· {clinic.address}</span>}
              </div>
              <div className="flex flex-wrap gap-px mt-4 w-fit">
                {clinic.source_url && (
                  <a href={clinic.source_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs border border-neutral-900 bg-neutral-900 text-white px-3 py-1.5 hover:bg-neutral-700 transition-colors">Сайт клиники ↗</a>
                )}
                {clinic.address && (
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clinic.clinic_name + ' ' + clinic.address)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-xs border border-neutral-300 px-3 py-1.5 text-neutral-700 hover:border-neutral-900 transition-colors">Маршрут (Google Maps)</a>
                )}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 divide-x divide-neutral-200 border border-neutral-200 mt-6 w-fit">
            {[
              { v: String(services.length), l: 'услуг' },
              { v: fmt(minPrice), l: 'мин. цена' },
              { v: fmt(maxPrice), l: 'макс. цена' },
            ].map((s) => (
              <div key={s.l} className="px-5 py-3">
                <p className="font-mono text-lg font-semibold text-neutral-900">{s.v}</p>
                <p className="label mt-0.5">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Inner search + tabs */}
        <div className="border border-neutral-200 bg-white mb-4">
          <input
            type="text" value={innerQuery} onChange={(e) => setInnerQuery(e.target.value)}
            placeholder="Поиск по прайсу клиники"
            className="w-full px-4 py-2.5 text-sm focus:outline-none border-b border-neutral-200"
            id="clinic-inner-search"
          />
          <div className="flex overflow-x-auto divide-x divide-neutral-200">
            {TABS.map((t) => (
              <button key={t.value} onClick={() => setTab(t.value)}
                className={`px-4 py-2.5 text-sm whitespace-nowrap transition-colors ${tab === t.value ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="border border-neutral-200 bg-white overflow-x-auto">
          {filtered.length === 0 ? (
            <p className="text-center py-12 text-sm text-neutral-400 font-mono">Ничего не найдено</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <th className="text-left px-4 py-2.5 label font-normal">Услуга</th>
                  <th className="text-left px-4 py-2.5 label font-normal hidden sm:table-cell">Категория</th>
                  <th className="text-left px-4 py-2.5 label font-normal hidden md:table-cell">Срок</th>
                  <th className="text-right px-4 py-2.5 label font-normal">Цена</th>
                  <th className="text-left px-4 py-2.5 label font-normal hidden lg:table-cell">Обновлено</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filtered.map((s) => {
                  const inComp = isInComparison(s.service_id);
                  const stale = isPriceStale(s.parsed_at);
                  return (
                    <tr key={s.service_id} className="hover:bg-neutral-50 group">
                      <td className="px-4 py-3 font-medium text-neutral-900">{s.service_name_norm}</td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
                          <span className={`w-1.5 h-1.5 rounded-full ${categoryDot[s.category] || 'bg-neutral-400'}`} />
                          {s.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-500 font-mono text-xs hidden md:table-cell">
                        {s.duration_days ? `${s.duration_days} дн.` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-neutral-900">{formatPrice(s.price_kzt)}</td>
                      <td className={`px-4 py-3 hidden lg:table-cell font-mono text-xs ${stale ? 'text-amber-600' : 'text-neutral-400'}`}>
                        {stale && '⚠ '}{formatParsedAt(s.parsed_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => inComp ? removeItem(s.service_id) : addItem(s)}
                          className={`text-xs px-2.5 py-1 border transition-colors ${inComp ? 'border-neutral-900 bg-neutral-100 text-neutral-900' : 'border-neutral-300 text-neutral-500 hover:border-neutral-900'}`}>
                          {inComp ? '✓' : '+'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <Link to="/search" className="mt-6 inline-block text-sm text-neutral-400 hover:text-neutral-900 transition-colors">← к поиску</Link>
      </div>
    </div>
  );
}
