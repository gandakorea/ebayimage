'use client';

/* eslint-disable @next/next/no-img-element */

import type { ChangeEvent, DragEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleDot,
  Download,
  FileImage,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  normalizePartNumber,
  partNumberFromFileName,
  processGuidedImage,
  type ResolvedMode,
} from '../lib/image-pipeline';

type WorkStatus = 'queued' | 'processing' | 'done' | 'review' | 'failed';
type PreviewMode = 'source' | 'result';

type QueueItem = {
  id: string;
  sourceName: string;
  sourcePreview: string;
  preview: string;
  outputName: string;
  partNumber: string;
  mode: ResolvedMode;
  status: WorkStatus;
  file: File;
  result?: Blob;
  resultObjectUrl?: boolean;
  aiEdited?: boolean;
  reviewReasons: string[];
  error?: string;
};

type ApiConnectionStatus = {
  connected?: boolean;
  message?: string;
};

type BrowserWritable = {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
};

type BrowserFileHandle = {
  createWritable(): Promise<BrowserWritable>;
};

type BrowserDirectoryHandle = {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<BrowserFileHandle>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<BrowserDirectoryHandle>;
};

const modeLabels: Record<ResolvedMode, string> = {
  label: '라벨형',
  box: '박스형',
  product: '제품만',
};

function safeFileName(fileName: string) {
  return fileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-');
}

