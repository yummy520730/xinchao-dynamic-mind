import { createHash } from 'node:crypto';

function driveHints(drives = []) {
  return (Array.isArray(drives) ? drives : [])
    .slice(0, 3)
    .map((item) => String(item?.label ?? item?.key ?? '').trim())
    .filter(Boolean)
    .join('、');
}

function bridgeMaterial(result, maxChars = 10000) {
  const signals = new Set();
  for (const item of Array.isArray(result?.items) ? result.items : []) {
    for (const value of [item?.category, item?.thread]) {
      const clean = String(value ?? '').trim().toLowerCase();
      if (clean) signals.add(clean);
    }
  }
  return {
    text: String(result?.context ?? '').slice(0, maxChars),
    signals: [...signals].slice(0, 16),
  };
}

export class OmbreClient {
  constructor(config) {
    this.config = config;
    this.sessionId = null;
    this.initializePromise = null;
  }

  async bridgePost(path, payload) {
    if (!this.config.bridgeUrl) throw new Error('MEMORY_BRIDGE_URL is required for lmc5_bridge transport');
    if (!this.config.bridgeToken) throw new Error('MEMORY_BRIDGE_TOKEN is required for lmc5_bridge transport');
    const response = await fetch(`${this.config.bridgeUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        Authorization: `Bearer ${this.config.bridgeToken}`,
        'X-Memory-Caller': 'xinchao-dynamic-mind',
      },
      body: JSON.stringify(payload), redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { throw new Error(`LMC-5 bridge returned invalid JSON: HTTP ${response.status}`); }
    if (!response.ok) throw new Error(`LMC-5 bridge failed: HTTP ${response.status} ${String(data.error ?? '').slice(0, 160)}`);
    return data;
  }

  async post(payload, expectBody = true) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'X-Ombre-Caller': 'dynamic-mind',
    };
    if (this.config.token) headers.Authorization = `Bearer ${this.config.token}`;
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    const response = await fetch(this.config.url, {
      method: 'POST', headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Ombre MCP failed: HTTP ${response.status}`);
    this.sessionId = response.headers.get('mcp-session-id') ?? this.sessionId;
    if (!expectBody) return null;
    const text = await response.text();
    return text ? parseMcp(text) : null;
  }

