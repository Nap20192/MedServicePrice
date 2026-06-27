import React, { FormEvent, useEffect, useState } from 'react';
import { createSource, listSources, triggerSourceFetch } from '../api/api';
import { SourceDetails } from '../types';

type FormState = {
  clinic_name: string;
  url: string;
  city: string;
  address: string;
  phone: string;
  working_hours: string;
  fetch_now: boolean;
};

const INITIAL_FORM: FormState = {
  clinic_name: '',
  url: '',
  city: '',
  address: '',
  phone: '',
  working_hours: '',
  fetch_now: true,
};

function statusText(status: string) {
  switch (status) {
    case 'adapter_create_and_fetch_queued':
      return 'Адаптер и парсинг поставлены в очередь';
    case 'adapter_create_queued':
      return 'Создание адаптера поставлено в очередь';
    case 'fetch_queued':
      return 'Парсинг поставлен в очередь';
    default:
      return 'Источник уже существует';
  }
}

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceDetails[]>([]);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const data = await listSources();
    setSources(data);
  };

  useEffect(() => {
    refresh()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await createSource(form);
      setMessage(statusText(result.status));
      setForm(INITIAL_FORM);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить источник');
    } finally {
      setSaving(false);
    }
  };

  const runFetch = async (source: SourceDetails) => {
    setRunningId(source.id);
    setError(null);
    setMessage(null);
    try {
      const result = await triggerSourceFetch(source.id);
      setMessage(`${source.clinic_name}: ${statusText(result.status)}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось запустить парсинг');
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Источники данных</h1>
          <p className="text-sm text-slate-500 mt-1">Клиники, URL прайс-листов и ручной запуск парсинга.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">
          <form onSubmit={submit} className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase mb-1">Клиника</label>
              <input
                value={form.clinic_name}
                onChange={(e) => update('clinic_name', e.target.value)}
                required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                placeholder="Например, Invitro Kazakhstan"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase mb-1">URL</label>
              <input
                value={form.url}
                onChange={(e) => update('url', e.target.value)}
                required
                type="url"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                placeholder="https://example.kz/prices"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input value={form.city} onChange={(e) => update('city', e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" placeholder="Город" />
              <input value={form.phone} onChange={(e) => update('phone', e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" placeholder="Телефон" />
            </div>
            <input value={form.address} onChange={(e) => update('address', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" placeholder="Адрес" />
            <input value={form.working_hours} onChange={(e) => update('working_hours', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" placeholder="09:00-18:00" />
            <label className="flex items-center justify-between gap-3 text-sm text-slate-600 cursor-pointer">
              <span>Сразу запустить парсинг</span>
              <input type="checkbox" checked={form.fetch_now} onChange={(e) => update('fetch_now', e.target.checked)} className="w-4 h-4 accent-teal-500" />
            </label>
            <button
              type="submit"
              disabled={saving}
              className="w-full bg-teal-500 hover:bg-teal-600 disabled:bg-slate-300 text-white font-medium rounded-lg px-4 py-2.5 transition-colors"
            >
              {saving ? 'Сохранение...' : 'Добавить источник'}
            </button>
            {(message || error) && (
              <div className={`text-sm rounded-lg px-3 py-2 ${error ? 'bg-red-50 text-red-600' : 'bg-teal-50 text-teal-700'}`}>
                {error || message}
              </div>
            )}
          </form>

          <div className="bg-white border border-slate-100 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Добавленные источники</h2>
              <span className="text-xs text-slate-400">{sources.length}</span>
            </div>
            {loading ? (
              <div className="p-8 text-center text-slate-400 text-sm">Загрузка...</div>
            ) : sources.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">Источников пока нет</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {sources.map((source) => (
                  <div key={source.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-800">{source.clinic_name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${source.adapter_id ? 'bg-teal-50 text-teal-700' : 'bg-amber-50 text-amber-700'}`}>
                          {source.adapter_id ? 'adapter ready' : 'adapter pending'}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 truncate mt-1">{source.url}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {[source.city, source.address, source.phone].filter(Boolean).join(' · ') || 'Без дополнительных данных'}
                      </p>
                    </div>
                    <button
                      onClick={() => runFetch(source)}
                      disabled={runningId === source.id}
                      className="shrink-0 bg-slate-900 hover:bg-slate-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
                    >
                      {runningId === source.id ? 'Запуск...' : 'Запустить парсинг'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
