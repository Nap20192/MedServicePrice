import React, { FormEvent, useEffect, useState } from 'react';
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
import { ClinicRecord, SourceDetails, GooglePlaceClinicCandidate } from '../types';

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

const emptyClinic = {
  name: '',
  city: '',
  address: '',
  phone: '',
  working_hours: '',
  url: '',
};

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceDetails[]>([]);
  const [clinics, setClinics] = useState<ClinicRecord[]>([]);
  const [urls, setUrls] = useState('');
  const [inlineClinic, setInlineClinic] = useState('');
  const [fetchNow, setFetchNow] = useState(true);
  const [intervalHours, setIntervalHours] = useState(24);
  const [clinicForm, setClinicForm] = useState(emptyClinic);
  const [clinicSourceID, setClinicSourceID] = useState('');
  const [googlePlacesQuery, setGooglePlacesQuery] = useState('');
  const [googlePlacesLocation, setGooglePlacesLocation] = useState('76.92861,43.23895');
  const [googlePlacesSourceID, setGooglePlacesSourceID] = useState('');
  const [googlePlacesResults, setGooglePlacesResults] = useState<GooglePlaceClinicCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingClinic, setSavingClinic] = useState(false);
  const [searchingGooglePlaces, setSearchingGooglePlaces] = useState(false);
  const [savingScheduler, setSavingScheduler] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Bulk branches (clinic network)
  const [branchSourceID, setBranchSourceID] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchLines, setBranchLines] = useState('');
  const [savingBranches, setSavingBranches] = useState(false);

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
      const results = await Promise.allSettled(
        list.map((url) => createSource({ url, fetch_now: fetchNow })),
      );
      const created = results
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createSource>>> => r.status === 'fulfilled')
        .map((r) => r.value.source.id);
      const failed = results.length - created.length;

      // Optional inline clinic: create it once and attach every new source to it.
      let clinicNote = '';
      const clinicName = inlineClinic.trim();
      if (clinicName && created.length > 0) {
        const clinic = await createClinic({ ...emptyClinic, name: clinicName, source_ids: created });
        clinicNote = `, клиника «${clinic.name}» привязана`;
      }

      setMessage(`Добавлено ${created.length} URL${failed ? `, ошибок: ${failed}` : ''}${clinicNote}`);
      setUrls('');
      setInlineClinic('');
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

  // Each line: "Город; Адрес" → one branch clinic. All share branchName + the source.
  const submitBranches = async (event: FormEvent) => {
    event.preventDefault();
    if (!branchSourceID || !branchName.trim()) return;
    const branches = branchLines
      .split('\n')
      .map((l) => l.trim())
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
      setMessage(`Создано филиалов: ${created.length} (сеть «${branchName.trim()}»)`);
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
      setMessage(`${source.url}: ${ok} (${statusText(result.status)})`);
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
      setMessage(`Источник привязан к клинике: ${source.clinic_name || clinicID}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось привязать клинику');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Источники и клиники</h1>
          <p className="text-sm text-slate-500 mt-1">
            URL прайсов добавляются отдельно. Клиники можно создать вручную или импортировать из Google Maps, а потом привязать к источнику.
          </p>
        </div>

        {(message || error) && (
          <div className={`mb-5 text-sm rounded-lg px-4 py-3 border ${error ? 'bg-red-50 text-red-700 border-red-100' : 'bg-teal-50 text-teal-800 border-teal-100'}`}>
            {error || message}
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-6 mb-6">
          <form onSubmit={submitUrls} className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4">
            <h2 className="font-semibold text-slate-800">Добавить URL</h2>
            <textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              required
              rows={5}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-400"
              placeholder={'https://invitro.kz\nhttps://kdlolymp.kz\nhttps://example.kz/prices'}
            />
            <div>
              <input
                value={inlineClinic}
                onChange={(e) => setInlineClinic(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                placeholder="Название клиники (необязательно)"
              />
              <p className="text-xs text-slate-400 mt-1">Если указать — создастся клиника и привяжется ко всем добавленным URL.</p>
            </div>
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
          </form>

          <form onSubmit={submitClinic} className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4">
            <h2 className="font-semibold text-slate-800">Создать клинику вручную</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <input required value={clinicForm.name} onChange={(e) => setClinicForm({ ...clinicForm, name: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Название" />
              <input value={clinicForm.city} onChange={(e) => setClinicForm({ ...clinicForm, city: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Город" />
              <input value={clinicForm.address} onChange={(e) => setClinicForm({ ...clinicForm, address: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Адрес" />
              <input value={clinicForm.phone} onChange={(e) => setClinicForm({ ...clinicForm, phone: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Телефон" />
              <input value={clinicForm.working_hours} onChange={(e) => setClinicForm({ ...clinicForm, working_hours: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Часы работы" />
              <input value={clinicForm.url} onChange={(e) => setClinicForm({ ...clinicForm, url: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Сайт" />
            </div>
            <select value={clinicSourceID} onChange={(e) => setClinicSourceID(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <option value="">Не привязывать источник сейчас</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>{source.url}</option>
              ))}
            </select>
            <button type="submit" disabled={savingClinic} className="bg-slate-900 hover:bg-slate-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg px-4 py-2">
              {savingClinic ? 'Сохранение...' : 'Создать клинику'}
            </button>
          </form>
        </div>

        {/* Bulk branches: a clinic network sharing one source's service pool */}
        <form onSubmit={submitBranches} className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4 mb-6">
          <div>
            <h2 className="font-semibold text-slate-800">Филиалы сети</h2>
            <p className="text-sm text-slate-500 mt-1">Много клиник с одним именем, общий пул услуг источника. Цены филиала — по его городу.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <select value={branchSourceID} onChange={(e) => setBranchSourceID(e.target.value)} required className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <option value="">Источник сети…</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.url}</option>
              ))}
            </select>
            <input value={branchName} onChange={(e) => setBranchName(e.target.value)} required placeholder="Имя сети (для всех филиалов)" className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <textarea
            value={branchLines}
            onChange={(e) => setBranchLines(e.target.value)}
            required
            rows={4}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            placeholder={'Алматы; ул. Абая 1\nАстана; пр. Кабанбай 2\nШымкент; ул. Тауке хана 5'}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-400">По строке на филиал: «Город; Адрес».</p>
            <button type="submit" disabled={savingBranches} className="bg-teal-500 hover:bg-teal-600 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg px-5 py-2">
              {savingBranches ? 'Создание...' : 'Создать филиалы'}
            </button>
          </div>
        </form>

        <section className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 mb-6">
          <div className="flex flex-col lg:flex-row lg:items-end gap-4 justify-between mb-4">
            <form onSubmit={searchGooglePlaces} className="flex-1 grid sm:grid-cols-[1fr_220px_auto] gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-slate-500 uppercase mb-1">Google Maps поиск</span>
                <input value={googlePlacesQuery} onChange={(e) => setGooglePlacesQuery(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="invitro Алматы" />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-slate-500 uppercase mb-1">Локация lon,lat</span>
                <input value={googlePlacesLocation} onChange={(e) => setGooglePlacesLocation(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="76.92861,43.23895" />
              </label>
              <button type="submit" disabled={searchingGooglePlaces} className="bg-teal-500 hover:bg-teal-600 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg px-4 py-2">
                {searchingGooglePlaces ? 'Поиск...' : 'Найти'}
              </button>
            </form>
            <select value={googlePlacesSourceID} onChange={(e) => setGooglePlacesSourceID(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <option value="">Импорт без привязки</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>{source.url}</option>
              ))}
            </select>
          </div>
          <div className="divide-y divide-slate-100">
            {googlePlacesResults.map((item) => (
              <div key={item.id} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">{item.name}</p>
                  <p className="text-sm text-slate-500">{[item.city, item.address, item.phone].filter(Boolean).join(' · ')}</p>
                  {(item.rating || item.working_hours) && (
                    <p className="text-xs text-slate-400 mt-1">{[item.rating ? `рейтинг ${item.rating}` : '', item.working_hours].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
                <button type="button" disabled={busyId === item.id} onClick={() => importGooglePlaces(item)} className="border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-sm font-medium rounded-lg px-3 py-2">
                  {busyId === item.id ? '...' : 'Импорт'}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 mb-6 flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
          <div>
            <h2 className="font-semibold text-slate-800">Автозапуск парсинга</h2>
            <p className="text-sm text-slate-500 mt-1">Scheduler запускает fetch всех источников по интервалу.</p>
          </div>
          <div className="flex items-end gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-slate-500 uppercase mb-1">Интервал, часов</span>
              <input value={intervalHours} min={1} type="number" onChange={(e) => setIntervalHours(Number(e.target.value))} className="w-28 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
            </label>
            <button type="button" disabled={savingScheduler || intervalHours < 1} onClick={saveScheduler} className="bg-slate-900 hover:bg-slate-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">
              {savingScheduler ? '...' : 'Сохранить'}
            </button>
          </div>
        </section>

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
                <div key={source.id} className="p-5 grid lg:grid-cols-[1fr_260px_auto] gap-3 lg:items-center">
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
                    {source.address && <p className="text-xs text-slate-400 mt-1">{source.address}</p>}
                  </div>
                  <select value={source.clinic_id || ''} disabled={busyId === source.id || clinics.length === 0} onChange={(e) => attach(source.id, e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
                    <option value="">Выбрать клинику</option>
                    {clinics.map((clinic) => (
                      <option key={clinic.id} value={clinic.id}>{clinic.name}{clinic.city ? `, ${clinic.city}` : ''}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => act(source, rebuildSourceAdapter, 'адаптер обновляется')} disabled={busyId === source.id} title="Перестроить адаптер (rediscover)" className="border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-600 text-sm font-medium rounded-lg px-3 py-2 transition-colors">
                      ↻ Адаптер
                    </button>
                    <button onClick={() => act(source, triggerSourceFetch, 'парсинг запущен')} disabled={busyId === source.id} className="bg-slate-900 hover:bg-slate-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">
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
