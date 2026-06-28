import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { listClinics, listSources } from '../api/api';
import { ClinicRecord, SourceDetails } from '../types';

function srcHost(url: string) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}

const dot = L.divIcon({
  html: '<div style="width:12px;height:12px;border:2px solid #fff;background:#171717"></div>',
  className: '',
  iconAnchor: [6, 6],
});

export default function ClinicsPage() {
  const navigate = useNavigate();
  const [clinics, setClinics] = useState<ClinicRecord[]>([]);
  const [sources, setSources] = useState<SourceDetails[]>([]);
  const [q, setQ] = useState('');
  const [networkId, setNetworkId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([listClinics(), listSources()])
      .then(([c, s]) => { setClinics(c); setSources(s); })
      .finally(() => setLoading(false));
  }, []);

  const network = useMemo(() => {
    const m = new Map<string, string>();
    sources.forEach((s) => m.set(s.id, srcHost(s.url)));
    return m;
  }, [sources]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return clinics.filter((c) => {
      if (networkId && c.source_id !== networkId) return false;
      if (t && ![c.name, c.city, c.address].filter(Boolean).some((v) => v!.toLowerCase().includes(t))) return false;
      return true;
    });
  }, [clinics, q, networkId]);

  const mapped = useMemo(() => filtered.filter((c) => c.lat != null && c.lng != null), [filtered]);
  const center: [number, number] = mapped[0] ? [mapped[0].lat!, mapped[0].lng!] : [43.238, 76.945];

  return (
    <div className="bg-neutral-50 min-h-screen">
      <div className="border-b border-neutral-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Клиники и филиалы</h1>
          <p className="text-sm text-neutral-500 mt-1">
            <span className="font-mono">{filtered.length}</span> из {clinics.length} · сравните филиалы сетей по адресу и услугам
          </p>
          <div className="mt-4 flex flex-col sm:flex-row gap-2 max-w-2xl">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по названию, городу, адресу"
              className="flex-1 border border-neutral-900 px-3 h-10 text-sm focus:outline-none"
            />
            <select
              value={networkId}
              onChange={(e) => setNetworkId(e.target.value)}
              className="border border-neutral-300 px-3 h-10 text-sm bg-white focus:outline-none focus:border-neutral-900 sm:w-56"
            >
              <option value="">Все сети</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{srcHost(s.url)}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-px">
        {/* Map */}
        {mapped.length > 0 && (
          <div className="h-72 border border-neutral-200">
            <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }} key={mapped.map((m) => m.id).join(',')}>
              <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
              {mapped.map((c) => (
                <Marker key={c.id} position={[c.lat!, c.lng!]} icon={dot}
                  eventHandlers={{ click: () => navigate(`/clinic/${c.id}`) }}>
                  <Popup>
                    <b>{c.name}</b><br />{[c.city, c.address].filter(Boolean).join(', ')}
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
        )}

        {/* Grid */}
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
