import { useState, useEffect, useCallback } from 'react';
import { MedService, SearchFilters, SortMode } from '../types';
import { searchServices } from '../api/api';

const DEFAULT_FILTERS: SearchFilters = {
  city: 'Все города',
  category: '',
  priceMin: 0,
  priceMax: 200000,
  durationDays: null,
  workingNow: false,
  onlineBooking: false,
};

// ================================================================
// useMedicalServices — главный хук приложения.
// Содержит ВСЮ логику получения данных.
// При подключении бэкенда — меняется только src/api/api.ts,
// этот хук и страницы остаются без изменений.
// ================================================================

export function useMedicalServices(
  query: string,
  filters: Partial<SearchFilters> = {},
  sort: SortMode = 'price_asc'
) {
  const [data, setData] = useState<MedService[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mergedFilters: SearchFilters = { ...DEFAULT_FILTERS, ...filters };

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await searchServices(query, mergedFilters, sort);
      setData(result);
    } catch (e) {
      setError('Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, JSON.stringify(mergedFilters), sort]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
