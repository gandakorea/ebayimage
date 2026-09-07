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

type ShippingPolicy = '7day normal' | '7day fast';

type WorkItem = {
  id: string;
  itemNumber: string;
  price: string;
  shippingPolicy: ShippingPolicy;
  memo: string;
};

type AgentGroup = {
  agent: number;
  items: WorkItem[];
};

type SavedBatch = {
  date: string;
  batchMemo: string;
  groups: AgentGroup[];
};

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

function readBatch(date: string): SavedBatch | null {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${date}`);
    return raw ? JSON.parse(raw) as SavedBatch : null;
  } catch {
    return null;
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
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const batchRef = useRef<SavedBatch>({ date: '', batchMemo: '', groups: [] });

  batchRef.current = { date, batchMemo, groups };

  useEffect(() => {
    const currentDate = todayInKorea();
    const saved = readBatch(currentDate);
    setDate(currentDate);
    setGroups(saved?.groups ?? makeGroups());
    setBatchMemo(saved?.batchMemo ?? '');
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !date || groups.length === 0) return;
    const batch: SavedBatch = { date, batchMemo, groups };
    window.localStorage.setItem(`${STORAGE_PREFIX}${date}`, JSON.stringify(batch));
  }, [batchMemo, date, groups, ready]);

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
      execute(input) {
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
        if (typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date)) setDate(value.date);
        if (typeof value.batchMemo === 'string') setBatchMemo(value.batchMemo);
        setGroups(nextGroups);
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
      execute(input) {
        const requestedDate = input && typeof input === 'object' && 'date' in input
          ? (input as { date?: unknown }).date
          : undefined;
        if (requestedDate !== undefined && (typeof requestedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate))) {
          throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');
        }
        const current = batchRef.current;
        const selected = typeof requestedDate === 'string' && requestedDate !== current.date
          ? readBatch(requestedDate)
          : current;
        if (!selected) return { found: false, date: requestedDate };
        return {
          found: true,
          date: selected.date,
          batchMemo: selected.batchMemo,
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

  const changeDate = (nextDate: string) => {
    if (!nextDate) return;
    const saved = readBatch(nextDate);
    setDate(nextDate);
    setGroups(saved?.groups ?? makeGroups());
    setBatchMemo(saved?.batchMemo ?? '');
    setCopied(false);
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

  const clearBatch = () => {
    if (!date) return;
    window.localStorage.removeItem(`${STORAGE_PREFIX}${date}`);
    setGroups(makeGroups());
    setBatchMemo('');
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
            onChange={(event) => changeDate(event.target.value)}
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
          <em><Check size={15} /> 자동 저장</em>
        </div>
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
            <p>입력한 내용은 선택한 날짜별로 이 브라우저에 자동 저장됩니다.</p>
          </div>
        </aside>
      </section>

      <footer className="listing-actions">
        <button className="clear-listing" type="button" onClick={clearBatch}>
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
