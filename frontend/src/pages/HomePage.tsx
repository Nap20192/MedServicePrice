import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SearchBar from '../components/SearchBar';
import { getStats } from '../api/api';

const QUICK_CATEGORIES = [
  { icon: '🩸', label: 'Общий анализ крови', query: 'Общий анализ крови', color: 'from-red-50 to-rose-50 border-red-100 hover:border-red-300' },
  { icon: '🦠', label: 'ПЦР-тесты', query: 'ПЦР-тест', color: 'from-purple-50 to-violet-50 border-purple-100 hover:border-purple-300' },
  { icon: '🧲', label: 'МРТ', query: 'МРТ', color: 'from-blue-50 to-indigo-50 border-blue-100 hover:border-blue-300' },
  { icon: '📡', label: 'УЗИ', query: 'УЗИ', color: 'from-teal-50 to-cyan-50 border-teal-100 hover:border-teal-300' },
  { icon: '👨‍⚕️', label: 'Приём терапевта', query: 'Приём терапевта', color: 'from-green-50 to-emerald-50 border-green-100 hover:border-green-300' },
  { icon: '🧬', label: 'Биохимия крови', query: 'Биохимический анализ крови', color: 'from-amber-50 to-yellow-50 border-amber-100 hover:border-amber-300' },
];

const HOW_IT_WORKS = [
  { step: '1', title: 'Введите название', desc: 'Напишите услугу в строке поиска — мы покажем нормализованное название и подскажем варианты.' },
  { step: '2', title: 'Выберите параметры', desc: 'Настройте фильтры: город, ценовой диапазон, срок выполнения и наличие онлайн-записи.' },
  { step: '3', title: 'Сравните и выберите', desc: 'Добавьте понравившиеся предложения в корзину сравнения и найдите лучший вариант.' },
];

export default function HomePage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ totalPrices: 0, totalClinics: 0 });
  const [statsLoaded, setStatsLoaded] = useState(false);

  useEffect(() => {
    getStats().then((s) => {
      setStats(s);
      setStatsLoaded(true);
    });
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-white">
      {/* Hero section */}
      <section className="relative overflow-hidden">
        {/* Background decorations */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-teal-100/40 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-primary-100/30 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-radial from-teal-50/50 to-transparent rounded-full" />
        </div>

        <div className="relative max-w-4xl mx-auto px-4 pt-20 pb-16 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-teal-50 border border-teal-200 text-teal-700 px-4 py-1.5 rounded-full text-sm font-medium mb-8 animate-fade-in">
            <span className="w-2 h-2 bg-teal-400 rounded-full animate-pulse-soft" />
            Сервис цен на медицинские услуги в Казахстане
          </div>

          {/* Heading */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 leading-tight mb-6 animate-fade-in">
            Найдите лучшую цену на{' '}
            <span className="relative">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-500 to-primary-600">
                медицинские услуги
              </span>
            </span>{' '}
            в Казахстане
          </h1>

          <p className="text-lg sm:text-xl text-slate-500 mb-12 max-w-2xl mx-auto animate-fade-in">
            Сравниваем цены в{' '}
            <span className="font-semibold text-slate-700">50+ клиниках</span>{' '}
            Алматы, Астаны, Шымкента и других городов — как Aviasales, только для медицины.
          </p>

          {/* Search module */}
          <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/60 border border-slate-100 p-5 sm:p-6 max-w-3xl mx-auto animate-slide-up">
            <SearchBar />
          </div>

          {/* Stats */}
          <div className="flex items-center justify-center gap-8 mt-10 animate-fade-in">
            {[
              { value: statsLoaded ? stats.totalPrices.toLocaleString('ru-RU') : '—', label: 'цен обновлено сегодня' },
              { value: statsLoaded ? stats.totalClinics.toString() : '—', label: 'клиник проверено' },
              { value: '5', label: 'городов Казахстана' },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-2xl font-bold text-slate-800">{s.value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Quick categories */}
      <section className="max-w-5xl mx-auto px-4 py-16">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Популярные услуги</h2>
          <p className="text-slate-400 text-sm">Нажмите для быстрого поиска</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {QUICK_CATEGORIES.map((cat) => (
            <button
              key={cat.label}
              onClick={() => navigate(`/search?query=${encodeURIComponent(cat.query)}`)}
              className={`flex flex-col items-center gap-3 p-5 rounded-2xl border bg-gradient-to-br ${cat.color} transition-all hover:shadow-md hover:-translate-y-1 active:translate-y-0 group`}
              id={`quick-cat-${cat.label.replace(/\s+/g, '-').toLowerCase()}`}
            >
              <span className="text-3xl group-hover:scale-110 transition-transform">{cat.icon}</span>
              <span className="text-xs font-semibold text-slate-700 text-center leading-snug">{cat.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-slate-50 py-16">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Как это работает</h2>
            <p className="text-slate-400">Три простых шага до выгодной медицинской услуги</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map((step) => (
              <div key={step.step} className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-400 to-primary-600 flex items-center justify-center text-white text-xl font-bold mx-auto mb-4 shadow-md shadow-teal-200">
                  {step.step}
                </div>
                <h3 className="font-semibold text-slate-800 mb-2">{step.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust block / ticker */}
      <section className="py-12 border-t border-slate-100">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <p className="text-slate-400 text-sm mb-6">Мы собираем данные из открытых источников</p>
          <div className="flex flex-wrap items-center justify-center gap-6 opacity-50">
            {['KDL Олимп', 'Invitro', 'Helix', 'МЕДЭЛ', 'МЦК', 'DOQ', 'Аксай Клиник'].map((name) => (
              <span key={name} className="font-semibold text-slate-600 text-sm px-3 py-1.5 bg-slate-100 rounded-lg">{name}</span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
