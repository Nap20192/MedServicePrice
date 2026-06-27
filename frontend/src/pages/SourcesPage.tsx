import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  createClinic,
  createSource,
  getSchedulerSettings,
  listClinics,
  listSources,
  triggerSourceFetch,
  updateSchedulerSettings,
} from '../api/api';
import { ClinicRecord, SourceDetails } from '../types';

type SourceFormState = {
  url: string;
  fetch_now: boolean;
};

type ClinicFormState = {
  name: string;
  city: string;
  address: string;
  phone: string;
  working_hours: string;
  source_ids: string[];
};

const INITIAL_SOURCE: SourceFormState = {
  url: '',
  fetch_now: false,
};

const INITIAL_CLINIC: ClinicFormState = {
  name: '',
  city: '',
  address: '',
  phone: '',
  working_hours: '',
  source_ids: [],
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

function clinicTitle(source: SourceDetails) {
  return source.clinic_name || 'Без клиники';
}

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceDetails[]>([]);
  const [clinics, setClinics] = useState<ClinicRecord[]>([]);
  const [sourceForm, setSourceForm] = useState<SourceFormState>(INITIAL_SOURCE);
  const [clinicForm, setClinicForm] = useState<ClinicFormState>(INITIAL_CLINIC);
  const [intervalHours, setIntervalHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [savingSource, setSavingSource] = useState(false);
  const [savingClinic, setSavingClinic] = useState(false);
  const [savingScheduler, setSavingScheduler] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unassignedSources = useMemo(
    () => sources.filter((source) => !source.clinic_id),
    [sources],
  );

  const refresh = async () => {
    const [sourceData, clinicData, scheduler] = await Promise.all([
      listSources(),
      listClinics(),
      getSchedulerSettings(),
    ]);
    setSources(sourceData);
    setClinics(clinicData);
    setIntervalHours(scheduler.fetch_interval_hours);
  };

  useEffect(() => {
    refresh()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const submitSource = async (event: FormEvent) => {
    event.preventDefault();
    setSavingSource(true);
    setError(null);
    setMessage(null);
    try {
      const result = await createSource(sourceForm);
      setMessage(statusText(result.status));
      setSourceForm(INITIAL_SOURCE);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить URL');
    } finally {
      setSavingSource(false);
    }
  };

  const submitClinic = async (event: FormEvent) => {
    event.preventDefault();
    setSavingClinic(true);
    setError(null);
    setMessage(null);
    try {
      await createClinic(clinicForm);
      setMessage('Клиника создана, выбранные URL привязаны');
      setClinicForm(INITIAL_CLINIC);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать клинику');
    } finally {
      setSavingClinic(false);
    }
  };

  const saveScheduler = async () => {
    setSavingScheduler(true);
    setError(null);
    setMessage(null);
    try {
      const settings = await updateSchedulerSettings(intervalHours);
      setIntervalHours(settings.fetch_interval_hours);
      setMessage(`Автозапуск парсинга: каждые ${settings.fetch_interval_hours} ч.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось обновить scheduler');
    } finally {
      setSavingScheduler(false);
    }
  };

  const toggleSource = (sourceId: string) => {
    setClinicForm((prev) => ({
      ...prev,
      source_ids: prev.source_ids.includes(sourceId)
        ? prev.source_ids.filter((id) => id !== sourceId)
        : [...prev.source_ids, sourceId],
    }));
  };

  const runFetch = async (source: SourceDetails) => {
    setRunningId(source.id);
    setError(null);
    setMessage(null);
    try {
      const result = await triggerSourceFetch(source.id);
      setMessage(`${clinicTitle(source)}: ${statusText(result.status)}`);
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
          <h1 className="text-2xl font-bold text-slate-900">Источники и клиники</h1>
          <p className="text-sm text-slate-500 mt-1">URL добавляются отдельно, клиники связываются с ними при создании.</p>
        </div>

        {(message || error) && (
          <div className={`mb-5 text-sm rounded-lg px-4 py-3 border ${error ? 'bg-red-50 text-red-700 border-red-100' : 'bg-teal-50 text-teal-800 border-teal-100'}`}>
            {error || message}
          </div>
        )}

        <section className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 mb-6">
          <div className="flex flex-col md:flex-row md:items-end gap-4 justify-between">
            <div>
              <h2 className="font-semibold text-slate-800">Автозапуск парсинга</h2>
              <p className="text-sm text-slate-500 mt-1">API scheduler запускает fetch для всех URL по заданному интервалу.</p>
            </div>
            <div className="flex items-end gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-slate-500 uppercase mb-1">Интервал, часов</span>
                <input
                  value={intervalHours}
                  min={1}
                  type="number"
                  onChange={(e) => setIntervalHours(Number(e.target.value))}
                  className="w-32 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </label>
              <button
                type="button"
                disabled={savingScheduler || intervalHours < 1}
                onClick={saveScheduler}
                className="bg-slate-900 hover:bg-slate-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
              >
                {savingScheduler ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6 items-start">
          <div className="space-y-6">
            <form onSubmit={submitSource} className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4">
              <h2 className="font-semibold text-slate-800">Добавить URL</h2>
              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase mb-1">URL прайса или сайта</label>
                <input
                  value={sourceForm.url}
                  onChange={(e) => setSourceForm((prev) => ({ ...prev, url: e.target.value }))}
                  required
                  type="url"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  placeholder="https://example.kz/prices"
                />
              </div>
              <label className="flex items-center justify-between gap-3 text-sm text-slate-600 cursor-pointer">
                <span>Сразу запустить парсинг</span>
                <input
                  type="checkbox"
                  checked={sourceForm.fetch_now}
                  onChange={(e) => setSourceForm((prev) => ({ ...prev, fetch_now: e.target.checked }))}
                  className="w-4 h-4 accent-teal-500"
                />
              </label>
              <button
                type="submit"
                disabled={savingSource}
                className="w-full bg-teal-500 hover:bg-teal-600 disabled:bg-slate-300 text-white font-medium rounded-lg px-4 py-2.5 transition-colors"
              >
                {savingSource ? 'Сохранение...' : 'Добавить URL'}
              </button>
            </form>

            <form onSubmit={submitClinic} className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4">
              <h2 className="font-semibold text-slate-800">Создать клинику</h2>
              <input value={clinicForm.name} onChange={(e) => setClinicForm((prev) => ({ ...prev, name: e.target.value }))} required className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" placeholder="Название клиники" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input value={clinicForm.city} onChange={(e) => setClinicForm((prev) => ({ ...prev, city: e.target.value }))} className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" placeholder="Город" />
                <input value={clinicForm.phone} onChange={(e) => setClinicForm((prev) => ({ ...prev, phone: e.target.value }))} className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" placeholder="Телефон" />
              </div>
              <input value={clinicForm.address} onChange={(e) => setClinicForm((prev) => ({ ...prev, address: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" placeholder="Адрес" />
              <input value={clinicForm.working_hours} onChange={(e) => setClinicForm((prev) => ({ ...prev, working_hours: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" placeholder="09:00-18:00" />

              <div>
                <div className="text-xs font-medium text-slate-500 uppercase mb-2">Привязать URL</div>
                <div className="max-h-40 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-100">
                  {unassignedSources.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-slate-400">Нет свободных URL</div>
                  ) : unassignedSources.map((source) => (
                    <label key={source.id} className="flex items-start gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={clinicForm.source_ids.includes(source.id)}
                        onChange={() => toggleSource(source.id)}
                        className="mt-1 w-4 h-4 accent-teal-500"
                      />
                      <span className="break-all text-slate-600">{source.url}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={savingClinic}
                className="w-full bg-slate-900 hover:bg-slate-700 disabled:bg-slate-300 text-white font-medium rounded-lg px-4 py-2.5 transition-colors"
              >
                {savingClinic ? 'Создание...' : 'Создать клинику'}
              </button>
            </form>
          </div>

          <div className="space-y-6">
            <div className="bg-white border border-slate-100 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-800">URL источники</h2>
                <span className="text-xs text-slate-400">{sources.length}</span>
              </div>
              {loading ? (
                <div className="p-8 text-center text-slate-400 text-sm">Загрузка...</div>
              ) : sources.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm">URL пока нет</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {sources.map((source) => (
                    <div key={source.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-slate-800">{clinicTitle(source)}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${source.adapter_id ? 'bg-teal-50 text-teal-700' : 'bg-amber-50 text-amber-700'}`}>
                            {source.adapter_id ? 'adapter ready' : 'adapter pending'}
                          </span>
                          {!source.clinic_id && <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">free URL</span>}
                        </div>
                        <p className="text-sm text-slate-500 break-all mt-1">{source.url}</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {[source.city, source.address, source.phone].filter(Boolean).join(' · ') || 'Без данных клиники'}
                        </p>
                      </div>
                      <button
                        onClick={() => runFetch(source)}
                        disabled={runningId === source.id}
                        className="shrink-0 bg-slate-900 hover:bg-slate-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
                      >
                        {runningId === source.id ? 'Запуск...' : 'Fetch'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-100 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-800">Клиники</h2>
                <span className="text-xs text-slate-400">{clinics.length}</span>
              </div>
              {clinics.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm">Клиник пока нет</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {clinics.map((clinic) => (
                    <div key={clinic.id} className="p-5">
                      <h3 className="font-semibold text-slate-800">{clinic.name}</h3>
                      <p className="text-xs text-slate-400 mt-1">
                        {[clinic.city, clinic.address, clinic.phone].filter(Boolean).join(' · ') || 'Без дополнительных данных'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