  async initialize() {
    if (this.sessionId) return;
    if (!this.initializePromise) {
      this.initializePromise = (async () => {
        await this.post({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'xinchao-dynamic-mind', version: '2.5.14-lmc.1' },
          },
        });
        if (!this.sessionId) throw new Error('Ombre MCP did not return a session id');
        await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);
      })().finally(() => { this.initializePromise = null; });
    }
    return this.initializePromise;
  }

  async call(name, args = {}) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.initialize();
      try {
        return await this.post({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } });
      } catch (error) {
        if (attempt || !/HTTP (400|404)/.test(error.message)) throw error;
        this.sessionId = null;
      }
    }
    throw new Error('Ombre MCP call failed after session refresh');
  }

  async recentMaterialBundle(drives = []) {
    if (this.config.transport === 'lmc5_bridge') {
      const hints = driveHints(drives);
      const result = await this.bridgePost('/bridge/xinchao/recall', {
        query: `近期重要记忆、情绪、关系变化和未完成事项${hints ? `；当前心潮主题：${hints}` : ''}；排除以前由心潮生成的梦境`,
        max_results: this.config.breathMaxResults, max_tokens: this.config.breathMaxTokens,
        exclude_sources: ['xinchao'],
      });
      return bridgeMaterial(result);
    }
    const result = await this.call(this.config.readTool ?? 'breath', {
      query: '近期重要记忆、情绪、关系变化和未完成事项',
      max_results: this.config.breathMaxResults,
      max_tokens: this.config.breathMaxTokens
    });
    return { text: extractText(result).slice(0, 10000), signals: [] };
  }

  async recentMaterial(drives = []) {
    return (await this.recentMaterialBundle(drives)).text;
  }

  async daytimeMaterialBundle(drives = []) {
    if (this.config.transport === 'lmc5_bridge') {
      const hints = driveHints(drives);
      const result = await this.bridgePost('/bridge/xinchao/recall', {
        query: `白天自然浮现的近期记忆、具体细节、未说完的话和当下牵挂${hints ? `；当前心潮主题：${hints}` : ''}；排除以前由心潮生成的梦境`,
        max_results: this.config.breathMaxResults, max_tokens: this.config.breathMaxTokens,
        exclude_sources: ['xinchao'],
      });
      return bridgeMaterial(result);
    }
    const result = await this.call(this.config.readTool ?? 'breath', {
      query: '白天自然浮现的近期记忆、具体细节、未说完的话和当下牵挂；不要返回系统配置或技术信息',
      max_results: this.config.breathMaxResults,
      max_tokens: this.config.breathMaxTokens
    });
    return { text: extractText(result).slice(0, 10000), signals: [] };
  }

  async daytimeMaterial(drives = []) {
    return (await this.daytimeMaterialBundle(drives)).text;
  }

  async recentContinuityMaterial(maxTokens = this.config.breathMaxTokens) {
    if (this.config.transport === 'lmc5_bridge') {
      const result = await this.bridgePost('/bridge/xinchao/recall', {
        query: '新窗口近期连续性：只返回最近事件、人物关系变化、生活重点和未完成约定；排除基岩、部署信息和心潮梦境。',
        max_results: Math.max(3, Math.min(8, Number(this.config.breathMaxResults) || 3)),
        max_tokens: Math.max(200, Math.min(3000, Number(maxTokens) || 1600)),
        exclude_sources: ['xinchao'],
      });
      return String(result.context ?? '').slice(0, 16000);
    }
    const result = await this.call(this.config.readTool ?? 'breath', {
      query: [
        '新窗口近期连续性：只返回最近发生了什么，以及仍直接影响现在的人物与关系变化、生活重点和未完成约定。',
        '不要返回核心准则、自我基岩或长期画像；这些由客户端从自己的核心指令和长期记忆单独完整读取。',
        '不要返回部署、代码、接口、密钥、系统日志或已经过期的技术待办。',
      ].join(''),
      max_results: Math.max(3, Math.min(8, Number(this.config.breathMaxResults) || 3)),
      max_tokens: Math.max(200, Math.min(3000, Number(maxTokens) || 1600)),
    });
    return extractText(result).slice(0, 16000);
  }

  // Compatibility alias for older callers.  It intentionally returns only
  // recent continuity; it is not a replacement for repository bedrock.
  async handoffMaterial(maxTokens = this.config.breathMaxTokens) {
    return this.recentContinuityMaterial(maxTokens);
  }

  async storeDream(dream) {
    if (!this.config.writeEnabled) return null;
    const content = [
      `梦境：${dream.dream}`,
      `梦境余韵：${dream.residue}`,
      `醒后意识：${dream.awareness}`,
      '说明：这是睡眠结算产生的梦境，不是现实事件；调用外部记忆服务不等于醒来。'
    ].join('\n');
    if (this.config.transport === 'lmc5_bridge') {
      const stableFingerprint = String(dream.fingerprint || createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 24));
      const result = await this.bridgePost('/bridge/xinchao/candidates', {
        external_id: `dream:${stableFingerprint}`,
        content_fingerprint: stableFingerprint,
        title: `心潮梦境 · ${String(dream.createdAt ?? '').slice(0, 16).replace('T', ' ')}`,
        content, category: 'episode', thread: 'reflection', importance: 5.5,
        privacy_scope: 'personal', relation_terms: ['心潮', '梦境', dream.source ?? 'rules'],
      });
      return String(result.candidate_id ?? '');
    }
    const result = await this.call(this.config.writeTool ?? 'hold', {
      content,
      tags: 'dream',
      importance: 7,
      auto: true,
      source: 'xinchao-dream',
    });
    const text = extractText(result);
    return text.match(/[a-f0-9]{12,}/i)?.[0] ?? null;
  }
}

function parseMcp(text) {
  const data = text.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim() ?? text;
  return JSON.parse(data);
}

function extractText(result) {
  const content = result?.result?.content ?? result?.content ?? [];
  return content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}
