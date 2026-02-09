export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="h-8 w-48 bg-gray-800/60 rounded-lg mb-2 shimmer" />
          <div className="h-4 w-64 bg-gray-800/40 rounded-lg shimmer" />
        </div>
        <div className="h-10 w-32 bg-gray-800/60 rounded-lg shimmer" />
      </div>

      {/* Stats Grid Skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-gray-900/80 rounded-xl p-4 md:p-5 border border-gray-800/50">
            <div className="h-4 w-16 bg-gray-800/50 rounded mb-2 shimmer" />
            <div className="h-8 w-12 bg-gray-800/40 rounded shimmer" />
          </div>
        ))}
      </div>

      {/* Content Sections Skeleton */}
      {[1, 2].map((section) => (
        <div key={section}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-gray-800/50 rounded-lg shimmer" />
            <div className="h-6 w-32 bg-gray-800/50 rounded-lg shimmer" />
          </div>
          <div className="rounded-xl border p-4 border-gray-700/30 bg-gray-900/40">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((card) => (
                <div
                  key={card}
                  className="rounded-lg border p-4 bg-gray-900/60 border-gray-800/50"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 bg-gray-800/50 rounded shimmer" />
                    <div className="flex-1">
                      <div className="h-4 w-3/4 bg-gray-800/50 rounded mb-1 shimmer" />
                      <div className="h-3 w-1/2 bg-gray-800/40 rounded shimmer" />
                    </div>
                  </div>
                  <div className="h-8 bg-gray-800/30 rounded mb-3 shimmer" />
                  <div className="flex justify-between">
                    <div className="h-3 w-20 bg-gray-800/30 rounded shimmer" />
                    <div className="h-3 w-12 bg-gray-800/30 rounded shimmer" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
