// ================================================================
// API Layer — единая точка интеграции с бэкендом
//
// ИНСТРУКЦИЯ ПО ПОДКЛЮЧЕНИЮ БЭКЕНДА:
// 1. Установить: npm install axios
// 2. Раскомментировать секцию "БЭКЕНД-РЕЖИМ" ниже
// 3. Закомментировать секцию "MOCK-РЕЖИМ"
// 4. Всё — страницы и компоненты менять не нужно!
// ================================================================

import { CreateSourceInput, MedService, SearchFilters, SortMode, SourceCommandResult, SourceDetails } from '../types';
import { mockServices } from '../mock/data';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';

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

// ── MOCK-РЕЖИМ (активен пока бэкенд не готов) ────────────────

const MOCK_DELAY = 400; // имитация сетевой задержки

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchServices(
  query: string,
  filters: SearchFilters,
  sort: SortMode
): Promise<MedService[]> {
  await delay(MOCK_DELAY);

  const q = query.trim().toLowerCase();
  let result = mockServices.filter((s) => s.is_active);

  if (q) {
    result = result.filter(
      (s) =>
        s.service_name_norm.toLowerCase().includes(q) ||
        s.service_name_raw.toLowerCase().includes(q)
    );
  }

  result = applyFilters(result, filters);
  result = applySort(result, sort);
  return result;
}

export async function getClinicById(clinicId: string): Promise<MedService[]> {
  await delay(MOCK_DELAY);
  return mockServices.filter((s) => s.clinic_id === clinicId && s.is_active);
}

export async function getAutocomplete(query: string): Promise<string[]> {
  await delay(150);
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const names = [...new Set(mockServices.map((s) => s.service_name_norm))];
  return names.filter((n) => n.toLowerCase().includes(q)).slice(0, 8);
}

export async function getStats(): Promise<{ totalPrices: number; totalClinics: number }> {
  await delay(200);
  const clinics = new Set(mockServices.map((s) => s.clinic_id)).size;
  return { totalPrices: 14200, totalClinics: clinics };
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
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
