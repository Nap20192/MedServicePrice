import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { listSourceBranches, listSources } from '../api/api';
import { ClinicRecord, SourceDetails } from '../types';

export default function BranchesPage() {
  const { sourceId } = useParams<{ sourceId: string }>();
  const [branches, setBranches] = useState<ClinicRecord[]>([]);
  const [source, setSource] = useState<SourceDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sourceId) return;
    setLoading(true);
    setError('');
    Promise.all([listSourceBranches(sourceId), listSources()])
      .then(([branchRows, sourceRows]) => {
        setBranches(branchRows);
        setSource(sourceRows.find((s) => s.id === sourceId) ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить филиалы'))
      .finally(() => setLoading(false));
  }, [sourceId]);

  const cities = useMemo(
    () => [...new Set(branches.map((b) => b.city).filter(Boolean))],
    [branches],
  );

  return (
    <div className="bg-neutral-50 min-h-screen">
      <div className="border-b border-neutral-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <Link to="/search" className="text-sm text-neutral-400 hover:text-neutral-900 transition-colors">
            ← к поиску
          </Link>
          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-neutral-400">Источник</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
                {source?.clinic_name || source?.url || 'Филиалы источника'}
              </h1>
              {source?.url && (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-sm text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900"
                >
                  {source.url}
                </a>
              )}
            </div>
            <div className="grid grid-cols-2 border border-neutral-200 bg-neutral-50 divide-x divide-neutral-200 w-fit">
              <div className="px-5 py-3">
                <p className="font-mono text-lg font-semibold text-neutral-900">{branches.length}</p>
                <p className="label mt-0.5">филиалов</p>
              </div>
              <div className="px-5 py-3">
                <p className="font-mono text-lg font-semibold text-neutral-900">{cities.length}</p>
                <p className="label mt-0.5">городов</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {loading && <div className="border border-neutral-200 bg-white h-40 animate-shimmer" />}

        {!loading && error && (
          <div className="border border-red-200 bg-white p-5 text-sm text-red-700">{error}</div>
        )}

        {!loading && !error && branches.length === 0 && (
          <div className="border border-neutral-200 bg-white p-10 text-center">
            <p className="font-mono text-sm text-neutral-900">Филиалы пока не добавлены</p>
            <Link to="/sources" className="mt-3 inline-block text-sm text-neutral-500 hover:text-neutral-900">
              Управлять источниками
            </Link>
          </div>
        )}

        {!loading && !error && branches.length > 0 && (
          <div className="border border-neutral-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <th className="text-left px-4 py-2.5 label font-normal">Филиал</th>
                  <th className="text-left px-4 py-2.5 label font-normal">Город</th>
                  <th className="text-left px-4 py-2.5 label font-normal">Адрес</th>
                  <th className="text-left px-4 py-2.5 label font-normal hidden md:table-cell">Телефон</th>
                  <th className="text-left px-4 py-2.5 label font-normal hidden lg:table-cell">Время работы</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {branches.map((branch) => (
                  <tr key={branch.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-neutral-900">{branch.name}</td>
                    <td className="px-4 py-3 text-neutral-600">{branch.city || '—'}</td>
                    <td className="px-4 py-3 text-neutral-600">{branch.address || '—'}</td>
                    <td className="px-4 py-3 text-neutral-600 hidden md:table-cell">{branch.phone || '—'}</td>
                    <td className="px-4 py-3 text-neutral-600 hidden lg:table-cell">{branch.working_hours || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {branch.address && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${branch.name} ${branch.address}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs border border-neutral-300 px-2.5 py-1.5 text-neutral-700 hover:border-neutral-900 transition-colors"
                        >
                          Карта ↗
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
