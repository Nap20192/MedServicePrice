import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  addBranches,
  attachSourceToClinic,
  createClinic,
  createSource,
  getSchedulerSettings,
  importGooglePlaceClinic,
  listClinics,
  listSources,
  rebuildSourceAdapter,
  searchGooglePlacesClinics,
  triggerSourceFetch,
  updateSchedulerSettings,
} from '../api/api';
import { ClinicRecord, GooglePlaceClinicCandidate, SourceDetails } from '../types';
import BranchMapPicker from '../components/BranchMapPicker';

const emptyClinic = {
  name: '',
  city: '',
  address: '',
  phone: '',
  working_hours: '',
  url: '',
};

const field = 'border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-900';
const buttonDark = 'border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:border-neutral-300 disabled:bg-neutral-300 transition-colors';
const buttonLight = 'border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:border-neutral-900 hover:text-neutral-900 disabled:opacity-40 transition-colors';

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

function sourceHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceDetails[]>([]);
  const [clinics, setClinics] = useState<ClinicRecord[]>([]);
  const [urls, setUrls] = useState('');
  const [fetchNow, setFetchNow] = useState(true);
  const [intervalHours, setIntervalHours] = useState(24);
  const [clinicForm, setClinicForm] = useState(emptyClinic);
  const [clinicSourceID, setClinicSourceID] = useState('');
  const [googlePlacesQuery, setGooglePlacesQuery] = useState('');
  const [googlePlacesLocation, setGooglePlacesLocation] = useState('76.92861,43.23895');
  const [googlePlacesSourceID, setGooglePlacesSourceID] = useState('');
  const [googlePlacesResults, setGooglePlacesResults] = useState<GooglePlaceClinicCandidate[]>([]);
  const [branchSourceID, setBranchSourceID] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchLines, setBranchLines] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingClinic, setSavingClinic] = useState(false);
  const [searchingGooglePlaces, setSearchingGooglePlaces] = useState(false);
  const [savingScheduler, setSavingScheduler] = useState(false);
  const [savingBranches, setSavingBranches] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => ({
    sources: sources.length,
    adapters: sources.filter((s) => s.adapter_id).length,
    linked: sources.filter((s) => s.clinic_id).length,
    clinics: clinics.length,
  }), [sources, clinics]);

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

  const submitUrls = async (event: FormEvent) => {
    event.preventDefault();
    const list = urls.split('\n').map((u) => u.trim()).filter(Boolean);
    if (list.length === 0) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const results = await Promise.allSettled(list.map((url) => createSource({ url, fetch_now: fetchNow })));
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      setMessage(`URL добавлены: ${ok}${results.length - ok ? `, ошибок: ${results.length - ok}` : ''}`);
      setUrls('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить URL');
    } finally {
      setSaving(false);
    }
  };

  const submitClinic = async (event: FormEvent) => {
    event.preventDefault();
    setSavingClinic(true);
    setError(null);
    setMessage(null);
    try {
      const clinic = await createClinic({
        ...clinicForm,
        source_ids: clinicSourceID ? [clinicSourceID] : [],
      });
      setMessage(`Клиника добавлена: ${clinic.name}`);
      setClinicForm(emptyClinic);
      setClinicSourceID('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить клинику');
    } finally {
      setSavingClinic(false);
    }
  };

  const searchGooglePlaces = async (event: FormEvent) => {
    event.preventDefault();
    if (!googlePlacesQuery.trim()) return;
    setSearchingGooglePlaces(true);
    setError(null);
    setMessage(null);
    try {
      const results = await searchGooglePlacesClinics(googlePlacesQuery, googlePlacesLocation);
      setGooglePlacesResults(results);
      setMessage(`Google Maps: найдено ${results.length}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google Maps поиск не сработал');
    } finally {
      setSearchingGooglePlaces(false);
    }
  };

  const importGooglePlaces = async (candidate: GooglePlaceClinicCandidate) => {
    setBusyId(candidate.id);
    setError(null);
    setMessage(null);
    try {
      const clinic = await importGooglePlaceClinic(candidate.id, googlePlacesSourceID ? [googlePlacesSourceID] : []);
      setMessage(`Импортировано из Google Maps: ${clinic.name}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось импортировать из Google Maps');
    } finally {
      setBusyId(null);
    }
  };

  const submitBranches = async (event: FormEvent) => {
    event.preventDefault();
    if (!branchSourceID || !branchName.trim()) return;
    const branches = branchLines
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [city, ...rest] = line.split(/[;,\t]/).map((s) => s.trim());
        return { city: city || undefined, address: rest.join(', ') || undefined };
      });
    if (branches.length === 0) return;
    setSavingBranches(true);
    setError(null);
    setMessage(null);
    try {
      const created = await addBranches(branchSourceID, branchName.trim(), branches);
      setMessage(`Филиалы созданы: ${created.length}`);
      setBranchLines('');
      setBranchName('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать филиалы');
    } finally {
      setSavingBranches(false);
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
      setMessage(`${sourceHost(source.url)}: ${ok} (${statusText(result.status)})`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyId(null);
    }
  };

  const attach = async (sourceID: string, clinicID: string) => {
    if (!clinicID) return;
    setBusyId(sourceID);
    setError(null);
    setMessage(null);
    try {
      const source = await attachSourceToClinic(sourceID, clinicID);
      setMessage(`Источник привязан: ${source.clinic_name || clinicID}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось привязать клинику');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="border-b border-neutral-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-7">
          <p className="label">Data operations</p>
          <div className="mt-2 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Источники, клиники, импорт</h1>
              <p className="mt-1 text-sm text-neutral-500 max-w-3xl">
                URL прайсов живут отдельно от клиник. Клиника создаётся вручную или импортируется из Google Maps, затем связывается с источником.
              </p>
            </div>
            <div className="grid grid-cols-4 border border-neutral-200 divide-x divide-neutral-200 bg-white">
              {[
                ['URL', stats.sources],
                ['Adapters', stats.adapters],
                ['Linked', stats.linked],
                ['Clinics', stats.clinics],
              ].map(([label, value]) => (
                <div key={label} className="px-4 py-3 min-w-24">
                  <p className="font-mono text-lg font-semibold text-neutral-900">{value}</p>
                  <p className="label mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {(message || error) && (
          <div className={`mb-5 border px-4 py-3 text-sm ${error ? 'border-red-300 bg-red-50 text-red-700' : 'border-blue-300 bg-blue-50 text-blue-800'}`}>
            {error || message}
          </div>
        )}

        <div className="grid xl:grid-cols-[1.05fr_0.95fr] gap-px bg-neutral-200 border border-neutral-200 mb-6">
          <form onSubmit={submitUrls} className="bg-white p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="label">Crawler input</p>
                <h2 className="font-semibold text-neutral-900">Добавить URL прайса</h2>
              </div>
              <label className="flex items-center gap-2 text-sm text-neutral-600 cursor-pointer">
                <input type="checkbox" checked={fetchNow} onChange={(e) => setFetchNow(e.target.checked)} className="accent-neutral-900" />
                fetch сразу
              </label>
            </div>
            <textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              required
              rows={6}
              className={`${field} w-full font-mono`}
              placeholder={'https://invitro.kz\nhttps://kdlolymp.kz\nhttps://example.kz/prices'}
            />
            <div className="flex justify-end">
              <button type="submit" disabled={saving} className={buttonDark}>{saving ? 'Добавление...' : 'Добавить URL'}</button>
            </div>
          </form>

          <form onSubmit={submitClinic} className="bg-white p-5 space-y-4">
            <div>
              <p className="label">Clinic record</p>
              <h2 className="font-semibold text-neutral-900">Создать клинику вручную</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <input required value={clinicForm.name} onChange={(e) => setClinicForm({ ...clinicForm, name: e.target.value })} className={field} placeholder="Название" />
              <input value={clinicForm.city} onChange={(e) => setClinicForm({ ...clinicForm, city: e.target.value })} className={field} placeholder="Город" />
              <input value={clinicForm.address} onChange={(e) => setClinicForm({ ...clinicForm, address: e.target.value })} className={field} placeholder="Адрес" />
              <input value={clinicForm.phone} onChange={(e) => setClinicForm({ ...clinicForm, phone: e.target.value })} className={field} placeholder="Телефон" />
              <input value={clinicForm.working_hours} onChange={(e) => setClinicForm({ ...clinicForm, working_hours: e.target.value })} className={field} placeholder="Часы работы" />
              <input value={clinicForm.url} onChange={(e) => setClinicForm({ ...clinicForm, url: e.target.value })} className={field} placeholder="Сайт" />
            </div>
            <select value={clinicSourceID} onChange={(e) => setClinicSourceID(e.target.value)} className={`${field} w-full`}>
              <option value="">Не привязывать источник сейчас</option>
              {sources.map((source) => <option key={source.id} value={source.id}>{source.url}</option>)}
            </select>
            <div className="flex justify-end">
              <button type="submit" disabled={savingClinic} className={buttonDark}>{savingClinic ? 'Сохранение...' : 'Создать клинику'}</button>
            </div>
          </form>
        </div>

        <section className="bg-white border border-neutral-200 p-5 mb-6 flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
          <div>
            <p className="label">Scheduler</p>
            <h2 className="font-semibold text-neutral-900">Автозапуск fetch</h2>
            <p className="text-sm text-neutral-500 mt-1">По умолчанию раз в сутки. Интервал хранится в БД и меняется из UI.</p>
          </div>
          <div className="flex items-end gap-3">
            <label className="block">
              <span className="label block mb-1">Интервал, часов</span>
              <input value={intervalHours} min={1} type="number" onChange={(e) => setIntervalHours(Number(e.target.value))} className={`${field} w-32 font-mono`} />
            </label>
            <button type="button" disabled={savingScheduler || intervalHours < 1} onClick={saveScheduler} className={buttonDark}>{savingScheduler ? '...' : 'Сохранить'}</button>
          </div>
        </section>

        <div className="mb-6">
          <BranchMapPicker
            sources={sources}
            onDone={refresh}
            notify={(msg, isError) => { if (isError) { setError(msg); setMessage(null); } else { setMessage(msg); setError(null); } }}
          />
        </div>

        <section className="bg-white border border-neutral-200 overflow-x-auto">
          <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
            <div>
              <p className="label">Source registry</p>
              <h2 className="font-semibold text-neutral-900">Источники</h2>
            </div>
            <button type="button" onClick={() => refresh().catch((err) => setError(err.message))} className={buttonLight}>Обновить</button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-neutral-400">Загрузка...</div>
          ) : sources.length === 0 ? (
            <div className="p-8 text-center text-sm text-neutral-400">Источников пока нет</div>
          ) : (
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr>
                  <th className="label text-left font-normal px-4 py-2.5">Источник</th>
                  <th className="label text-left font-normal px-4 py-2.5">Клиника</th>
                  <th className="label text-left font-normal px-4 py-2.5">Adapter</th>
                  <th className="label text-left font-normal px-4 py-2.5">Привязка</th>
                  <th className="label text-right font-normal px-4 py-2.5">Команды</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {sources.map((source) => (
                  <tr key={source.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 align-top">
                      <p className="font-medium text-neutral-900">{sourceHost(source.url)}</p>
                      <p className="mt-1 max-w-sm break-all font-mono text-xs text-neutral-500">{source.url}</p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <p className="text-neutral-900">{source.clinic_name || '-'}</p>
                      <p className="mt-1 text-xs text-neutral-500">{[source.city, source.address].filter(Boolean).join(' · ') || 'адрес не указан'}</p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`inline-flex border px-2 py-1 font-mono text-[11px] ${source.adapter_id ? 'border-blue-300 text-blue-700 bg-blue-50' : 'border-amber-300 text-amber-700 bg-amber-50'}`}>
                        {source.adapter_id ? 'ready' : 'pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <select value={source.clinic_id || ''} disabled={busyId === source.id || clinics.length === 0} onChange={(e) => attach(source.id, e.target.value)} className={`${field} w-64`}>
                        <option value="">Выбрать клинику</option>
                        {clinics.map((clinic) => (
                          <option key={clinic.id} value={clinic.id}>{clinic.name}{clinic.city ? `, ${clinic.city}` : ''}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex justify-end gap-px">
                        <button onClick={() => act(source, rebuildSourceAdapter, 'адаптер обновляется')} disabled={busyId === source.id} title="Перестроить адаптер" className={buttonLight}>
                          Adapter
                        </button>
                        <button onClick={() => act(source, triggerSourceFetch, 'парсинг запущен')} disabled={busyId === source.id} className={buttonDark}>
                          {busyId === source.id ? '...' : 'Fetch'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
