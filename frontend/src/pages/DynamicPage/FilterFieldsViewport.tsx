import {useLayoutEffect, useRef, type CSSProperties, type ReactNode} from 'react';

export function filterViewportHeight(rowHeights: number[], rowGap: number, rowCount: number, minimumRowHeight: number): number {
  if (!rowCount) return 0;
  const visibleRows = rowHeights.slice(0, rowCount);
  const contentHeight = visibleRows.reduce((total, height) => total + height, 0);
  const emptyRows = rowCount - visibleRows.length;
  return Math.ceil(contentHeight + emptyRows * minimumRowHeight + (rowCount - 1) * rowGap);
}

export default function FilterFieldsViewport({rows, columns, fieldKey, children}: {
  rows: number;
  columns: number;
  fieldKey: string;
  children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const bounded = rows > 0;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const grid = gridRef.current;
    if (!bounded || !viewport || !grid) return;

    const measure = () => {
      const style = getComputedStyle(grid);
      const rowHeights = style.gridTemplateRows.split(' ').map(Number.parseFloat).filter(Number.isFinite);
      const minimumRowHeight = Number.parseFloat(style.getPropertyValue('--mf-filter-min-row'));
      const rowGap = Number.parseFloat(style.rowGap);
      const height = filterViewportHeight(rowHeights, rowGap, rows, minimumRowHeight);
      if (!Number.isFinite(height)) return;
      const value = `${height}px`;
      if (viewport.style.getPropertyValue('--mf-filter-viewport-height') !== value) {
        viewport.style.setProperty('--mf-filter-viewport-height', value);
      }
    };

    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    if (observer) {
      observer.observe(grid);
      for (const field of grid.children) observer.observe(field);
    }
    return () => {
      observer?.disconnect();
      viewport.style.removeProperty('--mf-filter-viewport-height');
    };
  }, [bounded, rows, columns, fieldKey]);

  return <div ref={viewportRef} className={`mf-list-filter-viewport${bounded ? ' is-bounded' : ''}`}
    role={bounded ? 'region' : undefined} aria-label={bounded ? '筛选条件' : undefined}
    tabIndex={bounded ? 0 : undefined}
    style={{'--mf-filter-rows': rows, '--mf-filter-columns': columns} as CSSProperties}>
    <div ref={gridRef} className="mf-list-filter-fields">{children}</div>
  </div>;
}
