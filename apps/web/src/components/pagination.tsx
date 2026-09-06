import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Collection, Page } from '@minimarket/shared';
import { api } from '../lib';

export function usePage<T>(
  collection: Collection,
  filters: Record<string, string> = {},
  enabled = true,
  initialData?: Page<T>,
) {
  const [requested, setRequested] = useState({ key: '', page: 1 });
  const key = collection + JSON.stringify(filters);
  const page = requested.key === key ? requested.page : 1;
  const query = useQuery({
    queryKey: ['pages', collection, key, page],
    queryFn: () =>
      api<Page<T>>(
        `/api/pages/${collection}?${new URLSearchParams({ ...filters, page: String(page) })}`,
      ),
    enabled,
    initialData:
      page === 1 && Object.values(filters).every((v) => !v || v === 'newest')
        ? initialData
        : undefined,
  });
  return { ...query, setPage: (page: number) => setRequested({ key, page }) };
}

export function Pagination({
  data,
  setPage,
  label = 'Results',
}: {
  data?: Pick<Page<unknown>, 'page' | 'pages' | 'total' | 'pageSize'>;
  setPage: (page: number) => void;
  label?: string;
}) {
  if (!data || data.total === 0) return null;
  return (
    <nav className="pagination" aria-label={`${label} pagination`}>
      <span aria-live="polite">
        {data.total ? (data.page - 1) * data.pageSize + 1 : 0}-
        {Math.min(data.page * data.pageSize, data.total)} of {data.total}
      </span>
      <button
        className="secondary"
        disabled={data.page <= 1}
        onClick={() => setPage(data.page - 1)}
      >
        Previous
      </button>
      <label>
        Page{' '}
        <input
          key={data.page}
          type="number"
          min="1"
          max={data.pages}
          defaultValue={data.page}
          aria-label={`${label} page`}
          onBlur={(e) => {
            const next = Number(e.target.value);
            if (Number.isInteger(next) && next >= 1 && next <= data.pages) setPage(next);
            else e.target.value = String(data.page);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />{' '}
        of {data.pages}
      </label>
      <button
        className="secondary"
        disabled={data.page >= data.pages}
        onClick={() => setPage(data.page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
