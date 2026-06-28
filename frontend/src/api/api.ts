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
  GooglePlaceClinicCandidate,
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
  phone?: string | null;
  working_hours?: string | null;
  lat?: number | null;
  lng?: number | null;
  rating?: number | null;
  reviews_count?: number | null;
  service_name_norm: string;
  category: string;
  price_kzt: number;
  currency?: 'KZT' | 'USD';
  duration_days?: number | null;
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
    phone: p.phone ?? '',
    working_hours: p.working_hours ?? '',
    source_url: p.clinic_url ?? '',
    lat: p.lat ?? 0,
    lng: p.lng ?? 0,
    rating: p.rating ?? null,
    reviews_count: p.reviews_count ?? null,
    service_id: p.price_id,
    service_name_norm: p.service_name_norm,
    category: toCategory(p.category),
    price_kzt: p.price_kzt,
    currency: p.currency ?? 'KZT',
    duration_days: p.duration_days ?? null,
    parsed_at: p.parsed_at,
    is_active: true,
    online_booking: false,
  };
}


// ── БЭКЕНД-РЕЖИМ ─────────────────────────────────────────────
// Всё считает сервер: фильтры, сортировка, дедуп и пагинация. GET /prices
// возвращает {items, total, limit, offset}.

interface SearchResponse {
  items: AggregatedPrice[];
  total: number;
  limit: number;
  offset: number;
}

const PRICE_MAX = 200000;

function buildSearchParams(
  query: string,
  filters: Partial<SearchFilters>,
  sort: SortMode,
  page: number,
  pageSize: number,
): string {
  const p = new URLSearchParams();
  if (query.trim()) p.set('q', query.trim());
  if (filters.city && filters.city !== 'Все города') p.set('city', filters.city);
  if (filters.category) p.set('category', filters.category);
  if (filters.sourceId) p.set('source_id', filters.sourceId);
  if (filters.priceMin && filters.priceMin > 0) p.set('min_price', String(filters.priceMin));
  if (filters.priceMax && filters.priceMax < PRICE_MAX) p.set('max_price', String(filters.priceMax));
  if (filters.ratingMin && filters.ratingMin > 0) p.set('rating_min', String(filters.ratingMin));
  if (sort) p.set('sort', sort);
  p.set('limit', String(pageSize));
  p.set('offset', String((Math.max(1, page) - 1) * pageSize));
  return p.toString();
}

export interface SearchPage {
  items: MedService[];
  total: number;
}

export async function searchServices(
  query: string,
  filters: Partial<SearchFilters>,
  sort: SortMode,
  page = 1,
  pageSize = 20,
): Promise<SearchPage> {
  const qs = buildSearchParams(query, filters, sort, page, pageSize);
  const resp = await apiJson<SearchResponse>(`/prices?${qs}`);
  return { items: resp.items.map(toMedService), total: resp.total };
}

// Fetch up to `limit` matching items (for non-paginated needs like clinic/autocomplete).
async function fetchItems(params: URLSearchParams): Promise<MedService[]> {
  const resp = await apiJson<SearchResponse>(`/prices?${params.toString()}`);
  return resp.items.map(toMedService);
}

export async function getClinicById(clinicId: string): Promise<MedService[]> {
  return fetchItems(new URLSearchParams({ clinic_id: clinicId, limit: '100' }));
}

export async function getAutocomplete(query: string): Promise<string[]> {
  if (!query.trim()) return [];
  const rows = await fetchItems(new URLSearchParams({ q: query.trim(), limit: '8' }));
  return [...new Set(rows.map((s) => s.service_name_norm))].slice(0, 8);
}

export async function getStats(): Promise<{ totalPrices: number; totalClinics: number }> {
  const resp = await apiJson<SearchResponse>('/prices?limit=100');
  const clinics = new Set(resp.items.map((s) => s.clinic_id)).size;
  return { totalPrices: resp.total, totalClinics: clinics };
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

export async function attachSourceToClinic(sourceId: string, clinicId: string): Promise<SourceDetails> {
  return apiJson<SourceDetails>(`/sources/${sourceId}/clinic`, {
    method: 'POST',
    body: JSON.stringify({ clinic_id: clinicId }),
  });
}

export async function searchGooglePlacesClinics(query: string, location?: string): Promise<GooglePlaceClinicCandidate[]> {
  const params = new URLSearchParams();
  params.set('q', query);
  if (location?.trim()) params.set('location', location.trim());
  return apiJson<GooglePlaceClinicCandidate[]>(`/clinics/google-places/search?${params.toString()}`);
}

export async function importGooglePlaceClinic(googlePlaceId: string, sourceIds: string[] = []): Promise<ClinicRecord> {
  return apiJson<ClinicRecord>('/clinics/google-places/import', {
    method: 'POST',
    body: JSON.stringify({ google_place_id: googlePlaceId, source_ids: sourceIds }),
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

export async function rebuildSourceAdapter(sourceId: string): Promise<SourceCommandResult> {
  return apiJson<SourceCommandResult>(`/sources/${sourceId}/adapter`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export interface BranchInput {
  city?: string;
  address?: string;
  phone?: string;
  working_hours?: string;
}

// Create many branch clinics under one source/network — same name, shared service pool.
export async function addBranches(
  sourceId: string,
  name: string,
  branches: BranchInput[],
): Promise<ClinicRecord[]> {
  return apiJson<ClinicRecord[]>(`/sources/${sourceId}/branches`, {
    method: 'POST',
    body: JSON.stringify({ name, branches }),
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
