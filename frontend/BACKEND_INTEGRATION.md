# Руководство по интеграции Frontend и Backend

Фронтенд спроектирован с использованием паттерна **"Изолированный API слой"**. Это означает, что компоненты (страницы, поиск, фильтры, карточки) ничего не знают о том, откуда берутся данные. Вся логика запросов вынесена в один единственный файл: `src/api/api.ts`. 

Никакие React-компоненты при подключении бэкенда менять **не нужно**.

---

## 🚀 Пошаговая инструкция по переключению

### Шаг 1: Установите HTTP-клиент (axios)
Перейдите в папку фронтенда (в той среде, где вы запускаете проект, например в WSL) и установите axios:
```bash
cd frontend
npm install axios
```

### Шаг 2: Настройте переменные окружения
Создайте файл `.env` в корне папки `frontend` (если его там еще нет) и пропишите настройки:
```env
VITE_API_BASE_URL=http://localhost:8080/api/v1
VITE_USE_MOCK=false
```
*(Файл `.env` считывается Vite автоматически)*

### Шаг 3: Проверьте прокси в `vite.config.ts`
Откройте `frontend/vite.config.ts`. Убедитесь, что порт в `target` совпадает с портом, на котором запускается ваш бэкенд (FastAPI, Go, Node и т.д.):
```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080', // <-- Порт вашего бэкенда
        changeOrigin: true,
      },
    },
  },
})
```
*Зачем это нужно: Фронтенд на порту 3000 будет отправлять запросы на `/api/...`, а Vite будет незаметно перенаправлять их на `localhost:8080`, решая проблему CORS при разработке.*

### Шаг 4: Переключите `src/api/api.ts`
Откройте файл `frontend/src/api/api.ts`.

1. **Удалите или закомментируйте** всю секцию **"MOCK-РЕЖИМ"** (функции `searchServices`, `getClinicById`, `getAutocomplete`, `getStats`, которые используют `mockServices` и `delay`).
2. **Раскомментируйте** секцию **"БЭКЕНД-РЕЖИМ"** в самом низу файла.

В идеале, финальный код `api.ts` должен выглядеть так:

```typescript
import axios from 'axios';
import { MedService, SearchFilters, SortMode } from '../types';

const BASE = '/api';

export async function searchServices(
  query: string, 
  filters: SearchFilters, 
  sort: SortMode
): Promise<MedService[]> {
  const { data } = await axios.get(`${BASE}/services/search`, {
    params: { query, ...filters, sort }
  });
  return data;
}

export async function getClinicById(clinicId: string): Promise<MedService[]> {
  const { data } = await axios.get(`${BASE}/clinics/${clinicId}/services`);
  return data;
}

export async function getAutocomplete(query: string): Promise<string[]> {
  const { data } = await axios.get(`${BASE}/services/autocomplete`, { 
    params: { query } 
  });
  return data;
}

export async function getStats(): Promise<{ totalPrices: number; totalClinics: number }> {
  const { data } = await axios.get(`${BASE}/stats`);
  return data;
}
```

Все! Теперь фронтенд отправляет реальные сетевые запросы.

---

## 📡 Контракт API (Что фронтенд ждет от бэкенда)

Ваш бэкенд должен реализовать 4 эндпоинта.

### 1. Поиск и фильтрация услуг
- **Endpoint:** `GET /api/services/search`
- **Query-параметры:**
  - `query` (строка) — введенный текст в поиск
  - `city` (строка) — выбранный город (если "Все города", возвращайте всё)
  - `category` (строка) — `лаборатория`, `диагностика`, `приём врача`, `процедура`
  - `priceMin` (число)
  - `priceMax` (число)
  - `durationDays` (число) — макс. количество дней ожидания результата
  - `workingNow` (boolean) — если true, вернуть только открытые сейчас клиники (можно фильтровать на фронте или на бэкенде)
  - `onlineBooking` (boolean) — если true, только с онлайн-записью
  - `sort` (строка) — `price_asc`, `price_desc`, `date_desc`, `distance`
- **Ответ (200 OK):** Массив объектов `MedService` (JSON).

### 2. Услуги конкретной клиники
- **Endpoint:** `GET /api/clinics/{clinic_id}/services`
- **Параметр пути:** `clinic_id` (UUID или строковый ID клиники)
- **Ответ (200 OK):** Массив объектов `MedService` (прайс-лист конкретной клиники).

### 3. Автодополнение (Подсказки в поиске)
- **Endpoint:** `GET /api/services/autocomplete`
- **Query-параметр:** `query` (введенный юзером текст, например "Общ")
- **Ответ (200 OK):** Простой массив строк (максимум 5-10 штук).
  ```json
  [
    "Общий анализ крови (ОАК)",
    "Общий анализ мочи",
    "Общий белок"
  ]
  ```

### 4. Статистика для главной страницы
- **Endpoint:** `GET /api/stats`
- **Ответ (200 OK):** Объект со счетчиками базы данных.
  ```json
  {
    "totalPrices": 15420,
    "totalClinics": 52
  }
  ```

---

## 📦 Формат объекта `MedService` (JSON)

Каждый объект услуги, возвращаемый бэкендом, должен строго соответствовать этому JSON-формату (snake_case):

```json
{
  "clinic_id": "uuid-или-строка",
  "clinic_name": "Название клиники",
  "city": "Астана",
  "address": "ул. Примерная, 10",
  "phone": "+7 (777) 123-45-67",
  "working_hours": "08:00 – 20:00",
  "source_url": "https://...",
  "lat": 51.1605,
  "lng": 71.4704,
  "service_id": "uuid-услуги",
  "service_name_raw": "ОАК с лейкоцитарной формулой",
  "service_name_norm": "Общий анализ крови (ОАК)",
  "category": "лаборатория",
  "price_kzt": 1500,
  "currency": "KZT",
  "duration_days": 1,
  "parsed_at": "2026-06-27T10:00:00Z",
  "is_active": true,
  "online_booking": true
}
```

### Важные нюансы формата:
1. `category` должна быть одним из точных строковых значений: `"лаборатория"`, `"приём врача"`, `"диагностика"`, `"процедура"`. От этого зависит цвет бейджика и иконка на UI.
2. `duration_days` может быть `null` (если это прием врача или МРТ, где результат выдают сразу).
3. `parsed_at` должен быть в формате **ISO 8601**. Фронтенд сам вычисляет, "устарела" ли цена (больше 14 дней) и подсвечивает её желтым.
4. `lat` и `lng` (координаты) обязательны для корректной отрисовки маркеров на карте Leaflet.
