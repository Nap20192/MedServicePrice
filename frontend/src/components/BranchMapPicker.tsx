import React, { FormEvent, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { addBranches, searchGooglePlacesClinics, BranchInput } from '../api/api';
import { GooglePlaceClinicCandidate, SourceDetails } from '../types';

function srcHost(url: string) {
  try { return new URL(url).host; } catch { return url; }
}

function pin(selected: boolean) {
  return L.divIcon({
    html: `<div style="width:14px;height:14px;border:2px solid #fff;background:${selected ? '#2563eb' : '#171717'}"></div>`,
    className: '',
    iconAnchor: [7, 7],
  });
}

interface Props {
  sources: SourceDetails[];
  onDone: () => void;
  notify: (msg: string, isError?: boolean) => void;
}

// Pick a network source, search clinics on a map, select many, add them all as
// branches of that source in one shot.
export default function BranchMapPicker({ sources, onDone, notify }: Props) {
  const [sourceId, setSourceId] = useState('');
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('76.92861,43.23895'); // lon,lat (Almaty)
  const [candidates, setCandidates] = useState<GooglePlaceClinicCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  const mapped = useMemo(() => candidates.filter((c) => c.lat != null && c.lng != null), [candidates]);
  const center: [number, number] = mapped[0] ? [mapped[0].lat!, mapped[0].lng!] : [43.238, 76.945];

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await searchGooglePlacesClinics(query.trim(), location.trim());
      setCandidates(res);
      setSelected(new Set());
      notify(`Найдено клиник: ${res.length}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Поиск не сработал', true);
    } finally {
      setSearching(false);
    }
  };

  const submit = async () => {
    if (!sourceId || !name.trim() || selected.size === 0) return;
    setSaving(true);
    try {
      const branches: BranchInput[] = candidates
        .filter((c) => selected.has(c.id))
        .map((c) => ({ city: c.city, address: c.address, phone: c.phone, working_hours: c.working_hours, lat: c.lat, lng: c.lng }));
      const created = await addBranches(sourceId, name.trim(), branches);
      notify(`Добавлено филиалов: ${created.length} → ${name.trim()}`);
      setSelected(new Set());
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось добавить филиалы', true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-neutral-200 bg-white">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
        <span className="label">Филиалы по карте</span>
        {selected.size > 0 && <span className="font-mono text-xs text-neutral-500">выбрано {selected.size}</span>}
      </div>

      {/* Controls */}
      <div className="p-4 space-y-3 border-b border-neutral-200">
        <div className="grid sm:grid-cols-2 gap-2">
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}
            className="border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:border-neutral-900">
            <option value="">Источник сети…</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{srcHost(s.url)}</option>)}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя сети (для всех филиалов)"
            className="border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900" />
        </div>
        <form onSubmit={search} className="grid sm:grid-cols-[1fr_180px_auto] gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск клиник (Google Maps), напр. «инвитро алматы»"
            className="border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900" />
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="lon,lat"
            className="border border-neutral-300 px-3 py-2 text-sm font-mono focus:outline-none focus:border-neutral-900" />
          <button type="submit" disabled={searching}
            className="border border-neutral-900 bg-neutral-900 text-white px-4 py-2 text-sm hover:bg-neutral-700 disabled:bg-neutral-300 transition-colors">
            {searching ? '…' : 'Найти'}
          </button>
        </form>
      </div>

      {candidates.length > 0 && (
        <div className="grid lg:grid-cols-2">
          {/* Map */}
          <div className="h-80 border-b lg:border-b-0 lg:border-r border-neutral-200">
            <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }} key={mapped.map((m) => m.id).join(',')}>
              <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
              {mapped.map((c) => (
                <Marker key={c.id} position={[c.lat!, c.lng!]} icon={pin(selected.has(c.id))}
                  eventHandlers={{ click: () => toggle(c.id) }}>
                  <Popup>{c.name}<br />{c.address}</Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>

          {/* Checklist */}
          <div className="max-h-80 overflow-y-auto divide-y divide-neutral-100">
            {candidates.map((c) => (
              <label key={c.id} className={`flex items-start gap-3 px-4 py-2.5 text-sm cursor-pointer ${selected.has(c.id) ? 'bg-neutral-50' : 'hover:bg-neutral-50'}`}>
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="mt-1 accent-neutral-900" />
                <span className="min-w-0">
                  <span className="font-medium text-neutral-900">{c.name}</span>
                  <span className="block text-xs text-neutral-500">{[c.city, c.address].filter(Boolean).join(' · ')}</span>
                  {(c.rating || c.phone) && (
                    <span className="block text-xs text-neutral-400 font-mono">{[c.rating ? `★ ${c.rating}` : '', c.phone].filter(Boolean).join('  ')}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {candidates.length > 0 && (
        <div className="px-4 py-3 border-t border-neutral-200 flex items-center justify-between">
          <p className="text-xs text-neutral-400">Отметьте филиалы на карте или в списке.</p>
          <button onClick={submit} disabled={saving || !sourceId || !name.trim() || selected.size === 0}
            className="border border-neutral-900 bg-neutral-900 text-white px-5 py-2 text-sm hover:bg-neutral-700 disabled:bg-neutral-300 transition-colors">
            {saving ? 'Добавление…' : `Добавить филиалы (${selected.size})`}
          </button>
        </div>
      )}
    </div>
  );
}
