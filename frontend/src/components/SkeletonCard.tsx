import React from 'react';

export function ServiceCardSkeleton() {
  return (
    <div className="border border-neutral-200 bg-white flex">
      <div className="flex-1 p-4 space-y-3">
        <div className="h-4 w-2/3 animate-shimmer" />
        <div className="h-5 w-24 animate-shimmer" />
        <div className="h-4 w-1/2 animate-shimmer" />
      </div>
      <div className="w-44 shrink-0 border-l border-neutral-200 p-4 space-y-3">
        <div className="h-6 w-24 ml-auto animate-shimmer" />
        <div className="h-7 w-full animate-shimmer" />
      </div>
    </div>
  );
}

export function SkeletonList({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-px bg-neutral-200 border border-neutral-200">
      {Array.from({ length: count }).map((_, i) => (
        <ServiceCardSkeleton key={i} />
      ))}
    </div>
  );
}
