import { useEffect, useRef, useState } from 'react';
import { Button, Input, Tooltip } from 'antd';
import { CloseOutlined, PaperClipOutlined, PlusOutlined, SendOutlined, StopOutlined } from '@/components/Icon/ant';
import { previewAgentAttachment } from '@/services/api';

const FILE_TYPES = ['.pdf', '.docx', '.xlsx', '.csv', '.txt', '.md'];
const MAX_FILE_BYTES = 768 * 1024;
const MAX_FILES = 3;

export type ChatAttachment = Awaited<ReturnType<typeof previewAgentAttachment>>;

interface ChatComposerProps {
  input: string;
  enabled: boolean;
  sending: boolean;
  onChange: (value: string) => void;
  onSend: (value: string, attachments: ChatAttachment[]) => Promise<void>;
  onStop: () => void;
}

export function ChatComposer({ input, enabled, sending, onChange, onSend, onStop }: ChatComposerProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const upload = useRef<AbortController | null>(null);
  useEffect(() => () => upload.current?.abort(), []);
  const busy = sending || reading;

  const addFiles = (incoming: FileList | null) => {
    if (!incoming?.length || !enabled || busy) return;
    const next = [...files];
    const errors: string[] = [];
    for (const file of Array.from(incoming)) {
      const name = file.name.toLowerCase();
      if (name.endsWith('.doc')) {
        errors.push(`请将「${file.name}」另存为 .docx 后重新添加`);
      } else if (!FILE_TYPES.some(extension => name.endsWith(extension))) {
        errors.push(`「${file.name}」格式不受支持`);
      } else if (!file.size || file.size > MAX_FILE_BYTES) {
        errors.push(`「${file.name}」需为非空文件，且不超过 768 KB`);
      } else if (next.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) {
        continue;
      } else if (next.length === MAX_FILES) {
        errors.push('每条消息最多添加 3 个附件');
        break;
      } else {
        next.push(file);
      }
    }
    setFiles(next);
    setError(errors.join('。'));
  };

  const submit = async () => {
    if (!enabled || busy || upload.current || (!input.trim() && !files.length)) return;
    if (!files.length) {
      await onSend(input, []);
      return;
    }
    const controller = new AbortController();
    upload.current = controller;
    setReading(true);
    setError('');
    let attachments: ChatAttachment[];
    try {
      attachments = await Promise.all(files.map(async file => {
        try {
          return await previewAgentAttachment(file, controller.signal);
        } catch (cause) {
          throw new Error(`「${file.name}」${cause instanceof Error ? cause.message : '读取失败'}`);
        }
      }));
    } catch (cause) {
      if (!controller.signal.aborted && cause instanceof Error) setError(cause.message);
      controller.abort();
      return;
    } finally {
      upload.current = null;
      setReading(false);
    }
    if (controller.signal.aborted) return;
    await onSend(input.trim() || '请查看我附上的文件。', attachments);
    setFiles([]);
  };

  return (
    <div
      className={`ai-chat-input ai-chat-composer${dragging ? ' is-dragging-files' : ''}`}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = enabled && !busy ? 'copy' : 'none';
        setDragging(enabled && !busy);
      }}
      onDragLeave={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      }}
      onDrop={event => {
        setDragging(false);
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        addFiles(event.dataTransfer.files);
      }}
    >
      {dragging && <div className="ai-chat-drop-hint">松开鼠标添加附件</div>}
      {(files.length > 0 || error) && (
        <div className="ai-chat-attachments">
          {files.map((file, index) => (
            <span className="ai-chat-attachment" key={`${file.name}-${file.size}-${file.lastModified}`}>
              <PaperClipOutlined />
              <span title={file.name}>{file.name}</span>
              <Button type="text" size="small" icon={<CloseOutlined />} disabled={busy}
                aria-label={`移除附件 ${file.name}`}
                onClick={() => {
                  setFiles(previous => previous.filter((_, fileIndex) => fileIndex !== index));
                  setError('');
                }} />
            </span>
          ))}
          {error && <div className="ai-chat-attachment-error" role="alert">{error}</div>}
        </div>
      )}
      <input type="file" hidden ref={picker} multiple accept={FILE_TYPES.join(',')} onChange={event => {
        addFiles(event.currentTarget.files);
        event.currentTarget.value = '';
      }} />
      <Tooltip title="添加或拖入附件 · PDF、Word（.docx）、Excel（.xlsx）、CSV、TXT、Markdown · 每个 768 KB">
        <Button aria-label="添加附件" icon={<PlusOutlined />} disabled={!enabled || busy} onClick={() => picker.current?.click()} />
      </Tooltip>
      <Input.TextArea
        value={input}
        placeholder={reading ? '正在读取附件…' : '问我当前页面的问题，或让我准备待确认操作...'}
        autoSize={{ minRows: 1, maxRows: 3 }}
        disabled={busy}
        onChange={event => onChange(event.target.value)}
        onPressEnter={event => {
          if (!event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {busy ? (
        <Button danger aria-label={reading ? '取消读取附件' : '停止生成'} icon={<StopOutlined />}
          onClick={() => reading ? upload.current?.abort() : onStop()} />
      ) : (
        <Button type="primary" aria-label="发送消息" icon={<SendOutlined />}
          disabled={!enabled || (!input.trim() && !files.length)} onClick={() => void submit()} />
      )}
    </div>
  );
}
