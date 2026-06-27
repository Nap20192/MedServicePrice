import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { MedService } from '../types';

interface ComparisonContextType {
  items: MedService[];
  addItem: (service: MedService) => void;
  removeItem: (serviceId: string) => void;
  isInComparison: (serviceId: string) => boolean;
  clearAll: () => void;
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
}

const ComparisonContext = createContext<ComparisonContextType | null>(null);

export function ComparisonProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<MedService[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const addItem = useCallback((service: MedService) => {
    setItems((prev) => {
      if (prev.find((i) => i.service_id === service.service_id)) return prev;
      if (prev.length >= 4) return prev; // максимум 4 для сравнения
      const next = [...prev, service];
      if (next.length >= 1) setIsOpen(false);
      return next;
    });
  }, []);

  const removeItem = useCallback((serviceId: string) => {
    setItems((prev) => prev.filter((i) => i.service_id !== serviceId));
  }, []);

  const isInComparison = useCallback(
    (serviceId: string) => items.some((i) => i.service_id === serviceId),
    [items]
  );

  const clearAll = useCallback(() => {
    setItems([]);
    setIsOpen(false);
  }, []);

  return (
    <ComparisonContext.Provider value={{ items, addItem, removeItem, isInComparison, clearAll, isOpen, setIsOpen }}>
      {children}
    </ComparisonContext.Provider>
  );
}

export function useComparison() {
  const ctx = useContext(ComparisonContext);
  if (!ctx) throw new Error('useComparison must be inside ComparisonProvider');
  return ctx;
}
