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
  service_id: string;
  service_name_raw: string;
  service_name_norm: string;
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

export interface SearchFilters {
  city: string;
  category: ServiceCategory | '';
  priceMin: number;
  priceMax: number;
  durationDays: number | null;
  workingNow: boolean;
  onlineBooking: boolean;
}

export type SortMode = 'price_asc' | 'price_desc' | 'date_desc' | 'distance';

export interface ComparisonItem {
  service: MedService;
}
