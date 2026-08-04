export class NtfyClient {
  constructor(config) { this.config = config; }

  async send(message, title = this.config.title) {
    if (!this.config.enabled || !this.config.topic) return { sent: false, reason: 'disabled' };
    const headers = { 'Content-Type': 'application/json' };
    if (this.config.token) headers.Authorization = `Bearer ${this.config.token}`;
    const response = await fetch(`${this.config.server}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        topic: this.config.topic,
        title,
        message,
        tags: this.config.tags,
        priority: this.config.priority,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`ntfy failed: HTTP ${response.status}`);
    return { sent: true };
  }
}
