'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Check,
  ClipboardCopy,
  FileText,
  Plus,
  RotateCcw,
  StickyNote,
  Trash2,
} from 'lucide-react';
import type { AgentGroup, SavedBatch, ShippingPolicy, WorkItem } from '@/lib/listing-work-store';

type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown | Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

const STORAGE_PREFIX = 'korea-autoparts-listing-work:';

function makeItem(): WorkItem {
  return {
    id: crypto.randomUUID(),
    itemNumber: '',
    price: '',
    shippingPolicy: '7day normal',
    memo: '',
  };
}

function makeGroups(): AgentGroup[] {
  return [1, 2, 3].map((agent) => ({
    agent,
    items: [makeItem(), makeItem()],
  }));
}

function todayInKorea() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function readLocalBatch(date: string): SavedBatch | null {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${date}`);
    return raw ? JSON.parse(raw) as SavedBatch : null;
  } catch {
    return null;
  }
}

async function readServerBatch(date: string): Promise<SavedBatch | null> {
  const response = await fetch(`/api/listing-work?date=${encodeURIComponent(date)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('서버 작업표를 불러오지 못했습니다.');
  const result = await response.json() as { found: boolean; batch?: SavedBatch };
  return result.found && result.batch ? result.batch : null;
}

async function saveServerBatch(batch: SavedBatch) {
  const response = await fetch('/api/listing-work', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(batch),
  });
  if (!response.ok) throw new Error('서버에 저장하지 못했습니다.');
  return response.json() as Promise<{ saved: true; itemCount: number; updatedAt: string }>;
}

async function migrateLocalBatches() {
  const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith(STORAGE_PREFIX)));
  for (const key of keys) {
    const date = key.slice(STORAGE_PREFIX.length);
    const batch = readLocalBatch(date);
    if (!batch) continue;
    await saveServerBatch(batch);
    window.localStorage.removeItem(key);
  }
}

function formatPrice(price: string) {
  const clean = price.trim().replace(/^\$/, '');
  if (!clean) return '$가격 미입력';
  return `$${clean}`;
}

