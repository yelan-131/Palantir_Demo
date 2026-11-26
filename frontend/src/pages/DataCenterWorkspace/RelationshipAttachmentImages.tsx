import { Button, Image, Modal, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { readObjectRecordAttachment } from '../../services/objectRuntime';

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const pdfTypes = new Set(['application/pdf']);

interface RecordAttachment {
  id: string;
  name: string;
  content_type: string;
}

function attachmentsOfType(value: unknown, types: ReadonlySet<string>): RecordAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RecordAttachment => Boolean(item && typeof item === 'object'
    && typeof item.id === 'string' && /^[a-f0-9]{32}$/.test(item.id)
    && typeof item.name === 'string' && types.has(item.content_type)));
}

export const relationshipAttachmentImages = (value: unknown) => attachmentsOfType(value, imageTypes);
export const relationshipPdfAttachments = (value: unknown) => attachmentsOfType(value, pdfTypes);

interface RecordAttachmentProps {
  objectId: number;
  recordKey: string;
  property: string;
  file: RecordAttachment;
}

interface SectionDrawingView {
  fileId: string;
  title: string;
  sourceWidth: number;
  sourceHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const twoAndThreeWaySource = { fileId: '496fbebb48be4a00bf153c791a4c2fc3', sourceWidth: 979, sourceHeight: 520 };
const fourAndFiveWaySource = { fileId: 'b692dcad4e5f4bc983f99cd0f74e2785', sourceWidth: 932, sourceHeight: 473 };
const sectionDrawingViews: Readonly<Record<string, SectionDrawingView>> = {
  'VALVE-02': { ...twoAndThreeWaySource, title: '两通阀截面图', x: 0, y: 22, width: 438, height: 448 },
  'VALVE-03': { ...twoAndThreeWaySource, title: '三通阀截面图', x: 548, y: 18, width: 412, height: 454 },
  'VALVE-04': { ...fourAndFiveWaySource, title: '四通阀截面图', x: 10, y: 57, width: 400, height: 386 },
  'VALVE-05': { ...fourAndFiveWaySource, title: '五通阀截面图', x: 505, y: 10, width: 412, height: 451 },
};

export function valveSectionDrawingView(recordKey: string, property: string, fileId: string) {
  const view = sectionDrawingViews[recordKey];
  return property === 'section_drawing' && view?.fileId === fileId ? view : undefined;
}

function SectionDrawing({ source, view }: { source: string; view: SectionDrawingView }) {
  const [expanded, setExpanded] = useState(false);
  const { title, sourceWidth, sourceHeight, x, y, width, height } = view;
  const drawing = <span className="relationship-section-drawing" style={{ aspectRatio: `${width} / ${height}` }}>
    <img src={source} alt={title} draggable={false} style={{
      left: `${-100 * x / width}%`, top: `${-100 * y / height}%`,
      width: `${100 * sourceWidth / width}%`, height: `${100 * sourceHeight / height}%`,
    }} />
  </span>;
  return <>
    <button type="button" className="relationship-section-drawing-button" aria-label={`放大${title}`}
      onClick={() => setExpanded(true)}>{drawing}</button>
    <Modal title={title} open={expanded} width={660} onCancel={() => setExpanded(false)}
      footer={<Button type="link" href={source} target="_blank" rel="noopener noreferrer">查看原始合图</Button>}>
      <div className="relationship-section-drawing-preview" style={{ maxWidth: `calc((100dvh - 200px) * ${width / height})` }}>
        {drawing}
      </div>
    </Modal>
  </>;
}

export function RelationshipPdfAttachment({ objectId, recordKey, property, file, label }: RecordAttachmentProps & { label?: string }) {
  const [downloading, setDownloading] = useState(false);
  async function download() {
    setDownloading(true);
    try {
      const { data } = await readObjectRecordAttachment(objectId, recordKey, property, file.id);
      const source = URL.createObjectURL(new Blob([data], { type: file.content_type }));
      const link = document.createElement('a');
      link.href = source;
      link.download = file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(source), 1000);
    } catch {
      message.error('附件下载失败或无访问权限');
    } finally {
      setDownloading(false);
    }
  }
  return <Button size="small" type="link" className="relationship-attachment-download" title={file.name}
    loading={downloading} onClick={() => void download()}>{label ?? file.name}</Button>;
}

export default function RelationshipAttachmentImage({ objectId, recordKey, property, file, drawingView }: RecordAttachmentProps & {
  drawingView?: SectionDrawingView;
}) {
  const [preview, setPreview] = useState<{ source?: string; failed?: boolean }>({});
  const { id, name, content_type: contentType } = file;
  useEffect(() => {
    const controller = new AbortController();
    let source: string | undefined;
    readObjectRecordAttachment(objectId, recordKey, property, id, controller.signal).then(({ data }) => {
      if (controller.signal.aborted) return;
      source = URL.createObjectURL(new Blob([data], { type: contentType }));
      setPreview({ source });
    }).catch(() => {
      if (!controller.signal.aborted) setPreview({ failed: true });
    });
    return () => {
      controller.abort();
      if (source) URL.revokeObjectURL(source);
    };
  }, [objectId, recordKey, property, id, contentType]);

  if (!preview.source) return <Typography.Text type="secondary">{preview.failed ? '图纸暂时无法预览' : '正在读取图纸…'}</Typography.Text>;
  return drawingView ? <SectionDrawing source={preview.source} view={drawingView} />
    : <Image src={preview.source} alt={name} width="100%" />;
}
