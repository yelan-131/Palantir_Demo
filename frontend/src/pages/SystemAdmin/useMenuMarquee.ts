import { useEffect, useRef, useState, type PointerEvent } from 'react';

const menuRowSelector = '[data-menu-key]';

function pointerPosition(event: PointerEvent<HTMLDivElement>) {
  const area = event.currentTarget;
  const bounds = area.getBoundingClientRect();
  return {
    x: area.scrollLeft + Math.max(0, Math.min(event.clientX - bounds.left, area.clientWidth)),
    y: area.scrollTop + Math.max(0, Math.min(event.clientY - bounds.top, area.clientHeight)),
  };
}

export function useMenuMarquee(appId: number, enabled: boolean) {
  const [keys, setKeys] = useState<string[] | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number }>();
  const gesture = useRef<{ pointerId: number; start: { x: number; y: number }; previousKeys: string[] | null }>();

  useEffect(() => {
    gesture.current = undefined;
    setBox(undefined);
    setKeys(null);
  }, [appId]);

  const selectInBox = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (current?.pointerId !== event.pointerId) return;
    const end = pointerPosition(event);
    const width = Math.abs(end.x - current.start.x);
    const height = Math.abs(end.y - current.start.y);
    const left = Math.min(current.start.x, end.x);
    const top = Math.min(current.start.y, end.y);
    if (Math.max(width, height) < 4) {
      setBox(undefined);
      setKeys([]);
      return;
    }

    const area = event.currentTarget;
    const bounds = area.getBoundingClientRect();
    const offsetX = bounds.left - area.scrollLeft;
    const offsetY = bounds.top - area.scrollTop;
    const hits = Array.from(area.querySelectorAll<HTMLElement>(menuRowSelector)).flatMap(row => {
      const rect = row.getBoundingClientRect();
      return rect.left < offsetX + left + Math.max(width, 1) && rect.right > offsetX + left
        && rect.top < offsetY + top + Math.max(height, 1) && rect.bottom > offsetY + top
        ? [row.dataset.menuKey!] : [];
    });
    setBox({ left, top, width, height });
    setKeys(hits);
  };

  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointerId !== event.pointerId) return;
    setKeys(gesture.current.previousKeys);
    gesture.current = undefined;
    setBox(undefined);
  };

  return {
    keys,
    setKeys,
    box,
    pointerHandlers: {
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        const target = event.target;
        if (!enabled || gesture.current || event.button !== 0 || event.pointerType === 'touch'
          || !(target instanceof Element) || target.closest('[role="treeitem"]')) return;
        const area = event.currentTarget;
        const bounds = area.getBoundingClientRect();
        if (event.clientX >= bounds.left + area.clientWidth || event.clientY >= bounds.top + area.clientHeight) return;
        event.preventDefault();
        area.focus({ preventScroll: true });
        area.setPointerCapture(event.pointerId);
        gesture.current = { pointerId: event.pointerId, start: pointerPosition(event), previousKeys: keys };
      },
      onPointerMove: selectInBox,
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        if (gesture.current?.pointerId !== event.pointerId) return;
        selectInBox(event);
        gesture.current = undefined;
        setBox(undefined);
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
    },
  };
}
