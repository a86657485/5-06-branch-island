export function reconcileState(local, remote, preserveDrafts = true) {
  if (!preserveDrafts || !local?.drafts) return { ...remote, drafts: preserveDrafts ? local?.drafts : remote.drafts };
  const drafts = { ...(remote.drafts || {}) };
  for (const [id, draft] of Object.entries(local.drafts)) {
    const remoteDraft = drafts[id];
    if (draft && remoteDraft && typeof draft === 'object') {
      if (!draft.config && remoteDraft.config) draft.config = remoteDraft.config;
      if (!draft.flow && remoteDraft.flow) draft.flow = remoteDraft.flow;
      if (!draft.input && remoteDraft.input) draft.input = remoteDraft.input;
      if (!draft.sentence && remoteDraft.sentence) draft.sentence = remoteDraft.sentence;
    }
    drafts[id] = draft;
  }
  return { ...remote, drafts };
}

export class SyncQueue {
  constructor(storage, send, onResult = () => {}, onArchived = () => {}, onRejected = () => {}) {
    this.storage = storage;
    this.send = send;
    this.onResult = onResult;
    this.onArchived = onArchived;
    this.onRejected = onRejected;
    this.archiveKey = 'branch-island-archived-events-v1';
    this.key = 'branch-island-pending-v1';
    this.events = JSON.parse(storage.getItem(this.key) || '[]');
    this.error = '';
    this.running = null;
  }
  save() { this.storage.setItem(this.key, JSON.stringify(this.events)); }
  add(event) {
    if (!this.events.some(e => e.eventId === event.eventId && e.studentId === event.studentId)) {
      this.events.push(event);
      this.save();
    }
  }
  pending(id) { return this.events.filter(e => !id || e.studentId === id).length; }
  retire(studentId, round) {
    const stale = this.events.filter(event => event.studentId === studentId && event.round !== round);
    if (!stale.length) return;
    const archive = JSON.parse(this.storage.getItem(this.archiveKey) || '[]');
    for (const event of stale) archive.push({ event, reason: '上一课次的记录只保留，不带入新课次', archivedAt: new Date().toISOString() });
    this.storage.setItem(this.archiveKey, JSON.stringify(archive));
    this.events = this.events.filter(event => !(event.studentId === studentId && event.round !== round));
    this.save();
  }
  archived(id) { return JSON.parse(this.storage.getItem(this.archiveKey) || '[]').filter(item => !id || item.event.studentId === id); }
  flush() {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }
  async drain() {
    this.error = '';
    const blocked = new Set();
    for (const event of [...this.events]) {
      const key = `${event.studentId}:${event.round}`;
      if (blocked.has(key)) continue;
      try {
        const result = await this.send(event);
        this.events = this.events.filter(e => e !== event);
        this.save();
        this.onResult(event, result);
      } catch (error) {
        if (event.type === 'quiz' && error.code === 'QUIZ_VERSION_MISMATCH') {
          const archive = JSON.parse(this.storage.getItem(this.archiveKey) || '[]');
          archive.push({ event, reason: error.message, archivedAt: new Date().toISOString() });
          this.storage.setItem(this.archiveKey, JSON.stringify(archive));
          this.events = this.events.filter(e => e !== event);
          this.save();
          this.onArchived(event, error);
          continue;
        }
        if (error.status === 400) {
          const archive = JSON.parse(this.storage.getItem(this.archiveKey) || '[]');
          archive.push({ event, reason: error.message, archivedAt: new Date().toISOString() });
          this.storage.setItem(this.archiveKey, JSON.stringify(archive));
          this.events = this.events.filter(e => e !== event);
          this.save();
          this.error = error.message;
          this.onRejected(event, error);
          continue;
        }
        this.error = error.message;
        blocked.add(key);
      }
    }
  }
}
