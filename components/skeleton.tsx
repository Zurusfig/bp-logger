export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

/** Mirrors ReadingsTable's layout: column header, day heading, slot label, rows. */
export function ReadingsTableSkeleton() {
  return (
    <div>
      <div className="flex items-center gap-3 border-b border-rule px-4 py-2">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="ml-auto h-3 w-8" />
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-3 w-8" />
      </div>

      {[0, 1].map((day) => (
        <section key={day}>
          <div className="border-b border-rule px-4 pt-6 pb-2">
            <Skeleton className="h-5 w-32" />
          </div>

          {[0, 1].map((slot) => (
            <div key={slot}>
              <div className="px-4 pt-3 pb-1">
                <Skeleton className="h-4 w-20" />
              </div>

              {[0, 1].map((row) => (
                <div
                  key={row}
                  className="flex w-full items-center gap-3 border-b border-rule px-4 py-3"
                >
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="ml-auto h-6 w-10" />
                  <Skeleton className="h-6 w-10" />
                  <Skeleton className="h-6 w-8" />
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** Mirrors the trends page: range chips, three chart bands, a numbers block. */
export function TrendsSkeleton() {
  return (
    <div>
      <div className="flex gap-2 border-b border-rule px-4 py-3">
        <Skeleton className="h-8 w-16 rounded-full" />
        <Skeleton className="h-8 w-16 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
      </div>

      {[0, 1, 2].map((i) => (
        <div key={i} className="border-b border-rule px-4 py-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-32 w-full" />
        </div>
      ))}

      <div className="space-y-2 px-4 py-4">
        <Skeleton className="h-4 w-full max-w-64" />
        <Skeleton className="h-4 w-full max-w-48" />
        <Skeleton className="h-4 w-full max-w-56" />
      </div>
    </div>
  );
}

/** Mirrors ReportSheet's grid: title, header row, ~ten day rows. */
export function ReportSheetSkeleton() {
  const cols = 4;
  return (
    <div className="w-full bg-white p-4">
      <Skeleton className="h-5 w-64" />
      <Skeleton className="mt-2 h-4 w-48" />

      <div className="mt-4 border border-rule">
        <div className="flex border-b border-rule bg-paper">
          {Array.from({ length: cols }).map((_, i) => (
            <div key={i} className="flex-1 border-r border-rule px-2 py-2 last:border-r-0">
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
        {Array.from({ length: 10 }).map((_, row) => (
          <div key={row} className="flex border-b border-rule last:border-b-0">
            {Array.from({ length: cols }).map((_, col) => (
              <div key={col} className="flex-1 border-r border-rule px-2 py-2 last:border-r-0">
                <Skeleton className="h-3 w-full max-w-24" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
