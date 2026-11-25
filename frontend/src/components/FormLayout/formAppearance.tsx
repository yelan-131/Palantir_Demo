export interface FormAppearance {
  title?: string;
  description?: string;
  titleAlign?: 'left' | 'center';
  titleColor?: string;
  backgroundColor?: string;
}

function normalizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, maxLength).trimEnd() || undefined;
}

function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const color = value.trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color.toLowerCase() : undefined;
}

export function normalizeFormAppearance(value: unknown): FormAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const settings = value as Record<string, unknown>;
  const title = normalizeText(settings.title, 120);
  const description = normalizeText(settings.description, 600);
  const titleAlign = settings.titleAlign;
  const titleColor = normalizeColor(settings.titleColor);
  const backgroundColor = normalizeColor(settings.backgroundColor);

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(titleAlign === 'left' || titleAlign === 'center' ? { titleAlign } : {}),
    ...(titleColor ? { titleColor } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
  };
}

export function FormAppearanceHeader({
  appearance,
  fallbackTitle,
  className,
  defaultAlign,
}: {
  appearance: FormAppearance;
  fallbackTitle: string;
  className?: string;
  defaultAlign?: 'left' | 'center';
}) {
  const alignment = appearance.titleAlign ?? defaultAlign;

  return (
    <div className={className} style={alignment ? {
      alignItems: alignment === 'center' ? 'center' : 'flex-start',
      textAlign: alignment,
    } : undefined}>
      <strong style={{ color: appearance.titleColor, overflowWrap: 'anywhere' }}>
        {appearance.title ?? fallbackTitle}
      </strong>
      {appearance.description && (
        <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {appearance.description}
        </span>
      )}
    </div>
  );
}
