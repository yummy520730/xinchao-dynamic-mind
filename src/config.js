function bool(name, fallback = false) {
  const raw = process.env[name];
  return raw == null ? fallback : ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function number(name, fallback, min, max) {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be numeric`);
  return Math.max(min, Math.min(max, parsed));
}

export function loadConfig() {
  const agentName = process.env.AGENT_NAME ?? '心潮';
  const notificationRecipient = process.env.NOTIFICATION_RECIPIENT ?? '用户';
  const statePath = process.env.STATE_PATH ?? '/app/state/state.json';
  return {
    identity: { agentName, notificationRecipient },
    port: number('PORT', 18110, 1, 65535),
    serviceToken: process.env.SERVICE_TOKEN ?? '',
    statePath,
    journalPath: process.env.TRANSITION_JOURNAL_PATH ?? '/app/state/transitions.jsonl',
    settleIntervalMinutes: number('SETTLE_INTERVAL_MINUTES', 15, 1, 1440),
    sleepAfterMinutes: number('SLEEP_AFTER_MINUTES', 90, 5, 10080),
    shadowMode: bool('SHADOW_MODE', true),
    model: {
      enabled: bool('MODEL_ENABLED', false),
      baseUrl: (process.env.MODEL_BASE_URL ?? 'http://127.0.0.1:11434/v1').replace(/\/$/, ''),
      apiKey: process.env.MODEL_API_KEY ?? '',
      name: process.env.MODEL_NAME ?? 'local-model',
      timeoutMs: number('MODEL_TIMEOUT_MS', 30000, 1000, 120000),
      maxInputChars: number('MODEL_MAX_INPUT_CHARS', 10000, 1000, 50000),
      maxOutputTokens: number('MODEL_MAX_OUTPUT_TOKENS', 650, 100, 4000),
      dreamPushPromptPath: process.env.DREAM_PUSH_PROMPT_PATH ?? '/app/configs/dream_push_prompt.md',
      agentName,
      notificationRecipient,
    },
    dreamMinIntervalHours: number('DREAM_MIN_INTERVAL_HOURS', 6, 1, 168),
    dreamMaxPerDay: number('DREAM_MAX_PER_DAY', 4, 1, 12),
    dreamDuplicateThreshold: number('DREAM_DUPLICATE_THRESHOLD', 0.62, 0.4, 1),
    dreamRetryAttempts: number('DREAM_RETRY_ATTEMPTS', 3, 1, 5),
    ombre: {
      transport: process.env.MEMORY_TRANSPORT ?? 'lmc5_bridge',
      url: process.env.MEMORY_MCP_URL ?? process.env.OMBRE_MCP_URL ?? '',
      token: process.env.MEMORY_MCP_TOKEN ?? process.env.OMBRE_MCP_TOKEN ?? '',
      bridgeUrl: (process.env.MEMORY_BRIDGE_URL ?? process.env.OMBRE_BRIDGE_URL ?? '').replace(/\/$/, ''),
      bridgeToken: process.env.MEMORY_BRIDGE_TOKEN ?? process.env.OMBRE_BRIDGE_TOKEN ?? '',
      readEnabled: bool('MEMORY_READ_ENABLED', bool('OMBRE_READ_ENABLED', false)),
      writeEnabled: bool('MEMORY_WRITE_ENABLED', bool('OMBRE_WRITE_ENABLED', false)),
      readTool: process.env.MEMORY_READ_TOOL ?? 'breath',
      writeTool: process.env.MEMORY_WRITE_TOOL ?? 'hold',
      breathMaxResults: number('MEMORY_BREATH_MAX_RESULTS', number('OMBRE_BREATH_MAX_RESULTS', 3, 1, 10), 1, 10),
      breathMaxTokens: number('MEMORY_BREATH_MAX_TOKENS', number('OMBRE_BREATH_MAX_TOKENS', 800, 200, 3000), 200, 3000)
    },
    context: {
      enabled: bool('CONTEXT_ENVELOPE_ENABLED', true),
      ombreEnabled: bool('CONTEXT_MEMORY_ENABLED', bool('CONTEXT_OMBRE_ENABLED', false)),
      // This budget only carries short-lived state and recent continuity.
      // Stable identity/core instructions are loaded separately by the client
      // and must never be squeezed into this short-lived envelope.
      defaultMaxTokens: number('CONTEXT_DEFAULT_MAX_TOKENS', 2200, 200, 4000),
      ombreMaxTokens: number('CONTEXT_OMBRE_MAX_TOKENS', 1600, 200, 3000),
      ttlMinutes: number('CONTEXT_TTL_MINUTES', 15, 1, 180),
      handoffOnceHours: number('CONTEXT_HANDOFF_ONCE_HOURS', 12, 1, 168),
    },
    mcp: {
      enabled: bool('MCP_ENABLED', false),
      pathToken: process.env.MCP_PATH_TOKEN ?? '',
    },
    oauth: {
      enabled: bool('OAUTH_ENABLED', false),
      publicBaseUrl: (process.env.OAUTH_PUBLIC_BASE_URL ?? '').replace(/\/$/, ''),
      approvalToken: process.env.OAUTH_APPROVAL_TOKEN ?? '',
      statePath: process.env.OAUTH_STATE_PATH ?? '/app/state/oauth.json',
      accessTtlSeconds: number('OAUTH_ACCESS_TTL_SECONDS', 86400, 300, 2592000),
      refreshTtlSeconds: number('OAUTH_REFRESH_TTL_SECONDS', 31536000, 86400, 63072000),
    },
    dashboard: {
      enabled: bool('DASHBOARD_ENABLED', false),
      publicBaseUrl: (process.env.DASHBOARD_PUBLIC_BASE_URL ?? process.env.OAUTH_PUBLIC_BASE_URL ?? '').replace(/\/$/, ''),
      accessToken: process.env.DASHBOARD_ACCESS_TOKEN ?? '',
      sessionTtlSeconds: number('DASHBOARD_SESSION_TTL_SECONDS', 43200, 900, 604800),
      includePrivateText: bool('DASHBOARD_INCLUDE_PRIVATE_TEXT', false),
      dreamLimit: number('DASHBOARD_DREAM_LIMIT', 12, 1, 30),
    },
    interaction: {
      maxEffectsPerDay: number('INTERACTION_MAX_EFFECTS_PER_DAY', 24, 1, 96),
      timeZone: process.env.INTERACTION_TIME_ZONE ?? process.env.SETTLE_TIME_ZONE ?? 'Asia/Shanghai',
    },
    stateSignal: {
      maxPerDay: number('STATE_SIGNAL_MAX_PER_DAY', 12, 1, 96),
      windowMinutes: number('STATE_SIGNAL_WINDOW_MINUTES', 10, 1, 1440),
      maxPerWindow: number('STATE_SIGNAL_MAX_PER_WINDOW', 3, 1, 24),
      timeZone: process.env.STATE_SIGNAL_TIME_ZONE ?? process.env.SETTLE_TIME_ZONE ?? 'Asia/Shanghai',
    },
    bridge: {
      enabled: bool('BRIDGE_ENABLED', false),
      machineToken: process.env.BRIDGE_MACHINE_TOKEN ?? '',
      statePath: process.env.BRIDGE_STATE_PATH ?? '/app/state/bridge-queue.json',
      maxEntries: number('BRIDGE_MAX_ENTRIES', 500, 10, 5000),
      ttlHours: number('BRIDGE_TTL_HOURS', 168, 1, 720),
      pollSeconds: number('BRIDGE_POLL_SECONDS', 15, 2, 300),
    },
    fromMe: {
      statePath: process.env.AI_OUTBOX_PATH ?? statePath.replace(/[^/]+$/, 'from-me.json'),
      maxEntries: number('AI_OUTBOX_MAX_ENTRIES', 100, 10, 1000),
      ttlHours: number('AI_OUTBOX_TTL_HOURS', 168, 1, 720),
    },
    heartbeat: {
      filePath: process.env.MEMORY_HEARTBEAT_FILE ?? process.env.OMBRE_HEARTBEAT_FILE ?? '/memory-data/heartbeat.json',
      // Dream residue may be shared after a shorter quiet period. Autonomous
      // contact stays on the stricter, long-absence threshold below.
      dreamMinIdleHours: number('BARK_DREAM_MIN_CONTACT_IDLE_HOURS', 3, 1, 24),
      proactiveMinIdleHours: number('BARK_MIN_CONTACT_IDLE_HOURS', 12, 1, 720)
    },
    bark: {
      enabled: bool('BARK_ENABLED', false),
      key: process.env.BARK_KEY ?? '',
      server: (process.env.BARK_SERVER ?? 'https://api.day.app').replace(/\/$/, ''),
      title: process.env.BARK_TITLE ?? agentName,
      group: process.env.BARK_GROUP ?? 'xinchao',
      icon: process.env.BARK_ICON ?? '',
      sound: process.env.BARK_SOUND ?? 'silence',
      level: process.env.BARK_LEVEL ?? 'timeSensitive',
      minIntervalHours: number('BARK_MIN_INTERVAL_HOURS', 3, 1, 168),
      autonomousMinIntervalHours: number('BARK_AUTONOMOUS_MIN_INTERVAL_HOURS', 12, 1, 720),
      maxPerDay: number('BARK_MAX_PER_DAY', 6, 1, 24),
      minDrive: number('BARK_MIN_DRIVE', 0.42, 0.05, 1)
    },
    ntfy: {
      enabled: bool('NTFY_ENABLED', false),
      server: (process.env.NTFY_SERVER ?? 'https://ntfy.sh').replace(/\/$/, ''),
      topic: process.env.NTFY_TOPIC ?? '',
      token: process.env.NTFY_TOKEN ?? '',
      title: process.env.NTFY_TITLE ?? agentName,
      tags: (process.env.NTFY_TAGS ?? 'thought_balloon').split(',').map((item) => item.trim()).filter(Boolean),
      priority: number('NTFY_PRIORITY', 4, 1, 5),
    },
    settle: {
      timeZone: process.env.SETTLE_TIME_ZONE ?? process.env.DAYTIME_TIME_ZONE ?? 'Asia/Shanghai',
    },
    daytime: {
      enabled: bool('DAYTIME_EMERGENCE_ENABLED', false),
      timeZone: process.env.DAYTIME_TIME_ZONE ?? 'Asia/Shanghai',
      startHour: number('DAYTIME_START_HOUR', 8, 0, 23),
      endHour: number('DAYTIME_END_HOUR', 23, 1, 24),
      minIntervalHours: number('DAYTIME_MIN_INTERVAL_HOURS', 2, 0.25, 24),
      maxIntervalHours: number('DAYTIME_MAX_INTERVAL_HOURS', 3, 0.25, 24),
      maxPerDay: number('DAYTIME_MAX_PER_DAY', 7, 1, 24)
    },
    satisfaction: {
      amount: number('ACTION_SATISFACTION_AMOUNT', number('OUTPUT_REFLUX_AMOUNT', 0.30, 0.05, 0.6), 0.05, 0.6),
    },
    resonance: {
      enabled: bool('MEMORY_RESONANCE_ENABLED', true),
      nudge: number('MEMORY_RESONANCE_NUDGE', 0.02, 0.005, 0.1),
      perCallCap: number('MEMORY_RESONANCE_PER_CALL_CAP', 0.06, 0.01, 0.3),
    },
    anticipation: {
      enabled: bool('ANTICIPATION_ENABLED', true),
      arrivalGapMinutes: number('ANTICIPATION_ARRIVAL_GAP_MINUTES', 90, 15, 720),
    }
  };
}

export function validateConfig(config) {
  const externalMemoryEnabled = Boolean(
    config.ombre.readEnabled
    || config.ombre.writeEnabled
    || config.context.ombreEnabled
  );
  if (externalMemoryEnabled) {
    const bridgeMode = config.ombre.transport === 'lmc5_bridge';
    if (!String(bridgeMode ? config.ombre.bridgeUrl : config.ombre.url || '').trim()) {
      throw new Error(
        `${bridgeMode ? 'MEMORY_BRIDGE_URL' : 'OMBRE_MCP_URL'} is required when external memory integration is enabled`
      );
    }
    if (!String(bridgeMode ? config.ombre.bridgeToken : config.ombre.token || '').trim()) {
      throw new Error(
        `${bridgeMode ? 'MEMORY_BRIDGE_TOKEN' : 'OMBRE_MCP_TOKEN'} is required when external memory integration is enabled`
      );
    }
  }
  if (config.dashboard?.enabled) {
    const accessToken = String(config.dashboard.accessToken || '');
    if (accessToken.length < 32) {
      throw new Error('DASHBOARD_ACCESS_TOKEN must contain at least 32 characters when Dashboard is enabled');
    }
    if (accessToken === String(config.serviceToken || '')) {
      throw new Error('DASHBOARD_ACCESS_TOKEN must be different from SERVICE_TOKEN');
    }
    const publicBaseUrl = String(config.dashboard.publicBaseUrl || '');
    if (!publicBaseUrl) {
      throw new Error('DASHBOARD_PUBLIC_BASE_URL is required when Dashboard is enabled');
    }
    let parsed;
    try { parsed = new URL(publicBaseUrl); }
    catch { throw new Error('DASHBOARD_PUBLIC_BASE_URL must be a valid URL'); }
    const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
      throw new Error('DASHBOARD_PUBLIC_BASE_URL must use HTTPS outside localhost');
    }
  }
  if (config.bridge?.enabled) {
    const token = String(config.bridge.machineToken || '');
    if (token.length < 32) throw new Error('BRIDGE_MACHINE_TOKEN must contain at least 32 characters when Bridge is enabled');
    if ([config.serviceToken, config.dashboard?.accessToken].filter(Boolean).includes(token)) {
      throw new Error('BRIDGE_MACHINE_TOKEN must be independent from service and dashboard tokens');
    }
  }
  return config;
}
