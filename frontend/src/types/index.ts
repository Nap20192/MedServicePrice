// ============================
// Типы данных (идентичны бэкенд API)
// ============================

export type ServiceCategory = 'лаборатория' | 'приём врача' | 'диагностика' | 'процедура';

export interface MedService {
  clinic_id: string;
  clinic_name: string;
  city: string;
  address: string;
  phone: string;
  working_hours: string;
  source_url: string;
  lat: number;
  lng: number;
  rating: number | null;
  reviews_count: number | null;
  service_id: string;
  service_name_norm: string;
  service_name_raw: string;
  category: ServiceCategory;
  price_kzt: number;
  currency: 'KZT' | 'USD';
  duration_days: number | null;
  parsed_at: string;
  is_active: boolean;
  online_booking: boolean;
}

export interface Clinic {
  clinic_id: string;
  clinic_name: string;
  city: string;
  address: string;
  phone: string;
  working_hours: string;
  source_url: string;
  lat: number;
  lng: number;
  online_booking: boolean;
  services: MedService[];
}

export interface SourceDetails {
  id: string;
  clinic_id?: string | null;
  url: string;
  clinic_name?: string | null;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  working_hours?: string | null;
  clinic_url?: string | null;
  adapter_id?: string | null;
}

export interface CreateSourceInput {
  url: string;
  fetch_now?: boolean;
}

export interface ClinicRecord {
  id: string;
  name: string;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  working_hours?: string | null;
  url?: string | null;
  google_place_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  rating?: number | null;
  reviews_count?: number | null;
}

export interface CreateClinicInput {
  name: string;
  city?: string;
  address?: string;
  phone?: string;
  working_hours?: string;
  url?: string;
  source_ids: string[];
}

export interface GooglePlaceClinicCandidate {
  id: string;
  name: string;
  city?: string;
  address?: string;
  phone?: string;
  working_hours?: string;
  url?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  reviews_count?: number;
}

export interface SchedulerSettings {
  fetch_interval_hours: number;
  updated_at: string;
}

export interface SourceCommandResult {
  source: SourceDetails;
  status: string;
  adapter_queued: boolean;
  fetch_queued: boolean;
  adapter_existed: boolean;
}

export interface SearchFilters {
  city: string;
  category: ServiceCategory | '';
  sourceId: string;
  priceMin: number;
  priceMax: number;
  ratingMin: number;
  durationDays: number | null;
  workingNow: boolean;
  onlineBooking: boolean;
}

export type SortMode = 'price_asc' | 'price_desc' | 'date_desc' | 'distance';

export interface ComparisonItem {
  service: MedService;
}
