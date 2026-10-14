export function reconcileState(local, remote, preserveDrafts = true) {
  return { ...remote, drafts: preserveDrafts ? local.drafts : remote.drafts };
}

export class SyncQueue {
  constructor(storage, send, onResult = () => {}) {
    this.storage = storage;
    this.send = send;
    this.onResult = onResult;
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
        this.error = error.message;
        blocked.add(key);
      }
    }
  }
}
