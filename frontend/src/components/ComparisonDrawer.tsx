import React from 'react';
import { useComparison } from '../context/ComparisonContext';
import { formatPrice } from '../utils/format';

export default function ComparisonDrawer() {
  const { items, removeItem, clearAll, isOpen, setIsOpen } = useComparison();

  if (items.length === 0) return null;

  return (
    <>
      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up">
        <div className="bg-white border-t border-teal-200 shadow-2xl shadow-teal-900/10">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 bg-teal-500 rounded-full text-white font-bold text-sm">
                {items.length}
              </div>
              <p className="text-slate-700 font-medium text-sm">
                {items.length === 1 ? 'услуга' : items.length < 5 ? 'услуги' : 'услуг'} для сравнения
              </p>
              <div className="hidden sm:flex gap-2 flex-wrap">
                {items.map((item) => (
                  <span key={item.service_id} className="inline-flex items-center gap-1 bg-teal-50 text-teal-700 text-xs px-2 py-1 rounded-lg">
                    {item.clinic_name}
                    <button
                      onClick={() => removeItem(item.service_id)}
                      className="hover:text-red-500 transition-colors ml-1 font-bold"
                    >×</button>
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={clearAll}
                className="text-xs text-slate-400 hover:text-red-500 transition-colors px-2 py-1 rounded"
                id="comparison-clear-btn"
              >
                Очистить
              </button>
              <button
                onClick={() => setIsOpen(true)}
                className="bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
                id="comparison-open-btn"
              >
                Сравнить →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setIsOpen(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden animate-slide-up">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-800">Сравнение услуг</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-400 hover:text-slate-600"
                id="comparison-modal-close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Table */}
            <div className="overflow-auto p-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2 pr-4 text-slate-500 font-medium w-40">Параметр</th>
                    {items.map((item) => (
                      <th key={item.service_id} className="text-left py-2 px-3 min-w-[180px]">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-800">{item.clinic_name}</p>
                            <p className="text-xs text-slate-400 font-normal">{item.city}</p>
                          </div>
                          <button
                            onClick={() => removeItem(item.service_id)}
                            className="text-slate-300 hover:text-red-400 transition-colors shrink-0 text-lg leading-none font-bold"
                          >×</button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  <tr>
                    <td className="py-3 pr-4 text-slate-500">Услуга</td>
                    {items.map((item) => (
                      <td key={item.service_id} className="py-3 px-3 font-medium text-slate-800">
                        {item.service_name_norm}
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-teal-50/50">
                    <td className="py-3 pr-4 text-slate-500 font-medium">💰 Цена</td>
                    {items.map((item) => {
                      const minPrice = Math.min(...items.map(i => i.price_kzt));
                      const isCheapest = item.price_kzt === minPrice;
                      return (
                        <td key={item.service_id} className="py-3 px-3">
                          <span className={`text-lg font-bold ${isCheapest ? 'text-teal-600' : 'text-slate-800'}`}>
                            {formatPrice(item.price_kzt)}
                          </span>
                          {isCheapest && items.length > 1 && (
                            <span className="ml-1 text-xs bg-teal-100 text-teal-600 px-1.5 py-0.5 rounded-full">Дешевле</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 text-slate-500">📍 Адрес</td>
                    {items.map((item) => (
                      <td key={item.service_id} className="py-3 px-3 text-slate-600">{item.address}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 text-slate-500">⏱ Режим работы</td>
                    {items.map((item) => (
                      <td key={item.service_id} className="py-3 px-3 text-slate-600">{item.working_hours}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 text-slate-500">🧪 Срок</td>
                    {items.map((item) => (
                      <td key={item.service_id} className="py-3 px-3 text-slate-600">
                        {item.duration_days ? `${item.duration_days} дн.` : 'В день обращения'}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 text-slate-500">📱 Онлайн-запись</td>
                    {items.map((item) => (
                      <td key={item.service_id} className="py-3 px-3">
                        {item.online_booking
                          ? <span className="text-green-600 font-medium">✓ Есть</span>
                          : <span className="text-slate-400">—</span>
                        }
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 text-slate-500">🔗 Источник</td>
                    {items.map((item) => (
                      <td key={item.service_id} className="py-3 px-3">
                        <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="text-teal-500 hover:underline text-xs truncate block max-w-[160px]">
                          Открыть ↗
                        </a>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>

              {/* Total for multiple services */}
              {items.length > 1 && (
                <div className="mt-6 p-4 bg-slate-50 rounded-xl">
                  <p className="text-slate-500 text-sm mb-1">Суммарная стоимость выбранных услуг:</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {formatPrice(items.reduce((sum, i) => sum + i.price_kzt, 0))}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