export default function ListingWorkPage() {
  const [date, setDate] = useState('');
  const [groups, setGroups] = useState<AgentGroup[]>([]);
  const [batchMemo, setBatchMemo] = useState('');
  const scheduledTime = '17:00';
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [publishMode, setPublishMode] = useState<'automatic' | 'approval'>('approval');
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saved');
  const batchRef = useRef<SavedBatch>({
    date: '', batchMemo: '', groups: [], scheduledTime: '17:00', automationEnabled: false, publishMode: 'approval',
  });
  const skipAutosaveRef = useRef(true);

  useEffect(() => {
    batchRef.current = { date, batchMemo, groups, scheduledTime, automationEnabled, publishMode };
  }, [automationEnabled, batchMemo, date, groups, publishMode, scheduledTime]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const currentDate = todayInKorea();
      try {
        await migrateLocalBatches();
        const saved = await readServerBatch(currentDate);
        if (!active) return;
        setDate(currentDate);
        setGroups(saved?.groups ?? makeGroups());
        setBatchMemo(saved?.batchMemo ?? '');
        setAutomationEnabled(saved?.automationEnabled ?? false);
        setPublishMode(saved?.publishMode ?? 'approval');
      } catch {
        if (!active) return;
        const local = readLocalBatch(currentDate);
        setDate(currentDate);
        setGroups(local?.groups ?? makeGroups());
        setBatchMemo(local?.batchMemo ?? '');
        setAutomationEnabled(local?.automationEnabled ?? false);
        setPublishMode(local?.publishMode ?? 'approval');
        setSaveState('error');
      } finally {
        if (active) {
          skipAutosaveRef.current = true;
          setReady(true);
        }
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready || !date || groups.length === 0) return;
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }
    const batch: SavedBatch = { date, batchMemo, groups, scheduledTime, automationEnabled, publishMode };
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      void saveServerBatch(batch)
        .then(() => setSaveState('saved'))
        .catch(() => {
          window.localStorage.setItem(`${STORAGE_PREFIX}${date}`, JSON.stringify(batch));
          setSaveState('error');
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [automationEnabled, batchMemo, date, groups, publishMode, ready, scheduledTime]);

  useEffect(() => {
    const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!ready || !modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    const registrations = [modelContext.registerTool({
      name: 'fill_listing_work_batch',
      title: '리스팅 작업표 채우기',
      description: '날짜와 에이전트별 eBay 아이템 번호, 가격, 배송 정책, 메모를 작업표에 입력하고 화면에 저장합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          batchMemo: { type: 'string' },
          agents: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                agent: { type: 'integer', minimum: 1, maximum: 3 },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      itemNumber: { type: 'string' },
                      price: { type: 'string' },
                      shippingPolicy: { enum: ['7day normal', '7day fast'] },
                      memo: { type: 'string' },
                    },
                    required: ['itemNumber', 'price', 'shippingPolicy'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['agent', 'items'],
              additionalProperties: false,
            },
          },
        },
        required: ['agents'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        if (!input || typeof input !== 'object') throw new Error('작업표 데이터가 필요합니다.');
        const value = input as {
          date?: unknown;
          batchMemo?: unknown;
          agents?: unknown;
        };
        if (!Array.isArray(value.agents)) throw new Error('agents 배열이 필요합니다.');
        const nextGroups = makeGroups();
        for (const rawAgent of value.agents) {
          if (!rawAgent || typeof rawAgent !== 'object') throw new Error('에이전트 형식이 올바르지 않습니다.');
          const agentValue = rawAgent as { agent?: unknown; items?: unknown };
          if (![1, 2, 3].includes(Number(agentValue.agent)) || !Array.isArray(agentValue.items)) {
            throw new Error('에이전트 번호와 상품 목록을 확인해 주세요.');
          }
          const mapped = agentValue.items.map((rawItem) => {
            if (!rawItem || typeof rawItem !== 'object') throw new Error('상품 형식이 올바르지 않습니다.');
            const item = rawItem as Record<string, unknown>;
            if (typeof item.itemNumber !== 'string' || typeof item.price !== 'string') {
              throw new Error('아이템 번호와 가격을 문자로 입력해 주세요.');
            }
            if (item.shippingPolicy !== '7day normal' && item.shippingPolicy !== '7day fast') {
              throw new Error('배송 정책은 7day normal 또는 7day fast만 가능합니다.');
            }
            return {
              id: crypto.randomUUID(),
              itemNumber: item.itemNumber,
              price: item.price.replace(/^\$/, ''),
              shippingPolicy: item.shippingPolicy,
              memo: typeof item.memo === 'string' ? item.memo : '',
            } satisfies WorkItem;
          });
          nextGroups[Number(agentValue.agent) - 1].items = mapped.length ? mapped : [makeItem()];
        }
        const nextDate = typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
          ? value.date
          : batchRef.current.date;
        const nextMemo = typeof value.batchMemo === 'string' ? value.batchMemo : '';
        const nextBatch: SavedBatch = {
          date: nextDate,
          batchMemo: nextMemo,
          groups: nextGroups,
          scheduledTime: batchRef.current.scheduledTime,
          automationEnabled: batchRef.current.automationEnabled,
          publishMode: batchRef.current.publishMode,
        };
        await saveServerBatch(nextBatch);
        skipAutosaveRef.current = true;
        setDate(nextDate);
        setBatchMemo(nextMemo);
        setGroups(nextGroups);
        setSaveState('saved');
        setCopied(false);
        return {
          saved: true,
          itemCount: nextGroups.reduce((total, group) => total + group.items.filter((item) => item.itemNumber.trim()).length, 0),
        };
      },
    }, { signal: lifecycle.signal }), modelContext.registerTool({
      name: 'read_listing_work_batch',
      title: '리스팅 작업표 읽기',
      description: '현재 화면 또는 지정한 날짜에 저장된 eBay 리스팅 작업표의 아이템 번호, 가격, 배송 정책과 메모를 읽습니다.',
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      async execute(input) {
        const requestedDate = input && typeof input === 'object' && 'date' in input
          ? (input as { date?: unknown }).date
          : undefined;
        if (requestedDate !== undefined && (typeof requestedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate))) {
          throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');
        }
        const selectedDate = typeof requestedDate === 'string' ? requestedDate : batchRef.current.date;
        const selected = await readServerBatch(selectedDate);
        if (!selected) return { found: false, date: requestedDate };
        return {
          found: true,
          date: selected.date,
          batchMemo: selected.batchMemo,
          scheduledTime: selected.scheduledTime,
          automationEnabled: selected.automationEnabled,
          publishMode: selected.publishMode,
          agents: selected.groups.map((group) => ({
            agent: group.agent,
            items: group.items
              .filter((item) => item.itemNumber.trim())
              .map(({ itemNumber, price, shippingPolicy, memo }) => ({
                itemNumber: itemNumber.trim(),
                price: formatPrice(price),
                shippingPolicy,
                memo: memo.trim(),
              })),
          })),
        };
      },
    }, { signal: lifecycle.signal })];
    void Promise.all(registrations.map((registration) => Promise.resolve(registration))).catch(() => undefined);
    return () => lifecycle.abort();
  }, [ready]);

  const itemCount = useMemo(
    () => groups.reduce(
      (total, group) => total + group.items.filter((item) => item.itemNumber.trim()).length,
      0,
    ),
    [groups],
  );

  const changeDate = async (nextDate: string) => {
    if (!nextDate) return;
    setReady(false);
    try {
      const saved = await readServerBatch(nextDate);
      skipAutosaveRef.current = true;
      setDate(nextDate);
      setGroups(saved?.groups ?? makeGroups());
      setBatchMemo(saved?.batchMemo ?? '');
      setAutomationEnabled(saved?.automationEnabled ?? false);
      setPublishMode(saved?.publishMode ?? 'approval');
      setSaveState('saved');
      setCopied(false);
    } catch {
      setSaveState('error');
    } finally {
      setReady(true);
    }
  };

  const updateItem = (agent: number, id: string, patch: Partial<WorkItem>) => {
    setGroups((current) => current.map((group) => group.agent === agent
      ? {
          ...group,
          items: group.items.map((item) => item.id === id ? { ...item, ...patch } : item),
        }
      : group));
    setCopied(false);
  };

  const addItem = (agent: number) => {
    setGroups((current) => current.map((group) => group.agent === agent
      ? { ...group, items: [...group.items, makeItem()] }
      : group));
  };

  const removeItem = (agent: number, id: string) => {
    setGroups((current) => current.map((group) => {
      if (group.agent !== agent || group.items.length <= 1) return group;
      return { ...group, items: group.items.filter((item) => item.id !== id) };
    }));
  };

  const clearBatch = async () => {
    if (!date) return;
    const response = await fetch(`/api/listing-work?date=${encodeURIComponent(date)}`, { method: 'DELETE' });
    if (!response.ok) {
      setSaveState('error');
      return;
    }
    skipAutosaveRef.current = true;
    window.localStorage.removeItem(`${STORAGE_PREFIX}${date}`);
    setGroups(makeGroups());
    setBatchMemo('');
    setAutomationEnabled(false);
    setPublishMode('approval');
    setSaveState('saved');
    setCopied(false);
  };

  const copyRequest = async () => {
    const lines: string[] = [`작업일: ${date}`];
    groups.forEach((group) => {
      const validItems = group.items.filter((item) => item.itemNumber.trim());
      if (!validItems.length) return;
      lines.push('', `${group.agent}번 에이전트`);
      validItems.forEach((item) => {
        const details = [
          item.itemNumber.trim(),
          formatPrice(item.price),
          item.shippingPolicy,
        ];
        if (item.memo.trim()) details.push(`메모: ${item.memo.trim()}`);
        lines.push(details.join('   '));
      });
    });
    if (batchMemo.trim()) lines.push('', `전체 메모: ${batchMemo.trim()}`);
    await navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (!ready) return <main className="listing-loading">작업표를 불러오는 중입니다.</main>;

  return (
    <main className="listing-shell">
      <header className="listing-header">
        <div className="listing-brand">
          <span className="listing-logo">KA</span>
          <div>
            <strong>KOREA AUTOPARTS</strong>
            <span>EBAY LISTING DESK</span>
          </div>
        </div>
        <div className="listing-date-control">
          <CalendarDays size={19} />
          <label htmlFor="work-date">작업 날짜</label>
          <input
            id="work-date"
            type="date"
            value={date}
            onChange={(event) => void changeDate(event.target.value)}
          />
        </div>
      </header>

      <section className="listing-intro">
        <div>
          <p>오늘의 등록 작업</p>
          <h1>아이템 번호와 가격을 입력하세요</h1>
        </div>
        <div className="listing-summary" aria-label="입력 현황">
          <span>{date}</span>
          <strong>{itemCount}개 상품</strong>
          <em><Check size={15} /> {saveState === 'saving' ? '서버 저장 중' : saveState === 'error' ? '저장 재시도 필요' : '서버 자동 저장'}</em>
        </div>
      </section>

      <section className="automation-panel" aria-label="클라우드 자동 작업 설정">
        <div className="automation-copy">
          <p>CLOUD AUTOMATION</p>
          <h2>컴퓨터가 꺼져 있어도 예약 시간에 시작</h2>
          <span>미국 계정을 먼저 완료한 뒤 호주 계정 작업을 시작합니다.</span>
        </div>
        <label>
          <span>실행 시간 · 한국</span>
          <strong className="fixed-run-time">오후 5:00</strong>
        </label>
        <label>
          <span>최종 등록 방식</span>
          <select value={publishMode} onChange={(event) => setPublishMode(event.target.value as 'automatic' | 'approval')}>
            <option value="approval">휴대폰 승인 후 등록</option>
            <option value="automatic">검수 통과 시 자동 등록</option>
          </select>
        </label>
        <label className="automation-switch">
          <input type="checkbox" checked={automationEnabled} onChange={(event) => setAutomationEnabled(event.target.checked)} />
          <span>{automationEnabled ? '자동 작업 사용' : '자동 작업 중지'}</span>
        </label>
      </section>

      <section className="listing-layout">
        <div className="agent-board">
          {groups.map((group) => (
            <article className={`agent-card agent-${group.agent}`} key={group.agent}>
              <div className="agent-card-title">
                <div>
                  <span>{group.agent}</span>
                  <div>
                    <p>AGENT {String(group.agent).padStart(2, '0')}</p>
                    <h2>{group.agent}번 에이전트</h2>
                  </div>
                </div>
                <strong>{group.items.filter((item) => item.itemNumber.trim()).length}개</strong>
              </div>

              <div className="work-table-head" aria-hidden="true">
                <span>아이템 번호</span>
                <span>판매가격</span>
                <span>배송 정책</span>
                <span>상품 메모</span>
                <span />
              </div>

              <div className="work-rows">
                {group.items.map((item, index) => (
                  <div className="work-row" key={item.id}>
                    <span className="work-index">{index + 1}</span>
                    <label>
                      <span>아이템 번호</span>
                      <input
                        inputMode="numeric"
                        placeholder="예: 333919045601"
                        value={item.itemNumber}
                        onChange={(event) => updateItem(group.agent, item.id, { itemNumber: event.target.value })}
                      />
                    </label>
                    <label className="price-input">
                      <span>판매가격</span>
                      <b>$</b>
                      <input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={item.price}
                        onChange={(event) => updateItem(group.agent, item.id, { price: event.target.value.replace(/^\$/, '') })}
                      />
                    </label>
                    <label>
                      <span>배송 정책</span>
                      <select
                        value={item.shippingPolicy}
                        onChange={(event) => updateItem(group.agent, item.id, { shippingPolicy: event.target.value as ShippingPolicy })}
                      >
                        <option value="7day normal">7day normal</option>
                        <option value="7day fast">7day fast</option>
                      </select>
                    </label>
                    <label>
                      <span>상품 메모</span>
                      <input
                        placeholder="확인할 내용"
                        value={item.memo}
                        onChange={(event) => updateItem(group.agent, item.id, { memo: event.target.value })}
                      />
                    </label>
                    <button
                      className="row-delete"
                      type="button"
                      aria-label={`${group.agent}번 에이전트 ${index + 1}번째 상품 삭제`}
                      disabled={group.items.length <= 1}
                      onClick={() => removeItem(group.agent, item.id)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
              </div>

              <button className="add-work-row" type="button" onClick={() => addItem(group.agent)}>
                <Plus size={17} /> 상품 추가
              </button>
            </article>
          ))}
        </div>

        <aside className="batch-memo-card">
          <div className="memo-title">
            <span><StickyNote size={20} /></span>
            <div>
              <p>DAILY NOTE</p>
              <h2>전체 메모</h2>
            </div>
          </div>
          <textarea
            value={batchMemo}
            onChange={(event) => setBatchMemo(event.target.value)}
            placeholder={'오늘 작업에서 공통으로 확인할 내용을 적으세요.\n\n예: 원산지는 비워두고 확인\n사진 라벨의 품번을 다시 점검'}
          />
          <div className="memo-guide">
            <FileText size={17} />
            <p>입력한 내용은 날짜별로 서버에 자동 저장되어 작업 에이전트가 바로 읽을 수 있습니다.</p>
          </div>
        </aside>
      </section>

      <footer className="listing-actions">
        <button className="clear-listing" type="button" onClick={() => void clearBatch()}>
          <RotateCcw size={18} /> 오늘 입력 비우기
        </button>
        <button className={`copy-listing ${copied ? 'copied' : ''}`} type="button" onClick={copyRequest} disabled={itemCount === 0}>
          {copied ? <Check size={19} /> : <ClipboardCopy size={19} />}
          {copied ? '복사했습니다' : '작업 요청문 복사'}
        </button>
      </footer>
    </main>
  );
}
