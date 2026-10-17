const copy = value => JSON.parse(JSON.stringify(value));
const methods = new Set(['change','predict','experiment','reason','complete','next','flow','help','checkpoint','evaluate','navHelp']);

export function createRpgScene(initialHost) {
  const { root } = initialHost;
  const origin = window.location.origin;
  const sessionId = globalThis.crypto?.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  const fallback = new URL(window.location.href);
  fallback.searchParams.set('engine','legacy');
  let host = initialHost, disposed = false, ready = false;
  const replies = new Map();
  root.innerHTML = `<section class="rpg-shell"><div class="rpg-heading"><p>智慧园区 · 设备调试员</p><span>方向键 / WASD 行走 · E / 空格交互</span></div><iframe class="rpg-frame" src="/rpgjs/?session=${encodeURIComponent(sessionId)}" title="RPGJS 智慧园区探究场景" allow="fullscreen"></iframe><p id="rpg-status" class="rpg-status" role="status">正在准备园区地图与角色…</p><p id="rpg-fallback" class="rpg-fallback" hidden>场景尚未加载完成，学习记录已保留。<a href="${fallback.href.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">使用原版继续学习</a></p></section>`;
  const frame = root.querySelector('iframe');
  const status = root.querySelector('#rpg-status');
  const fallbackMessage = root.querySelector('#rpg-fallback');
  const context = () => copy({ levelId:host.levelId, draft:host.getDraft(), runs:host.getRuns(), level:host.getLevel() || {}, evidenceStart:host.getEvidenceStart(), demo:!!host.demo, reasons:(host.reasons || []).map(r=>Array.isArray(r)?{value:r[0],label:r[1]}:r) });
  const post = data => { if (!disposed) frame.contentWindow?.postMessage({ ...data, sessionId },origin); };
  const failed = () => {
    if (disposed || ready) return;
    status.textContent = '园区场景还没有准备好，可重新打开页面或使用原版继续。';
    fallbackMessage.hidden = false;
  };
  const timer = setTimeout(failed,20000);
  frame.addEventListener('error',failed);
  function refresh() { if (ready) post({type:'rpgjs-context',context:context()}); }
  async function receive(event) {
    const message = event.data;
    if (disposed || event.origin !== origin || event.source !== frame.contentWindow || !message || message.sessionId !== sessionId) return;
    if (message.type === 'rpgjs-ready') {
      ready = true;
      clearTimeout(timer);
      status.hidden = true;
      fallbackMessage.hidden = true;
      post({type:'rpgjs-init',context:context()});
      return;
    }
    if (message.type !== 'rpgjs-call' || typeof message.requestId !== 'string' || !message.requestId || message.requestId.length > 120) return;
    if (replies.has(message.requestId)) { post(await replies.get(message.requestId)); return; }
    const response = (async () => {
      try {
        if (!ready || !methods.has(message.method)) throw new Error('场景请求尚未准备好或不受支持。');
        const payload = message.payload || {};
        if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error('场景请求内容不正确。');
        if (payload.levelId && payload.levelId !== host.levelId) throw new Error('任务场景已切换，请继续当前任务。');
        const { levelId, ...data } = payload;
        let value;
        switch (message.method) {
          case 'change': value = host.onChange(data.patch || data); break;
          case 'predict': value = host.onPrediction(data); break;
          case 'evaluate': value = host.onEvaluate(data); break;
          case 'experiment': value = host.onExperiment(data); break;
          case 'reason': value = host.onReason(data.value ?? data.reason); break;
          case 'complete': value = host.onComplete({deferRender:true}); break;
          case 'next': value = host.onNext(); break;
          case 'flow': value = host.onFlow(); break;
          case 'help': value = host.onHelp(); break;
          case 'checkpoint': value = host.onChange({rpg:data.rpg || data}); break;
          case 'navHelp': value = host.onNavHelp?.(data); break;
        }
        value = await value;
        return {type:'rpgjs-result',requestId:message.requestId,result:{context:context(),value:value ?? null}};
      } catch (error) {
        return {type:'rpgjs-result',requestId:message.requestId,result:{context:context(),value:null},error:error.message || '场景操作未完成，请重试。'};
      }
    })();
    replies.set(message.requestId,response);
    post(await response);
  }
  window.addEventListener('message',receive);
  return {
    engine:'rpgjs', refresh,
    navigate(levelId) {
      if (disposed || levelId === host.levelId) return;
      host = initialHost.forLevel(levelId);
      refresh();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener('message',receive);
      frame.remove();
      replies.clear();
    }
  };
}
