// ================================================================
// API Layer — единая точка интеграции с бэкендом
//
// ИНСТРУКЦИЯ ПО ПОДКЛЮЧЕНИЮ БЭКЕНДА:
// 1. Установить: npm install axios
// 2. Раскомментировать секцию "БЭКЕНД-РЕЖИМ" ниже
// 3. Закомментировать секцию "MOCK-РЕЖИМ"
// 4. Всё — страницы и компоненты менять не нужно!
// ================================================================

import {
  ClinicRecord,
  CreateClinicInput,
  CreateSourceInput,
  MedService,
  SchedulerSettings,
  SearchFilters,
  ServiceCategory,
  SortMode,
  SourceCommandResult,
  SourceDetails,
} from '../types';
// MOCK отключён — используем реальный бэкенд. Оставлено закомментированным.
// import { mockServices } from '../mock/data';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';

// Бэкенд GET /prices возвращает AggregatedPrice (см. internal/api/domain/models.go).
interface AggregatedPrice {
  price_id: string;
  clinic_id: string;
  clinic_name: string;
  clinic_url?: string | null;
  city?: string | null;
  address?: string | null;
  service_name_norm: string;
  category: string;
  price_kzt: number;
  parsed_at: string;
}

const KNOWN_CATEGORIES: ServiceCategory[] = ['лаборатория', 'приём врача', 'диагностика', 'процедура'];

function toCategory(c: string): ServiceCategory {
  // Бэкенд хранит 'прием врача' (без ё) — нормализуем к UI-варианту.
  const v = c === 'прием врача' ? 'приём врача' : c;
  return (KNOWN_CATEGORIES as string[]).includes(v) ? (v as ServiceCategory) : 'лаборатория';
}

// Маппинг ответа бэкенда в богатую модель UI. Поля, которых бэкенд пока не
// отдаёт (телефон, часы, гео, категория, нормализованное имя), получают дефолты.
function toMedService(p: AggregatedPrice): MedService {
  return {
    clinic_id: p.clinic_id,
    clinic_name: p.clinic_name,
    city: p.city ?? '',
    address: p.address ?? '',
    phone: '',
    working_hours: '',
    source_url: p.clinic_url ?? '',
    lat: 0,
    lng: 0,
    service_id: p.price_id,
    service_name_norm: p.service_name_norm,
    category: toCategory(p.category),
    price_kzt: p.price_kzt,
    currency: 'KZT',
    duration_days: null,
    parsed_at: p.parsed_at,
    is_active: true,
    online_booking: false,
  };
}

// ── Вспомогательные утилиты ──────────────────────────────────

function isWorkingNow(workingHours: string): boolean {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const current = h * 60 + m;
  const match = workingHours.match(/(\d{2}):(\d{2})\s*[–-]\s*(\d{2}):(\d{2})/);
  if (!match) return true;
  const open = parseInt(match[1]) * 60 + parseInt(match[2]);
  const close = parseInt(match[3]) * 60 + parseInt(match[4]);
  return current >= open && current <= close;
}

function applyFilters(data: MedService[], filters: SearchFilters): MedService[] {
  return data.filter((s) => {
    if (filters.city && filters.city !== 'Все города' && s.city !== filters.city) return false;
    if (filters.category && s.category !== filters.category) return false;
    if (s.price_kzt < filters.priceMin || s.price_kzt > filters.priceMax) return false;
    if (filters.durationDays !== null && (s.duration_days === null || s.duration_days > filters.durationDays)) return false;
    if (filters.workingNow && !isWorkingNow(s.working_hours)) return false;
    if (filters.onlineBooking && !s.online_booking) return false;
    return true;
  });
}

function applySort(data: MedService[], sort: SortMode): MedService[] {
  const copy = [...data];
  switch (sort) {
    case 'price_asc':  return copy.sort((a, b) => a.price_kzt - b.price_kzt);
    case 'price_desc': return copy.sort((a, b) => b.price_kzt - a.price_kzt);
    case 'date_desc':  return copy.sort((a, b) => new Date(b.parsed_at).getTime() - new Date(a.parsed_at).getTime());
    default: return copy;
  }
}

