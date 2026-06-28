import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ComparisonProvider } from './context/ComparisonContext';
import Navbar from './components/Navbar';
import ComparisonDrawer from './components/ComparisonDrawer';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import ClinicPage from './pages/ClinicPage';
import ClinicsPage from './pages/ClinicsPage';
import SourcesPage from './pages/SourcesPage';
import BranchesPage from './pages/BranchesPage';

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
              <Route path="/clinics" element={<ClinicsPage />} />
              <Route path="/clinic/:id" element={<ClinicPage />} />
              <Route path="/sources" element={<SourcesPage />} />
              <Route path="/sources/:sourceId/branches" element={<BranchesPage />} />
            </Routes>
          </main>
          <ComparisonDrawer />
          <footer className="border-t border-neutral-200 bg-neutral-50 mt-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="font-mono text-xs text-neutral-500">
                © 2026 MedServicePrice.kz — агрегатор цен на медуслуги в Казахстане
              </p>
              <p className="text-xs text-neutral-400 max-w-md sm:text-right">
                Данные из открытых источников. Цены уточняйте в клинике напрямую.
              </p>
            </div>
          </footer>
        </div>
      </ComparisonProvider>
    </BrowserRouter>
  );
}

export default App;
