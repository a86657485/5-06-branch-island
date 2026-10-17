export type BridgeMethod =
  | 'change' | 'predict' | 'experiment' | 'reason' | 'complete'
  | 'next' | 'flow' | 'help' | 'checkpoint' | 'evaluate' | 'navHelp';

export interface LessonContext {
  levelId: string;
  draft: Record<string, any>;
  runs: any[];
  level: Record<string, any>;
  evidenceStart: number;
  demo: boolean;
  reasons: Array<{ value: string; label: string }>;
  [key: string]: any;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let context: LessonContext | undefined;
let sessionId = '';
let initialized = false;
let disposed = false;
let readyPromise: Promise<LessonContext> | undefined;
let resolveReady: ((value: LessonContext) => void) | undefined;
let rejectReady: ((error: Error) => void) | undefined;
let handshakeTimer: ReturnType<typeof setInterval> | undefined;
let handshakeDeadline: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<string, PendingRequest>();
const listeners = new Set<(value: LessonContext) => void>();

function setContext(value: LessonContext) {
  const previousLevelId = context?.levelId;
  context = value;
  if (previousLevelId && previousLevelId !== value.levelId) {
    window.dispatchEvent(new CustomEvent('lesson-level-changed'));
  }
  resolveReady?.(value);
  for (const listener of listeners) listener(value);
}

function reportError(error: Error) {
  window.dispatchEvent(new CustomEvent('lesson-bridge-error', { detail: error.message }));
}

function receive(event: MessageEvent) {
  if (event.origin !== window.location.origin || event.source !== window.parent) return;
  const message = event.data;
  if (!message || typeof message !== 'object' || message.sessionId !== sessionId) return;
  if ((message.type === 'rpgjs-init' || message.type === 'rpgjs-context') && message.context) {
    if (typeof message.context.levelId !== 'string') return;
    if (handshakeTimer) clearInterval(handshakeTimer);
    if (handshakeDeadline) clearTimeout(handshakeDeadline);
    setContext(message.context);
  } else if (message.type === 'rpgjs-result' && typeof message.requestId === 'string') {
    const request = pending.get(message.requestId);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.requestId);
    if (message.result?.context) setContext(message.result.context);
    if (message.error) {
      const error = new Error(String(message.error));
      reportError(error);
      request.reject(error);
    }
    else request.resolve(message.result?.value);
  }
}

export function ready(): Promise<LessonContext> {
  if (disposed) return Promise.reject(new Error('园区已关闭。'));
  if (readyPromise) return readyPromise;
  if (typeof window === 'undefined') return Promise.reject(new Error('课堂桥接仅用于浏览器。'));
  readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  sessionId = new URLSearchParams(window.location.search).get('session') ?? '';
  if (!sessionId || window.parent === window) {
    rejectReady?.(new Error('请从本课学生入口进入园区。'));
    return readyPromise;
  }
  initialized = true;
  window.addEventListener('message', receive);
  const announce = () => window.parent.postMessage({ type: 'rpgjs-ready', sessionId }, window.location.origin);
  announce();
  handshakeTimer = setInterval(announce, 1000);
  handshakeDeadline = setTimeout(() => {
    if (handshakeTimer) clearInterval(handshakeTimer);
    rejectReady?.(new Error('课堂连接暂未回应，请重新加载园区。已保存的学习记录会保留。'));
  }, 15000);
  return readyPromise;
}

export function getContext(): LessonContext | undefined {
  return context;
}

export async function request<T = unknown>(method: BridgeMethod, payload: unknown = {}): Promise<T> {
  await ready();
  if (disposed) throw new Error('园区已关闭。');
  const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      const error = new Error('课堂同步暂未回应，本次操作尚未确认，请关闭提示后重试。');
      reportError(error);
      reject(error);
    }, 15000);
    pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer });
    window.parent.postMessage({ type: 'rpgjs-call', sessionId, requestId, method, payload }, window.location.origin);
  });
}

export function subscribeContext(callback: (value: LessonContext) => void): () => void {
  listeners.add(callback);
  if (context) callback(context);
  return () => listeners.delete(callback);
}

export function dispose() {
  if (disposed) return;
  disposed = true;
  if (handshakeTimer) clearInterval(handshakeTimer);
  if (handshakeDeadline) clearTimeout(handshakeDeadline);
  if (initialized) window.removeEventListener('message', receive);
  rejectReady?.(new Error('园区已关闭。'));
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error('园区已关闭。'));
  }
  pending.clear();
  listeners.clear();
}