// ── БЭКЕНД-РЕЖИМ ─────────────────────────────────────────────
// Реальные данные с GET /prices. Бэкенд фильтрует по q и city; остальные
// фильтры и сортировка применяются на клиенте (helpers выше).

async function fetchPrices(query: string, city?: string): Promise<MedService[]> {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  if (city && city !== 'Все города') params.set('city', city);
  const qs = params.toString();
  const rows = await apiJson<AggregatedPrice[]>(`/prices${qs ? `?${qs}` : ''}`);
  return rows.map(toMedService);
}

export async function searchServices(
  query: string,
  filters: SearchFilters,
  sort: SortMode
): Promise<MedService[]> {
  let result = await fetchPrices(query, filters.city);
  result = applyFilters(result, filters);
  result = applySort(result, sort);
  return result;
}

export async function getClinicById(clinicId: string): Promise<MedService[]> {
  const all = await fetchPrices('');
  return all.filter((s) => s.clinic_id === clinicId);
}

export async function getAutocomplete(query: string): Promise<string[]> {
  if (!query.trim()) return [];
  const rows = await fetchPrices(query);
  const names = [...new Set(rows.map((s) => s.service_name_norm))];
  return names.slice(0, 8);
}

export async function getStats(): Promise<{ totalPrices: number; totalClinics: number }> {
  const all = await fetchPrices('');
  const clinics = new Set(all.map((s) => s.clinic_id)).size;
  return { totalPrices: all.length, totalClinics: clinics };
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method || 'GET';
  const url = `${API_BASE}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  } catch (err) {
    // Сеть недоступна / CORS / DNS — fetch отклонился, ответа нет.
    console.error(`[api] ${method} ${url} — network error:`, err);
    throw err;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error(`[api] ${method} ${url} — HTTP ${response.status} ${response.statusText}`, text);
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function listSources(): Promise<SourceDetails[]> {
  return apiJson<SourceDetails[]>('/sources');
}

export async function createSource(input: CreateSourceInput): Promise<SourceCommandResult> {
  return apiJson<SourceCommandResult>('/sources', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listClinics(): Promise<ClinicRecord[]> {
  return apiJson<ClinicRecord[]>('/clinics');
}

export async function createClinic(input: CreateClinicInput): Promise<ClinicRecord> {
  return apiJson<ClinicRecord>('/clinics', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getSchedulerSettings(): Promise<SchedulerSettings> {
  return apiJson<SchedulerSettings>('/scheduler');
}

export async function updateSchedulerSettings(fetchIntervalHours: number): Promise<SchedulerSettings> {
  return apiJson<SchedulerSettings>('/scheduler', {
    method: 'PUT',
    body: JSON.stringify({ fetch_interval_hours: fetchIntervalHours }),
  });
}

export async function triggerSourceFetch(sourceId: string): Promise<SourceCommandResult> {
  return apiJson<SourceCommandResult>(`/sources/${sourceId}/fetch`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ── БЭКЕНД-РЕЖИМ (раскомментировать при интеграции) ──────────
//
// import axios from 'axios';
// const BASE = '/api';
//
// export async function searchServices(query, filters, sort) {
//   const { data } = await axios.get(`${BASE}/services/search`, {
//     params: { query, ...filters, sort }
//   });
//   return data;
// }
//
// export async function getClinicById(clinicId) {
//   const { data } = await axios.get(`${BASE}/clinics/${clinicId}/services`);
//   return data;
// }
//
// export async function getAutocomplete(query) {
//   const { data } = await axios.get(`${BASE}/services/autocomplete`, { params: { query } });
//   return data;
// }
//
// export async function getStats() {
//   const { data } = await axios.get(`${BASE}/stats`);
//   return data;
// }
