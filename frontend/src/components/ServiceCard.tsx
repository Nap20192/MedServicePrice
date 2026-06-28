import React from 'react';
import { Link } from 'react-router-dom';
import { MedService } from '../types';
import { formatPrice, formatParsedAt, isPriceStale, categoryColors, categoryDot } from '../utils/format';
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
    <div className={`group border bg-white transition-colors ${inComp ? 'border-neutral-900' : 'border-neutral-200 hover:border-neutral-400'}`}>
      <div className="flex items-stretch">
        {/* Left: service + clinic + meta */}
        <div className="flex-1 min-w-0 p-4">
          {/* Service name + category */}
          <div className="flex items-start gap-2 mb-2">
            <p className="font-medium text-neutral-900 leading-snug">{service.service_name_norm}</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-[11px] font-medium ${categoryColors[service.category] || 'border-neutral-300 text-neutral-700'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${categoryDot[service.category] || 'bg-neutral-400'}`} />
              {service.category}
            </span>
            {service.duration_days !== null && (
              <span className="label">срок {service.duration_days} дн.</span>
            )}
          </div>

          {/* Clinic */}
          <div className="flex items-baseline gap-2 flex-wrap">
            {service.source_url ? (
              <a
                href={service.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-neutral-900 underline decoration-neutral-300 hover:decoration-neutral-900 underline-offset-2"
                id={`clinic-link-${service.service_id}`}
              >
                {service.clinic_name} ↗
              </a>
            ) : (
              <Link to={`/clinic/${service.clinic_id}`} className="text-sm font-medium text-neutral-900 hover:underline">
                {service.clinic_name}
              </Link>
            )}
            {showCity && service.city && <span className="label">{service.city}</span>}
          </div>
          {service.address && (
            <p className="text-xs text-neutral-500 mt-1 truncate">{service.address}</p>
          )}
        </div>

        {/* Right: price + freshness + actions */}
        <div className="w-44 shrink-0 border-l border-neutral-200 p-4 flex flex-col justify-between">
          <div className="text-right">
            <p className="font-mono text-xl font-semibold text-neutral-900 leading-none">{formatPrice(service.price_kzt)}</p>
            <p className={`text-[11px] mt-1.5 font-mono ${stale ? 'text-amber-600' : 'text-neutral-400'}`}>
              {stale && '⚠ '}{formatParsedAt(service.parsed_at)}
            </p>
          </div>

          <div className="flex flex-col gap-px mt-3">
            {service.source_url && (
              <a
                href={service.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-center text-xs border border-neutral-900 bg-neutral-900 text-white py-1.5 hover:bg-neutral-700 transition-colors"
                id={`source-link-${service.service_id}`}
              >
                На сайт ↗
              </a>
            )}
            <button
              onClick={handleCompare}
              className={`text-xs py-1.5 border transition-colors ${inComp ? 'border-neutral-900 bg-neutral-100 text-neutral-900' : 'border-neutral-300 text-neutral-600 hover:border-neutral-900'}`}
              id={`compare-btn-${service.service_id}`}
            >
              {inComp ? '✓ В сравнении' : '+ Сравнить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