function outputName(partNumber: string | null, index: number) {
  if (!partNumber) return '품번-확인.png';
  return `${partNumber}${index ? `_${index}` : ''}.png`;
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeFileName(fileName);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function fileAlreadyExists(directory: BrowserDirectoryHandle, fileName: string) {
  try {
    await directory.getFileHandle(fileName);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return false;
    throw error;
  }
}

function StatusBadge({ status }: { status: WorkStatus }) {
  if (status === 'processing') {
    return <span className="status-badge processing"><LoaderCircle className="spin" size={14} />처리 중</span>;
  }
  if (status === 'done') {
    return <span className="status-badge done"><CheckCircle2 size={14} />완료</span>;
  }
  if (status === 'review') {
    return <span className="status-badge review"><CircleDot size={14} />확인 필요</span>;
  }
  if (status === 'failed') {
    return <span className="status-badge failed"><AlertTriangle size={14} />실패</span>;
  }
  return <span className="status-badge queued"><CircleDot size={14} />대기</span>;
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [batchPartNumber, setBatchPartNumber] = useState('');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('source');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [aiConnected, setAiConnected] = useState<boolean | null>(null);
  const [aiMessage, setAiMessage] = useState('');
  const [notice, setNotice] = useState('');

  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const completed = useMemo(() => items.filter((item) => item.status === 'done'), [items]);
  const reviewCount = useMemo(() => items.filter((item) => item.status === 'review').length, [items]);
  const failedCount = useMemo(() => items.filter((item) => item.status === 'failed').length, [items]);

  useEffect(() => {
    fetch('/api/status')
      .then(async (response) => (await response.json()) as ApiConnectionStatus)
      .then((status) => {
        setAiConnected(Boolean(status.connected));
        setAiMessage(status.message ?? '');
      })
      .catch(() => {
        setAiConnected(false);
        setAiMessage('AI 연결 상태를 확인하지 못했습니다.');
      });
  }, []);

  const addFiles = (incoming: File[]) => {
    if (isProcessing) return;
    const images = incoming.filter((file) => file.type.startsWith('image/'));
    if (!images.length) {
      setNotice('이미지 파일을 선택해 주세요.');
      return;
    }

    const inferredPart = partNumberFromFileName(images[0].name);
    const currentPart = normalizePartNumber(batchPartNumber) ?? inferredPart ?? '';
    if (!batchPartNumber && inferredPart) setBatchPartNumber(inferredPart);
    const startingIndex = items.length;
    const additions = images.map((file, index): QueueItem => {
      const sourcePreview = URL.createObjectURL(file);
      const queueIndex = startingIndex + index;
      return {
        id: `upload-${Date.now()}-${index}`,
        sourceName: file.name,
        sourcePreview,
        preview: sourcePreview,
        outputName: outputName(currentPart || null, queueIndex),
        partNumber: currentPart,
        mode: queueIndex === 0 ? 'label' : 'product',
        status: 'queued',
        file,
        reviewReasons: [],
      };
    });
    setItems((current) => [...current, ...additions]);
    if (!selectedId && additions[0]) setSelectedId(additions[0].id);
    setPreviewMode('source');
    setNotice(`${images.length}장의 사진을 추가했습니다.`);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  const selectItem = (id: string) => {
    const item = items.find((candidate) => candidate.id === id);
    setSelectedId(id);
    setPreviewMode(item?.result ? 'result' : 'source');
  };

  const resetResult = (item: QueueItem) => {
    if (item.resultObjectUrl) URL.revokeObjectURL(item.preview);
    return {
      ...item,
      preview: item.sourcePreview,
      outputName: outputName(normalizePartNumber(item.partNumber), items.findIndex((candidate) => candidate.id === item.id)),
      status: 'queued' as WorkStatus,
      result: undefined,
      resultObjectUrl: false,
      aiEdited: false,
      reviewReasons: [],
      error: undefined,
    };
  };

  const updateMode = (id: string, mode: ResolvedMode) => {
    if (isProcessing) return;
    setItems((current) => current.map((item) => item.id === id ? { ...resetResult(item), mode } : item));
    if (selectedId === id) setPreviewMode('source');
  };

  const applyPartNumber = () => {
    const normalized = normalizePartNumber(batchPartNumber);
    if (!normalized) {
      setNotice('파츠넘버를 확인해 주세요.');
      return;
    }
    setBatchPartNumber(normalized);
    setItems((current) => current.map((item, index) => ({
      ...item,
      partNumber: normalized,
      outputName: outputName(normalized, index),
    })));
    setNotice(`${normalized} 품번을 전체 사진에 적용했습니다.`);
  };

  const removeItem = (id: string) => {
    if (isProcessing) return;
    const target = items.find((item) => item.id === id);
    if (!target) return;
    URL.revokeObjectURL(target.sourcePreview);
    if (target.resultObjectUrl) URL.revokeObjectURL(target.preview);
    const remaining = items.filter((item) => item.id !== id);
    setItems(remaining.map((item, index) => ({
      ...item,
      outputName: outputName(normalizePartNumber(item.partNumber || batchPartNumber), index),
    })));
    if (selected?.id === id) setSelectedId(remaining[0]?.id ?? '');
  };

  const clearQueue = () => {
    if (isProcessing) return;
    items.forEach((item) => {
      URL.revokeObjectURL(item.sourcePreview);
      if (item.resultObjectUrl) URL.revokeObjectURL(item.preview);
    });
    setItems([]);
    setSelectedId('');
    setPreviewMode('source');
    setNotice('사진 목록을 비웠습니다.');
  };

  const runItem = async (item: QueueItem, index: number, fallbackPart: string) => {
    if (item.resultObjectUrl) URL.revokeObjectURL(item.preview);
    setItems((current) => current.map((candidate) => candidate.id === item.id ? {
      ...candidate,
      preview: candidate.sourcePreview,
      status: 'processing',
      result: undefined,
      resultObjectUrl: false,
      reviewReasons: [],
      error: undefined,
    } : candidate));

    try {
      const processed = await processGuidedImage({
        file: item.file,
        mode: item.mode,
        fallbackPartNumber: fallbackPart || item.partNumber,
      });
      const resolvedPart = processed.partNumber ?? normalizePartNumber(fallbackPart || item.partNumber);
      const resultPreview = URL.createObjectURL(processed.result);
      const nextStatus: WorkStatus = processed.reviewReasons.length ? 'review' : 'done';
      setItems((current) => current.map((candidate) => candidate.id === item.id ? {
        ...candidate,
        preview: resultPreview,
        outputName: outputName(resolvedPart, index),
        partNumber: resolvedPart ?? '',
        status: nextStatus,
        result: processed.result,
        resultObjectUrl: true,
        aiEdited: processed.aiEdited,
        reviewReasons: processed.reviewReasons,
        error: undefined,
      } : candidate));
      return resolvedPart ?? fallbackPart;
    } catch (error) {
      const message = error instanceof Error ? error.message : '사진 작업에 실패했습니다.';
      setItems((current) => current.map((candidate) => candidate.id === item.id ? {
        ...candidate,
        preview: candidate.sourcePreview,
        status: 'failed',
        result: undefined,
        resultObjectUrl: false,
        reviewReasons: [],
        error: message,
      } : candidate));
      return fallbackPart;
    }
  };

  const processAll = async () => {
    if (!items.length || isProcessing) return;
    if (aiConnected !== true) {
      setNotice(aiMessage || 'AI 연결을 확인해 주세요.');
      return;
    }
    setIsProcessing(true);
    setNotice('사진을 순서대로 자동 처리하고 있습니다.');
    let activePart = normalizePartNumber(batchPartNumber) ?? '';
    const snapshot = [...items];
    for (let index = 0; index < snapshot.length; index += 1) {
      activePart = await runItem(snapshot[index], index, activePart);
      if (!batchPartNumber && activePart) {
        setBatchPartNumber(activePart);
        setItems((current) => current.map((item, itemIndex) => ({
          ...item,
          partNumber: item.partNumber || activePart,
          outputName: outputName(normalizePartNumber(item.partNumber || activePart), itemIndex),
        })));
      }
    }
    setIsProcessing(false);
    setPreviewMode('result');
    setNotice('전체 작업이 끝났습니다. 확인 필요와 실패 항목을 확인해 주세요.');
  };

  const retrySelected = async () => {
    if (!selected || isProcessing || aiConnected !== true) return;
    setIsProcessing(true);
    const index = items.findIndex((item) => item.id === selected.id);
    await runItem(selected, index, normalizePartNumber(batchPartNumber) ?? '');
    setIsProcessing(false);
    setPreviewMode('result');
  };

  const approveSelected = () => {
    if (!selected || selected.status !== 'review') return;
    setItems((current) => current.map((item) => item.id === selected.id ? { ...item, status: 'done' } : item));
    setNotice(`${selected.outputName} 결과를 승인했습니다.`);
  };

  const downloadSelected = () => {
    if (!selected?.result || selected.status !== 'done') return;
    triggerDownload(selected.result, selected.outputName);
  };

  const saveCompleted = async () => {
    if (!completed.length || isSaving) return;
    setIsSaving(true);
    try {
      const pickerWindow = window as DirectoryPickerWindow;
      if (pickerWindow.showDirectoryPicker) {
        const directory = await pickerWindow.showDirectoryPicker({ mode: 'readwrite' });
        let saved = 0;
        let skipped = 0;
        for (const item of completed) {
          if (!item.result) continue;
          if (await fileAlreadyExists(directory, item.outputName)) {
            skipped += 1;
            continue;
          }
          const handle = await directory.getFileHandle(item.outputName, { create: true });
          const writable = await handle.createWritable();
          await writable.write(item.result);
          await writable.close();
          saved += 1;
        }
        setNotice(skipped ? `${saved}장 저장 · 같은 이름 ${skipped}장 건너뜀` : `${saved}장의 PNG를 저장했습니다.`);
      } else {
        completed.forEach((item, index) => {
          if (!item.result) return;
          window.setTimeout(() => triggerDownload(item.result as Blob, item.outputName), index * 180);
        });
        setNotice(`${completed.length}장의 다운로드를 시작했습니다.`);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') setNotice('저장을 취소했습니다.');
      else setNotice(error instanceof Error ? error.message : '사진을 저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const previewSource = previewMode === 'result' && selected?.result ? selected.preview : selected?.sourcePreview;

  return (
    <main className="app-shell simple-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark" aria-hidden="true">KA</div><div><strong>KOREA AUTOPARTS</strong><span>IMAGE STUDIO</span></div></div>
        <div className="topbar-status">
          <span className={`connection-state ${aiConnected === true ? 'connected' : aiConnected === false ? 'disconnected' : ''}`}>
            {aiConnected === null ? <LoaderCircle className="spin" size={14} /> : aiConnected ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {aiConnected === null ? 'AI 연결 확인 중' : aiConnected ? 'AI 연결됨' : 'AI 연결 필요'}
          </span>
          <span className="workflow-label"><ShieldCheck size={14} /> 안전형 자동 처리</span>
        </div>
      </header>

      <section className="actionbar simple-actionbar">
        <div><p className="eyebrow">대표이미지 제작</p><h1>유형만 확인하고 전체 사진 만들기</h1></div>
        <div className="action-buttons">
          <button className="button secondary" type="button" onClick={saveCompleted} disabled={!completed.length || isSaving || isProcessing}>{isSaving ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />} 완료 {completed.length}장 저장</button>
          <button className="button primary" type="button" onClick={processAll} disabled={!items.length || isProcessing || aiConnected !== true}>{isProcessing ? <LoaderCircle className="spin" size={18} /> : <Play size={18} />} {isProcessing ? '작업 중' : `${items.length}장 작업 시작`}</button>
        </div>
      </section>

      {notice ? <div className="notice" role="status"><Check size={16} /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="알림 닫기" title="알림 닫기"><X size={15} /></button></div> : null}

      <section className="batch-controls">
        <div className={`batch-dropzone ${isDragging ? 'is-dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setIsDragging(false)} onDrop={onDrop}>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={onFileChange} />
          <Upload size={19} /><div><strong>사진 추가</strong><span>PNG · JPG · 여러 장 선택</span></div>
          <button className="button secondary compact" type="button" onClick={() => fileInputRef.current?.click()} disabled={isProcessing}><FolderOpen size={16} /> 선택</button>
        </div>
        <div className="part-control">
          <div><label htmlFor="batch-part-number">파츠넘버</label><span>파일명·첫 사진 라벨에서 인식</span></div>
          <div className="part-input-row"><input id="batch-part-number" value={batchPartNumber} placeholder="39220-25500" onChange={(event) => setBatchPartNumber(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === 'Enter') applyPartNumber(); }} disabled={isProcessing} /><button className="button secondary compact" type="button" onClick={applyPartNumber} disabled={!items.length || isProcessing}>전체 적용</button></div>
        </div>
        <div className="safety-control"><ShieldCheck size={20} /><div><strong>원본 보호 검사</strong><span>제품 변경이 크면 자동 중단</span></div></div>
      </section>

      <div className="simple-workspace">
        <section className="queue-panel simple-queue-panel">
          <div className="queue-header"><div><h2>사진 목록</h2><span>{items.length}장 · 완료 {completed.length} · 확인 {reviewCount} · 실패 {failedCount}</span></div><button className="icon-text-button danger" type="button" onClick={clearQueue} disabled={!items.length || isProcessing}><Trash2 size={16} /> 전체 비우기</button></div>

          <div className="simple-table" role="table" aria-label="이미지 작업 목록">
            <div className="simple-table-head" role="row"><span>사진</span><span>작업 유형</span><span>출력 파일명</span><span>상태</span><span /></div>
            <div className="simple-table-body">
              {items.map((item, index) => (
                <div className={`simple-row ${selected?.id === item.id ? 'is-selected' : ''}`} role="row" key={item.id} onClick={() => selectItem(item.id)}>
                  <div className="source-cell" role="cell"><span className="row-number">{String(index + 1).padStart(2, '0')}</span><span className="thumb"><img src={item.sourcePreview} alt="" /></span><span className="source-copy"><strong>{item.sourceName}</strong><span>{item.aiEdited ? '워터마크 AI 복원 사용' : '원본 분석 대기'}</span></span></div>
                  <div className="mode-cell" role="cell" onClick={(event) => event.stopPropagation()}><select value={item.mode} onChange={(event) => updateMode(item.id, event.target.value as ResolvedMode)} disabled={isProcessing} aria-label={`${item.sourceName} 작업 유형`}><option value="label">라벨형</option><option value="box">박스형</option><option value="product">제품만</option></select></div>
                  <div className="output-cell" role="cell"><FileImage size={15} /><span>{item.outputName}</span></div>
                  <div role="cell"><StatusBadge status={item.status} /></div>
                  <div className="row-actions" role="cell"><button type="button" onClick={(event) => { event.stopPropagation(); removeItem(item.id); }} disabled={isProcessing} aria-label={`${item.sourceName} 삭제`} title="삭제"><Trash2 size={15} /></button></div>
                </div>
              ))}
            </div>
            {!items.length ? <div className="empty-queue"><ImageIcon size={29} /><strong>사진을 추가해 주세요</strong><button className="button secondary compact" type="button" onClick={() => fileInputRef.current?.click()}><Upload size={16} /> 사진 선택</button></div> : null}
          </div>
        </section>

        <aside className="simple-preview-panel">
          <div className="preview-header"><div><h2>미리보기</h2><span>{selected?.outputName ?? '선택된 사진 없음'}</span></div><button className="icon-button bordered" type="button" onClick={downloadSelected} disabled={!selected?.result || selected.status !== 'done'} aria-label="선택한 결과 다운로드" title="결과 다운로드"><Download size={17} /></button></div>
          <div className="preview-tabs" role="tablist" aria-label="미리보기 종류"><button type="button" className={previewMode === 'source' ? 'active' : ''} onClick={() => setPreviewMode('source')} disabled={!selected} role="tab" aria-selected={previewMode === 'source'}>원본</button><button type="button" className={previewMode === 'result' ? 'active' : ''} onClick={() => setPreviewMode('result')} disabled={!selected?.result} role="tab" aria-selected={previewMode === 'result'}>결과</button></div>
          <div className="preview-stage simple-preview-stage">{previewSource ? <img src={previewSource} alt={previewMode === 'result' ? '제작 결과' : '원본 사진'} /> : <div className="preview-empty"><ImageIcon size={31} /><span>사진을 선택하세요</span></div>}{previewMode === 'result' && selected?.result ? <span className="dimension-label">1000 × 1000</span> : null}</div>

          {selected ? <><div className="preview-meta simple-preview-meta"><div><span>작업 유형</span><strong>{modeLabels[selected.mode]}</strong></div><div><span>AI 이미지 복원</span><strong>{selected.aiEdited ? '1회 사용' : '사용 안 함'}</strong></div></div>{selected.status === 'review' ? <div className="review-panel"><div><AlertTriangle size={17} /><strong>결과 확인 필요</strong></div>{selected.reviewReasons.map((reason) => <p key={reason}>{reason}</p>)}<button className="button primary full" type="button" onClick={approveSelected}><CheckCircle2 size={17} /> 결과 승인</button></div> : null}{selected.status === 'failed' ? <div className="error-panel"><div><AlertTriangle size={17} /><strong>결과를 저장하지 않았습니다</strong></div><span>{selected.error}</span><button className="button secondary full" type="button" onClick={retrySelected} disabled={isProcessing || aiConnected !== true}><RefreshCw size={16} /> 다시 시도</button></div> : null}{selected.status === 'done' ? <div className="success-panel"><Sparkles size={17} /><div><strong>저장 가능</strong><span>원본과 결과를 확인했습니다.</span></div></div> : null}</> : null}
        </aside>
      </div>
    </main>
  );
}
