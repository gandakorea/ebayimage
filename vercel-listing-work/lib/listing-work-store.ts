export type ShippingPolicy = '7day normal' | '7day fast';
export type PreparationStatus = 'waiting' | 'ready' | 'working' | 'completed' | 'needs_attention';

export type WorkItem = {
  id: string;
  itemNumber: string;
  price: string;
  shippingPolicy: ShippingPolicy;
  memo: string;
  preparationStatus?: PreparationStatus;
  partNumber?: string;
  photoCount?: number;
  statusUpdatedAt?: string;
};

export type AgentGroup = {
  agent: number;
  items: WorkItem[];
};

export type SavedBatch = {
  date: string;
  batchMemo: string;
  groups: AgentGroup[];
  scheduledTime: string;
  automationEnabled: boolean;
  publishMode: 'automatic' | 'approval';
  automationStatus?: 'waiting' | 'queued' | 'running' | 'needs_attention' | 'completed';
};
