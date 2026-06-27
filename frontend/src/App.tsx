import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ComparisonProvider } from './context/ComparisonContext';
import Navbar from './components/Navbar';
import ComparisonDrawer from './components/ComparisonDrawer';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import ClinicPage from './pages/ClinicPage';

function App() {
  return (
    <BrowserRouter>
      <ComparisonProvider>
        <div className="flex flex-col min-h-screen">
          <Navbar />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/clinic/:id" element={<ClinicPage />} />
            </Routes>
          </main>
          <ComparisonDrawer />
          <footer className="bg-white border-t border-slate-100 py-8 mt-auto">
            <div className="max-w-7xl mx-auto px-4 text-center">
              <p className="text-sm text-slate-400">
                © 2026 <span className="font-semibold text-teal-600">MedServicePrice.kz</span> — агрегатор цен на медицинские услуги в Казахстане
              </p>
              <p className="text-xs text-slate-300 mt-1">
                Данные получены из открытых источников. Для уточнения цен обращайтесь в клинику напрямую.
              </p>
            </div>
          </footer>
        </div>
      </ComparisonProvider>
    </BrowserRouter>
  );
}

export default App;
