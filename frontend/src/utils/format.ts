// Форматирование цены в тенге
export function formatPrice(price: number): string {
  return new Intl.NumberFormat('ru-KZ').format(price) + ' ₸';
}

// Форматирование даты парсинга
export function formatParsedAt(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor(diffMs / (1000 * 60));

  if (diffMins < 60) return `${diffMins} мин. назад`;
  if (diffHours < 24) return `сегодня в ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  if (diffDays === 1) return 'вчера';
  if (diffDays < 7) return `${diffDays} дня назад`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

// ТЗ: данные старше 30 дней не считаются актуальными.
export function isPriceStale(iso: string): boolean {
  const date = new Date(iso);
  const now = new Date();
  const diffDays = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays > 30;
}

// Открыта ли клиника прямо сейчас?
export function isOpenNow(workingHours: string): boolean {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const current = h * 60 + m;
  const match = workingHours.match(/(\d{2}):(\d{2})\s*[–-]\s*(\d{2}):(\d{2})/);
  if (!match) return false;
  const open = parseInt(match[1]) * 60 + parseInt(match[2]);
  const close = parseInt(match[3]) * 60 + parseInt(match[4]);
  return current >= open && current <= close;
}

export const categoryIcons: Record<string, string> = {
  'лаборатория': '🧪',
  'диагностика': '🔬',
  'приём врача': '👨‍⚕️',
  'процедура': '💉',
};

// Strict: neutral tag chip, sharp 1px border.
export const categoryColors: Record<string, string> = {
  'лаборатория': 'border-neutral-300 text-neutral-700 bg-white',
  'диагностика': 'border-neutral-300 text-neutral-700 bg-white',
  'приём врача': 'border-neutral-300 text-neutral-700 bg-white',
  'процедура': 'border-neutral-300 text-neutral-700 bg-white',
};

// One small accent dot per category — the only color, for scannability.
export const categoryDot: Record<string, string> = {
  'лаборатория': 'bg-blue-500',
  'диагностика': 'bg-violet-500',
  'приём врача': 'bg-emerald-500',
  'процедура': 'bg-amber-500',
};
