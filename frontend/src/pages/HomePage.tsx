import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SearchBar from '../components/SearchBar';
import { getStats } from '../api/api';

const QUICK = [
  { label: 'Общий анализ крови', query: 'Общий анализ крови' },
  { label: 'Биохимия крови', query: 'Биохимический анализ крови' },
  { label: 'УЗИ', query: 'УЗИ' },
  { label: 'МРТ', query: 'МРТ' },
  { label: 'Приём терапевта', query: 'Приём врача-терапевта' },
  { label: 'ЭКГ', query: 'Электрокардиография' },
  { label: 'Общий анализ мочи', query: 'Общий анализ мочи' },
  { label: 'Гастроскопия', query: 'Гастроскопия' },
];

const SOURCES = ['kdlolymp.kz', 'invitro.kz', 'helix.kz', 'doq.kz', 'olymp.kz', 'medel.kz', 'emirmed.kz', 'mck.kz'];

const STEPS = [
  { n: '01', t: 'Введите услугу', d: 'Поиск с автодополнением по нормализованному справочнику услуг.' },
  { n: '02', t: 'Отфильтруйте', d: 'Город, категория, ценовой диапазон, сортировка по цене и дате.' },
  { n: '03', t: 'Сравните', d: 'Цены клиник в одном списке. Добавьте в сравнение и выберите выгодное.' },
];

export default function HomePage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ totalPrices: 0, totalClinics: 0 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getStats().then((s) => { setStats(s); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);

  const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(n);

  return (
    <div className="bg-neutral-50">
      {/* Hero */}
      <section className="border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-16 pb-12">
          <div className="inline-flex items-center gap-2 border border-neutral-300 px-2.5 py-1 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="label">Цены на медуслуги · Казахстан</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-neutral-900 tracking-tight leading-[1.05] max-w-3xl">
            Сравнение цен на медицинские услуги
          </h1>
          <p className="text-neutral-500 mt-4 max-w-xl text-[15px] leading-relaxed">
            Собираем актуальные прайсы клиник, нормализуем названия к единому справочнику и
            показываем в одном списке. Aviasales, только для медицины.
          </p>

          <div className="mt-8 max-w-3xl">
            <SearchBar />
          </div>
        </div>

        {/* Stats strip */}
        <div className="border-t border-neutral-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 grid grid-cols-2 sm:grid-cols-4 divide-x divide-neutral-200 border-x border-neutral-200">
            {[
              { v: loaded ? fmt(stats.totalPrices) : '—', l: 'цен в базе' },
              { v: loaded ? fmt(stats.totalClinics) : '—', l: 'клиник' },
              { v: '10+', l: 'городов' },
              { v: String(SOURCES.length), l: 'источников' },
            ].map((s) => (
              <div key={s.l} className="px-4 py-5">
                <p className="font-mono text-2xl font-semibold text-neutral-900">{s.v}</p>
                <p className="label mt-1">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Popular */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <h2 className="label mb-4">Популярные услуги</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-neutral-200 border border-neutral-200">
          {QUICK.map((c) => (
            <button
              key={c.label}
              onClick={() => navigate(`/search?query=${encodeURIComponent(c.query)}`)}
              className="bg-white px-4 py-5 text-left hover:bg-neutral-100 transition-colors group"
            >
              <span className="text-sm font-medium text-neutral-900">{c.label}</span>
              <span className="block text-neutral-300 group-hover:text-neutral-900 transition-colors mt-2">→</span>
            </button>
          ))}
        </div>
      </section>

      {/* Sources + How it works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 grid lg:grid-cols-2 gap-px bg-neutral-200 border border-neutral-200">
        <div className="bg-white p-6">
          <h2 className="label mb-4">Источники данных</h2>
          <div className="grid grid-cols-2 gap-px bg-neutral-200 border border-neutral-200">
            {SOURCES.map((s) => (
              <div key={s} className="bg-white px-3 py-2.5 font-mono text-xs text-neutral-700 flex items-center gap-2">
                <span className="w-1 h-1 bg-neutral-900" /> {s}
              </div>
            ))}
          </div>
          <p className="text-xs text-neutral-400 mt-4">Только открытые публичные данные. Соблюдаем robots.txt и задержки между запросами.</p>
        </div>

        <div className="bg-white p-6">
          <h2 className="label mb-4">Как это работает</h2>
          <div className="divide-y divide-neutral-200 border-y border-neutral-200">
            {STEPS.map((s) => (
              <div key={s.n} className="flex gap-4 py-4">
                <span className="font-mono text-sm text-neutral-400">{s.n}</span>
                <div>
                  <p className="text-sm font-medium text-neutral-900">{s.t}</p>
                  <p className="text-sm text-neutral-500 mt-0.5 leading-relaxed">{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
