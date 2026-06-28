import React from 'react';
import { Link } from 'react-router-dom';
import { MedService } from '../types';
import { formatPrice, formatParsedAt, isPriceStale, categoryColors } from '../utils/format';
import { useComparison } from '../context/ComparisonContext';

interface ServiceCardProps {
  service: MedService;
  showCity?: boolean;
}

export default function ServiceCard({ service, showCity = false }: ServiceCardProps) {
  const { addItem, removeItem, isInComparison } = useComparison();
  const inComp = isInComparison(service.service_id);
  const stale = isPriceStale(service.parsed_at);

  const handleCompare = (e: React.MouseEvent) => {
    e.preventDefault();
    if (inComp) removeItem(service.service_id);
    else addItem(service);
  };

  return (
    <div className={`bg-white rounded-2xl border transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group ${inComp ? 'border-teal-300 shadow-teal-100 shadow-md' : 'border-slate-100 shadow-sm'}`}>
      <div className="p-5">
        <div className="flex items-start gap-4">
          {/* Clinic info left */}
          <div className="flex-1 min-w-0">
            {/* Clinic name */}
            <div className="flex items-center gap-2 mb-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-100 to-teal-100 flex items-center justify-center shrink-0 text-lg font-bold text-teal-600">
                {service.clinic_name.charAt(0)}
              </div>
              <div className="min-w-0">
                {service.source_url ? (
                  <a
                    href={service.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-slate-800 hover:text-teal-600 transition-colors text-sm leading-snug truncate block"
                    id={`clinic-link-${service.service_id}`}
                  >
                    {service.clinic_name} ↗
                  </a>
                ) : (
                  <Link
                    to={`/clinic/${service.clinic_id}`}
                    className="font-semibold text-slate-800 hover:text-teal-600 transition-colors text-sm leading-snug truncate block"
                    id={`clinic-link-${service.service_id}`}
                  >
                    {service.clinic_name}
                  </Link>
                )}
                {showCity && service.city && (
                  <div className="mt-0.5">
                    <span className="text-xs text-slate-400">{service.city}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Service name */}
            <div className="mb-2">
              <p className="font-medium text-slate-800 text-sm leading-snug">{service.service_name_norm}</p>
            </div>

            {/* Category */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColors[service.category] || 'bg-slate-100 text-slate-600'}`}>
                {service.category}
              </span>
            </div>

            {/* Address */}
            {service.address && (
            <p className="text-xs text-slate-400 mt-2 truncate">
              <svg className="w-3 h-3 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {service.address}
            </p>
            )}
          </div>

          {/* Price right */}
          <div className="text-right shrink-0 flex flex-col items-end gap-2">
            <div>
              <p className="text-2xl font-bold text-slate-900 leading-none">{formatPrice(service.price_kzt)}</p>
              <div className={`flex items-center gap-1 mt-1 justify-end ${stale ? 'text-amber-500' : 'text-slate-400'}`}>
                {stale && (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                )}
                <span className="text-xs">{formatParsedAt(service.parsed_at)}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-1.5 w-full">
              <a
                href={service.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs bg-teal-500 hover:bg-teal-600 text-white px-3 py-1.5 rounded-lg transition-colors text-center font-medium"
                id={`source-link-${service.service_id}`}
              >
                На сайт клиники ↗
              </a>
              <button
                onClick={handleCompare}
                className={`text-xs px-3 py-1.5 rounded-lg transition-all font-medium border ${
                  inComp
                    ? 'bg-teal-500 text-white border-teal-500 hover:bg-teal-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-teal-300 hover:text-teal-600'
                }`}
                id={`compare-btn-${service.service_id}`}
              >
                {inComp ? '✓ Добавлено' : '+ Сравнить'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
