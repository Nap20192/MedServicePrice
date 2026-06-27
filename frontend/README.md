# MedServicePrice.kz — Frontend

Фронтенд агрегатора цен на медицинские услуги в Казахстане.

## Стек

- **Vite** + **React 18** + **TypeScript**
- **Tailwind CSS** — стилизация
- **React Router v6** — маршрутизация
- **React Leaflet** — интерактивная карта
- **Mock-данные** (9 клиник, 5 городов, 22+ услуги)

## Запуск

```bash
cd frontend
npm install
npm run dev
```

Откройте http://localhost:3000

## Страницы

| Маршрут | Описание |
|---|---|
| `/` | Главная: hero, поиск, быстрые категории |
| `/search?query=ОАК&city=Алматы` | Результаты поиска с фильтрами и картой |
| `/clinic/:id` | Карточка клиники: все услуги, маршрут |

## Подключение бэкенда

Всё что нужно — отредактировать один файл: `src/api/api.ts`

1. Установить axios: `npm install axios`
2. В `src/api/api.ts` раскомментировать секцию `БЭКЕНД-РЕЖИМ`
3. Закомментировать секцию `MOCK-РЕЖИМ`
4. В `vite.config.ts` уже настроен proxy на `http://localhost:8080`

Страницы и компоненты менять **не нужно** — вся логика изолирована в хуке `useMedicalServices`.

## Структура проекта

```
src/
├── api/
│   └── api.ts              ← ЕДИНАЯ ТОЧКА интеграции с бэкендом
├── mock/
│   └── data.ts             ← Тестовые данные (структура = API бэкенда)
├── hooks/
│   └── useMedicalServices.ts ← Главный хук данных
├── context/
│   └── ComparisonContext.tsx ← Глобальный стейт сравнения
├── components/
│   ├── Navbar.tsx
│   ├── SearchBar.tsx        ← Умный поиск с автодополнением
│   ├── ServiceCard.tsx      ← Карточка предложения
│   ├── ComparisonDrawer.tsx ← Панель сравнения
│   ├── MapView.tsx          ← Интерактивная карта (Leaflet)
│   └── SkeletonCard.tsx     ← Skeleton loaders
├── pages/
│   ├── HomePage.tsx
│   ├── SearchPage.tsx
│   └── ClinicPage.tsx
├── types/
│   └── index.ts            ← TypeScript типы (= бэкенд API)
└── utils/
    └── format.ts           ← Форматирование цены, дат и т.д.
```

## API контракт (ожидаемые ответы бэкенда)

### GET /api/services/search
```
?query=...&city=...&category=...&priceMin=...&priceMax=...&sort=price_asc
```
Ответ: `MedService[]`

### GET /api/clinics/:id/services
Ответ: `MedService[]`

### GET /api/services/autocomplete?query=...
Ответ: `string[]`

### GET /api/stats
Ответ: `{ totalPrices: number, totalClinics: number }`

Тип `MedService` определён в `src/types/index.ts`.
