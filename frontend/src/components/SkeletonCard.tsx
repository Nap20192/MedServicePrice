import React from 'react';

export function ServiceCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-200 rounded-xl" />
            <div className="space-y-1.5 flex-1">
              <div className="h-4 bg-slate-200 rounded w-2/3" />
              <div className="h-3 bg-slate-100 rounded w-1/3" />
            </div>
          </div>
          <div className="h-4 bg-slate-200 rounded w-3/4" />
          <div className="h-3 bg-slate-100 rounded w-1/2" />
          <div className="flex gap-2">
            <div className="h-6 bg-slate-100 rounded-full w-20" />
            <div className="h-6 bg-slate-100 rounded-full w-24" />
          </div>
        </div>
        <div className="text-right space-y-2 shrink-0">
          <div className="h-7 bg-slate-200 rounded w-28" />
          <div className="h-3 bg-slate-100 rounded w-20" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <ServiceCardSkeleton key={i} />
      ))}
    </div>
  );
}
