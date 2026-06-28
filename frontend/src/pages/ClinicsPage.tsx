import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listClinics, listSources } from '../api/api';
import { ClinicRecord, SourceDetails } from '../types';

function srcHost(url: string) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}

export default function ClinicsPage() {
  const [clinics, setClinics] = useState<ClinicRecord[]>([]);
  const [sources, setSources] = useState<SourceDetails[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([listClinics(), listSources()])
      .then(([c, s]) => { setClinics(c); setSources(s); })
      .finally(() => setLoading(false));
  }, []);

  // source_id -> network host (the "сеть")
  const network = useMemo(() => {
    const m = new Map<string, string>();
    sources.forEach((s) => m.set(s.id, srcHost(s.url)));
    return m;
  }, [sources]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return clinics;
    return clinics.filter((c) =>
      [c.name, c.city, c.address].filter(Boolean).some((v) => v!.toLowerCase().includes(t)));
  }, [clinics, q]);

  return (
    <div className="bg-neutral-50 min-h-screen">
      <div className="border-b border-neutral-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Клиники и филиалы</h1>
          <p className="text-sm text-neutral-500 mt-1">
            <span className="font-mono">{clinics.length}</span> клиник · сравните филиалы сетей по адресу и услугам
          </p>
          <div className="mt-4 max-w-md">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по названию, городу, адресу"
              className="w-full border border-neutral-900 px-3 h-10 text-sm focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-neutral-200 border border-neutral-200">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="bg-white h-28 animate-shimmer" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="border border-neutral-200 bg-white py-20 text-center font-mono text-sm text-neutral-500">
            Клиник не найдено
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-neutral-200 border border-neutral-200">
            {filtered.map((c) => (
              <Link
                key={c.id}
                to={`/clinic/${c.id}`}
                className="bg-white p-4 hover:bg-neutral-50 transition-colors flex flex-col gap-2 group"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-neutral-900 leading-snug">{c.name}</p>
                  {c.rating != null && (
                    <span className="font-mono text-xs text-neutral-500 shrink-0">★ {c.rating.toFixed(1)}</span>
                  )}
                </div>
                <p className="text-xs text-neutral-500">
                  {[c.city, c.address].filter(Boolean).join(' · ') || 'Адрес не указан'}
                </p>
                <div className="mt-auto flex items-center justify-between pt-2">
                  {c.source_id && network.has(c.source_id) ? (
                    <span className="label">сеть · {network.get(c.source_id)}</span>
                  ) : <span className="label">без источника</span>}
                  <span className="text-neutral-300 group-hover:text-neutral-900 transition-colors">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
