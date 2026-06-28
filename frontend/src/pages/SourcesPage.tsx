import React, { FormEvent, useEffect, useState } from 'react';
import {
  createSource,
  getSchedulerSettings,
  listSources,
  rebuildSourceAdapter,
  triggerSourceFetch,
  updateSchedulerSettings,
} from '../api/api';
import { SourceDetails } from '../types';

function statusText(status: string) {
  switch (status) {
    case 'adapter_create_and_fetch_queued':
      return 'адаптер + парсинг в очереди';
    case 'adapter_create_queued':
      return 'создание адаптера в очереди';
    case 'fetch_queued':
      return 'парсинг в очереди';
    default:
      return 'уже существует';
  }
}

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceDetails[]>([]);
  const [urls, setUrls] = useState('');
  const [fetchNow, setFetchNow] = useState(true);
  const [intervalHours, setIntervalHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingScheduler, setSavingScheduler] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const [sourceData, scheduler] = await Promise.all([listSources(), getSchedulerSettings()]);
    setSources(sourceData);
    setIntervalHours(scheduler.fetch_interval_hours);
  };

  useEffect(() => {
    refresh()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Add one or many URLs at once (one per line). Clinics are linked later.
  const submitUrls = async (event: FormEvent) => {
    event.preventDefault();
    const list = urls.split('\n').map((u) => u.trim()).filter(Boolean);
    if (list.length === 0) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const results = await Promise.allSettled(
        list.map((url) => createSource({ url, fetch_now: fetchNow })),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.length - ok;
      setMessage(`Добавлено ${ok} URL${failed ? `, ошибок: ${failed}` : ''}`);
      setUrls('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить URL');
    } finally {
      setSaving(false);
    }
  };

  const saveScheduler = async () => {
    setSavingScheduler(true);
    setError(null);
    setMessage(null);
    try {
      const settings = await updateSchedulerSettings(intervalHours);
      setIntervalHours(settings.fetch_interval_hours);
      setMessage(`Автозапуск: каждые ${settings.fetch_interval_hours} ч.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось обновить scheduler');
    } finally {
      setSavingScheduler(false);
    }
  };

  const act = async (source: SourceDetails, fn: typeof triggerSourceFetch, ok: string) => {
    setBusyId(source.id);
    setError(null);
    setMessage(null);
    try {
      const result = await fn(source.id);
      setMessage(`${source.url}: ${ok} (${statusText(result.status)})`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Источники</h1>
          <p className="text-sm text-slate-500 mt-1">
            Добавьте URL прайсов — краулер сам построит адаптер и соберёт цены. Клиники привязываются позже.
          </p>
        </div>

        {(message || error) && (
          <div className={`mb-5 text-sm rounded-lg px-4 py-3 border ${error ? 'bg-red-50 text-red-700 border-red-100' : 'bg-teal-50 text-teal-800 border-teal-100'}`}>
            {error || message}
          </div>
        )}

        {/* Add URLs */}
        <form onSubmit={submitUrls} className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4 mb-6">
          <h2 className="font-semibold text-slate-800">Добавить URL</h2>
          <textarea
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            required
            rows={4}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-400"
            placeholder={'https://invitro.kz\nhttps://kdlolymp.kz\nhttps://example.kz/prices'}
          />
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={fetchNow}
                onChange={(e) => setFetchNow(e.target.checked)}
                className="w-4 h-4 accent-teal-500"
              />
              Сразу запустить парсинг
            </label>
            <button
              type="submit"
              disabled={saving}
              className="bg-teal-500 hover:bg-teal-600 disabled:bg-slate-300 text-white font-medium rounded-lg px-5 py-2 transition-colors"
            >
              {saving ? 'Добавление...' : 'Добавить'}
            </button>
          </div>
          <p className="text-xs text-slate-400">По одному URL на строку — можно добавить сразу несколько.</p>
        </form>

        {/* Scheduler */}
        <section className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 mb-6 flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
          <div>
            <h2 className="font-semibold text-slate-800">Автозапуск парсинга</h2>
            <p className="text-sm text-slate-500 mt-1">Scheduler запускает fetch всех источников по интервалу.</p>
          </div>
          <div className="flex items-end gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-slate-500 uppercase mb-1">Интервал, часов</span>
              <input
                value={intervalHours}
                min={1}
                type="number"
                onChange={(e) => setIntervalHours(Number(e.target.value))}
                className="w-28 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </label>
            <button
              type="button"
              disabled={savingScheduler || intervalHours < 1}
              onClick={saveScheduler}
              className="bg-slate-900 hover:bg-slate-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
            >
              {savingScheduler ? '...' : 'Сохранить'}
            </button>
          </div>
        </section>

        {/* Sources list */}
        <div className="bg-white border border-slate-100 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">Источники</h2>
            <span className="text-xs text-slate-400">{sources.length}</span>
          </div>
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-sm">Загрузка...</div>
          ) : sources.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">Источников пока нет</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {sources.map((source) => (
                <div key={source.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${source.adapter_id ? 'bg-teal-50 text-teal-700' : 'bg-amber-50 text-amber-700'}`}>
                        {source.adapter_id ? 'adapter ready' : 'adapter pending'}
                      </span>
                      {source.clinic_name ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{source.clinic_name}</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">без клиники</span>
                      )}
                      {source.city && <span className="text-xs text-slate-400">{source.city}</span>}
                    </div>
                    <p className="text-sm text-slate-600 break-all mt-1">{source.url}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => act(source, rebuildSourceAdapter, 'адаптер обновляется')}
                      disabled={busyId === source.id}
                      title="Перестроить адаптер (rediscover)"
                      className="border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-600 text-sm font-medium rounded-lg px-3 py-2 transition-colors"
                    >
                      ↻ Адаптер
                    </button>
                    <button
                      onClick={() => act(source, triggerSourceFetch, 'парсинг запущен')}
                      disabled={busyId === source.id}
                      className="bg-slate-900 hover:bg-slate-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
                    >
                      {busyId === source.id ? '...' : 'Fetch'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
