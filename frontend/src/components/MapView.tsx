import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { MedService } from '../types';
import { formatPrice } from '../utils/format';
import { Link } from 'react-router-dom';

// Fix default marker icons for bundlers
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function createPriceIcon(price: number) {
  const label = formatPrice(price);
  return L.divIcon({
    html: `<div style="
      background: linear-gradient(135deg, #0e8595, #14b8a6);
      color: white;
      padding: 4px 8px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 700;
      font-family: Inter, sans-serif;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(14,133,149,0.4);
      border: 2px solid white;
    ">${label}</div>`,
    className: '',
    iconAnchor: [0, 0],
  });
}

interface MapViewProps {
  services: MedService[];
}

// Group by clinic to avoid duplicate markers
function groupByClinic(services: MedService[]): Map<string, { service: MedService; minPrice: number }> {
  const map = new Map<string, { service: MedService; minPrice: number }>();
  for (const s of services) {
    const existing = map.get(s.clinic_id);
    if (!existing || s.price_kzt < existing.minPrice) {
      map.set(s.clinic_id, { service: s, minPrice: s.price_kzt });
    }
  }
  return map;
}

export default function MapView({ services }: MapViewProps) {
  const clinics = Array.from(groupByClinic(services).values());
  
  const center: [number, number] = clinics.length > 0
    ? [clinics[0].service.lat, clinics[0].service.lng]
    : [48.0196, 66.9237]; // Centre of Kazakhstan

  return (
    <div className="w-full h-full rounded-xl overflow-hidden border border-slate-200">
      <MapContainer
        center={center}
        zoom={clinics.length === 1 ? 14 : 5}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {clinics.map(({ service, minPrice }) => (
          <Marker
            key={service.clinic_id}
            position={[service.lat, service.lng]}
            icon={createPriceIcon(minPrice)}
          >
            <Popup>
              <div style={{ fontFamily: 'Inter, sans-serif', minWidth: 180 }}>
                <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{service.clinic_name}</p>
                <p style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{service.address}</p>
                <p style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{service.working_hours}</p>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#0e8595' }}>от {formatPrice(minPrice)}</p>
                <a
                  href={`/clinic/${service.clinic_id}`}
                  style={{ fontSize: 12, color: '#14b8a6', textDecoration: 'none', display: 'block', marginTop: 8 }}
                >
                  Все услуги клиники →
                </a>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
