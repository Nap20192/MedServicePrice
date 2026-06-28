import React from 'react';
import { useComparison } from '../context/ComparisonContext';
import { formatParsedAt, formatPrice, isPriceStale } from '../utils/format';

export default function ComparisonDrawer() {
  const { items, removeItem, clearAll, isOpen, setIsOpen } = useComparison();

  if (items.length === 0) return null;

  const minPrice = Math.min(...items.map((i) => i.price_kzt));

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up border-t border-neutral-900 bg-white">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="label">Сравнение</p>
            <p className="text-sm text-neutral-900 truncate">
              <span className="font-mono font-semibold">{items.length}</span> услуг · {items.map((item) => item.clinic_name).join(' / ')}
            </p>
          </div>
          <div className="flex items-center gap-px border border-neutral-300 divide-x divide-neutral-300 bg-white">
            <button
              onClick={clearAll}
              className="px-3 py-2 text-xs text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
              id="comparison-clear-btn"
            >
              Очистить
            </button>
            <button
              onClick={() => setIsOpen(true)}
              className="px-4 py-2 text-xs bg-neutral-900 text-white hover:bg-neutral-700 transition-colors"
              id="comparison-open-btn"
            >
              Открыть таблицу
            </button>
          </div>
        </div>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/45 flex items-end sm:items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setIsOpen(false); }}
        >
          <div className="bg-white border border-neutral-900 w-full max-w-6xl max-h-[90vh] overflow-hidden animate-slide-up">
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200">
              <div>
                <p className="label">Таблица сравнения</p>
                <h2 className="text-lg font-semibold text-neutral-900">Выбранные предложения</h2>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:border-neutral-900 hover:text-neutral-900 transition-colors"
                id="comparison-modal-close"
              >
                Закрыть
              </button>
            </div>

            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    <th className="text-left px-4 py-3 label font-normal w-44">Параметр</th>
                    {items.map((item) => (
                      <th key={item.service_id} className="text-left px-4 py-3 min-w-[220px] align-top">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-neutral-900">{item.clinic_name}</p>
                            <p className="label mt-0.5">{item.city || 'город не указан'}</p>
                          </div>
                          <button
                            onClick={() => removeItem(item.service_id)}
                            className="font-mono text-neutral-400 hover:text-neutral-900"
                          >
                            x
                          </button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  <tr>
                    <td className="px-4 py-3 text-neutral-500">Услуга</td>
                    {items.map((item) => (
                      <td key={item.service_id} className="px-4 py-3 font-medium text-neutral-900">{item.service_name_norm}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-neutral-500">Цена</td>
                    {items.map((item) => (
                      <td key={item.service_id} className="px-4 py-3">
                        <span className={`font-mono text-lg font-semibold ${item.price_kzt === minPrice ? 'text-blue-600' : 'text-neutral-900'}`}>
                          {formatPrice(item.price_kzt)}
                        </span>
                        {item.price_kzt === minPrice && items.length > 1 && <span className="label ml-2 text-blue-600">минимум</span>}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-neutral-500">Категория / срок</td>
                    {items.map((item) => (
                      <td key={item.service_id} className="px-4 py-3 text-neutral-700">
                        {item.category}{item.duration_days !== null ? ` · ${item.duration_days} дн.` : ''}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-neutral-500">Адрес</td>
                    {items.map((item) => (
                      <td key={item.service_id} className="px-4 py-3 text-neutral-600">{item.address || '-'}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-neutral-500">Контакты</td>
                    {items.map((item) => (
                      <td key={item.service_id} className="px-4 py-3 text-neutral-600">
                        {[item.phone, item.working_hours].filter(Boolean).join(' · ') || '-'}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-neutral-500">Рейтинг</td>
                    {items.map((item) => (
                      <td key={item.service_id} className="px-4 py-3 text-neutral-600">
                        {item.rating !== null ? `${item.rating.toFixed(1)}${item.reviews_count ? ` / ${item.reviews_count} отзывов` : ''}` : '-'}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-neutral-500">Обновлено</td>
                    {items.map((item) => (
                      <td key={item.service_id} className={`px-4 py-3 font-mono text-xs ${isPriceStale(item.parsed_at) ? 'text-amber-600' : 'text-neutral-500'}`}>
                        {isPriceStale(item.parsed_at) ? 'устарело · ' : ''}{formatParsedAt(item.parsed_at)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-neutral-500">Источник</td>
                    {items.map((item) => (
                      <td key={item.service_id} className="px-4 py-3">
                        {item.source_url ? (
                          <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-900">
                            Открыть
                          </a>
                        ) : '-'}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
