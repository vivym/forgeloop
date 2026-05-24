import { useId, useMemo, useState } from 'react';

import { cn } from '../../utils/cn';

export interface SegmentedControlOption {
  label: string;
  value: string;
}

export interface SegmentedControlProps {
  ariaLabel: string;
  options: SegmentedControlOption[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

export function SegmentedControl({
  ariaLabel,
  options,
  defaultValue,
  value,
  onValueChange,
  className,
}: SegmentedControlProps) {
  const fallbackValue = defaultValue ?? options[0]?.value ?? '';
  const [internalValue, setInternalValue] = useState(fallbackValue);
  const selectedValue = value ?? internalValue;
  const baseId = useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === selectedValue));
  const namedOptions = useMemo(
    () => options.map((option, index) => ({ ...option, id: `${baseId}-${index}` })),
    [baseId, options],
  );

  const selectValue = (nextValue: string) => {
    if (value === undefined) {
      setInternalValue(nextValue);
    }
    onValueChange?.(nextValue);
  };

  const selectByOffset = (offset: number) => {
    if (namedOptions.length === 0) return;
    const nextIndex = (selectedIndex + offset + namedOptions.length) % namedOptions.length;
    selectValue(namedOptions[nextIndex]!.value);
    window.requestAnimationFrame(() => document.getElementById(namedOptions[nextIndex]!.id)?.focus());
  };

  return (
    <div
      aria-label={ariaLabel}
      className={cn('inline-flex min-w-0 rounded-md border border-border bg-surface-muted p-1', className)}
      role="radiogroup"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          selectByOffset(1);
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          selectByOffset(-1);
        }
      }}
    >
      {namedOptions.map((option) => {
        const selected = option.value === selectedValue;
        return (
          <button
            aria-checked={selected}
            className={cn(
              'min-h-8 rounded px-3 text-sm font-semibold text-text-secondary transition-colors duration-base ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none',
              selected && 'bg-surface text-text-primary shadow-sm',
            )}
            id={option.id}
            key={option.value}
            role="radio"
            tabIndex={selected ? 0 : -1}
            type="button"
            onClick={() => selectValue(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
