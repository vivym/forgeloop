import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Search } from 'lucide-react';

import { productCommandItems, type ProductCommandItem } from '../../features/product-surfaces/route-contract';
import { cn } from '../utils/cn';

export interface CommandSearchProps {
  className?: string;
}

const searchableCommandItems = productCommandItems.filter((item) => item.path !== '/' && !item.path.includes(':'));

export function CommandSearch({ className }: CommandSearchProps) {
  const searchId = useId();
  const suggestionsId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const suggestions = useMemo(() => commandSuggestions(query), [query]);

  return (
    <div
      className={cn('relative min-w-0', className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <label className="sr-only" htmlFor={searchId}>
        Command search
      </label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
        strokeWidth={2}
      />
      <input
        aria-controls={open ? suggestionsId : undefined}
        className="h-9 w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
        id={searchId}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search commands, objects, or reports"
        role="searchbox"
        type="search"
        value={query}
      />
      {open ? (
        <nav
          aria-label="Command suggestions"
          className="absolute left-0 right-0 top-full z-modal mt-2 max-h-80 overflow-auto rounded-card border border-border bg-surface p-1 shadow-elevated"
          id={suggestionsId}
        >
          {suggestions.length > 0 ? (
            <ul className="m-0 grid list-none gap-1 p-0">
              {suggestions.map((item) => (
                <li key={`${item.path}-${item.id}`}>
                  <Link
                    className="grid gap-0.5 rounded-md px-3 py-2 text-sm text-text-primary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    to={item.path}
                  >
                    <span className="font-semibold">{item.label}</span>
                    <span aria-hidden="true" className="text-xs text-text-secondary">
                      {item.path}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-3 py-2 text-sm text-text-secondary" role="status">
              No matching destinations
            </div>
          )}
        </nav>
      ) : null}
    </div>
  );
}

function commandSuggestions(query: string): readonly ProductCommandItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const matches = normalizedQuery.length === 0
    ? searchableCommandItems
    : searchableCommandItems.filter((item) => commandSearchText(item).includes(normalizedQuery));

  return matches.slice(0, 8);
}

function commandSearchText(item: ProductCommandItem): string {
  return `${item.label} ${item.path} ${item.family}`.toLowerCase();
}
