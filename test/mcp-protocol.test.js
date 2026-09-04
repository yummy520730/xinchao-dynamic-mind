import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMcpMessage } from '../src/mcp-protocol.js';

function handlers() {
  return {
    defaultSessionId: 'transport-session-1',
    context: async (args) => ({
      version: 1,
      delivered: true,
      additionalContext: `[心潮动态状态]\nsession=${args.sessionId}`,
      sessionId: args.sessionId,
      mode: args.mode,
      maxTokens: args.maxTokens,
      estimatedTokens: 20,
      sections: [],
      digest: 'abc',
    }),
    event: async (event) => ({
      revision: 8,
      consciousness: 'awake',
      sessionId: event.sessionId,
      sessionCreated: true,
      received: event,
    }),
    stateSignal: async (event) => ({
      revision: 8,
      duplicate: false,
      signal: { type: event.signalType, origin: event.origin, applied: true, reasonCode: 'applied' },
      received: event,
    }),
    handoffNote: async (note) => ({
      revision: 9,
      duplicate: false,
      received: note,
    }),
    fromMe: async (entry) => ({ id: 'from-me-1', duplicate: false, received: entry }),
    presence: async (event) => ({
      revision: 9,
      consciousness: 'awake',
      fatigue: 0.12,
      top_drives: [
        { key: 'share', value: 0.74 },
        { key: 'curiosity', value: 0.69 },
        { key: 'crave', value: 0.66 },
      ],
      duplicate: false,
      received: event,
    }),
  };
}

test('MCP initialize advertises the 2.4.0 tool server', async () => {
  const result = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18' },
  }, handlers());
  assert.equal(result.status, 200);
  assert.equal(result.body.result.protocolVersion, '2025-06-18');
  assert.equal(result.body.result.serverInfo.name, 'xinchao-dynamic-mind');
  assert.equal(result.body.result.serverInfo.version, '2.5.15-lmc.1');
  assert.equal(result.body.result.capabilities.tools.listChanged, false);
});

test('tools/list exposes context, presence, event and short handoff note tools', async () => {
  const result = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  }, handlers());
  const tools = Object.fromEntries(result.body.result.tools.map((tool) => [tool.name, tool]));
  assert.deepEqual(
    result.body.result.tools.map((tool) => tool.name),
    ['xinchao_context', 'mind_presence', 'xinchao_state_signal', 'xinchao_event', 'xinchao_handoff_note', 'xinchao_from_me'],
  );
  assert.equal(tools.xinchao_context.annotations.readOnlyHint, true);
  assert.deepEqual(tools.xinchao_context.inputSchema.required, undefined);
  assert.equal(tools.xinchao_context.inputSchema.properties.max_tokens.default, 2200);
  assert.equal(tools.mind_presence.annotations.idempotentHint, true);
  assert.deepEqual(tools.mind_presence.inputSchema.required, ['event_id']);
  assert.equal('interaction_type' in tools.mind_presence.inputSchema.properties, false);
  assert.equal(tools.xinchao_state_signal.annotations.destructiveHint, false);
  assert.equal(tools.xinchao_state_signal.annotations.idempotentHint, true);
  assert.deepEqual(tools.xinchao_state_signal.inputSchema.required, ['event_id', 'signal_type', 'origin']);
  assert.deepEqual(tools.xinchao_state_signal.inputSchema.properties.signal_type.enum, ['intimacy_cue']);
  assert.deepEqual(tools.xinchao_state_signal.inputSchema.properties.origin.enum, ['user']);
  assert.ok(tools.xinchao_event.inputSchema.required.includes('event_id'));
  assert.ok(tools.xinchao_event.inputSchema.required.includes('interaction_type'));
  assert.equal(tools.xinchao_event.inputSchema.required.includes('session_id'), false);
  assert.ok(tools.xinchao_event.inputSchema.properties.interaction_type.enum.includes('sharing'));
  assert.equal(tools.xinchao_handoff_note.annotations.idempotentHint, true);
  assert.deepEqual(
    tools.xinchao_handoff_note.inputSchema.required,
    ['event_id', 'note'],
  );
});

test('xinchao_state_signal accepts semantic input only and drops drive deltas', async () => {
  const result = await handleMcpMessage({
    jsonrpc: '2.0', id: 31, method: 'tools/call',
    params: {
      name: 'xinchao_state_signal',
      arguments: {
        event_id: 'dsm-cue-31', signal_type: 'intimacy_cue', origin: 'user',
        driveDeltas: { libido: 1 },
      },
    },
  }, handlers());
  const received = result.body.result.structuredContent.received;
  assert.deepEqual(received, { eventId: 'dsm-cue-31', signalType: 'intimacy_cue', origin: 'user' });
});

test('xinchao_context returns injectable text and structured envelope', async () => {
  const result = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'xinchao_context',
      arguments: {
        session_id: 'claude-mac-1',
        mode: 'session_start',
        max_tokens: 500,
      },
    },
  }, handlers());
  assert.equal(result.body.result.isError, false);
  assert.match(result.body.result.content[0].text, /claude-mac-1/);
  assert.equal(result.body.result.structuredContent.sessionId, 'claude-mac-1');
});

test('xinchao_event drops chat plaintext and keeps only allowed short-state fields', async () => {
  const result = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'xinchao_event',
      arguments: {
        session_id: 'codex-mac-1',
        event_id: 'event-1',
        interaction_type: 'sharing',
        tone: 'focused',
        attention: 0.9,
        message: '这段聊天正文绝不能进入状态',
        driveDeltas: { curiosity: 1 },
      },
    },
  }, handlers());
  const received = result.body.result.structuredContent.received;
  assert.equal(received.sessionId, 'codex-mac-1');
  assert.equal(received.sessionState.tone, 'focused');
  assert.equal(received.sessionState.attention, 0.9);
  assert.equal(received.interactionType, 'sharing');
  assert.equal('message' in received, false);
  assert.equal('driveDeltas' in received, false);
  assert.doesNotMatch(JSON.stringify(received), /聊天正文/);
});

test('xinchao_event requires an opaque event id for idempotent settlement', async () => {
  const result = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: {
      name: 'xinchao_event',
      arguments: {
        session_id: 'claude-window',
        interaction_type: 'companionship',
      },
    },
  }, handlers());
  assert.equal(result.body.result.isError, true);
  assert.match(result.body.result.content[0].text, /event_id/);
});

test('xinchao_handoff_note keeps only the bounded summary contract', async () => {
  const result = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: {
      name: 'xinchao_handoff_note',
      arguments: {
        session_id: 'claude-old-window',
        event_id: 'handoff-7',
        note: '已经完成召回门控，下一步检查备份。',
        ttl_hours: 48,
        transcript: '不允许的整段聊天原文',
      },
    },
  }, handlers());
  const received = result.body.result.structuredContent.received;
  assert.equal(received.note, '已经完成召回门控，下一步检查备份。');
  assert.equal(received.ttlHours, 48);
  assert.equal('transcript' in received, false);
});

test('xinchao_context falls back to the stable transport session and 2200 token default', async () => {
  const result = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'xinchao_context', arguments: {} },
  }, handlers());
  assert.equal(result.status, 200);
  assert.equal(result.body.result.isError, false);
  assert.equal(result.body.result.structuredContent.sessionId, 'transport-session-1');
  assert.equal(result.body.result.structuredContent.maxTokens, 2200);
  assert.match(result.body.result.content[0].text, /transport-session-1/);
});

test('initialized notification uses an empty 202 response', async () => {
  const result = await handleMcpMessage({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  }, handlers());
  assert.equal(result.status, 202);
  assert.equal(result.body, null);
});

test('xinchao_from_me is an AI-owned bounded outbox tool', async () => {
  const result = await handleMcpMessage({
    jsonrpc:'2.0', id:20, method:'tools/call',
    params:{ name:'xinchao_from_me', arguments:{ event_id:'ai-note-0001', kind:'pending_from_me', message:'等你回来。', ttl_hours:48 } },
  }, handlers());
  assert.equal(result.body.result.isError, false);
  assert.equal(result.body.result.structuredContent.received.message, '等你回来。');
});

test('xinchao_from_me action results require a valid drive for satisfaction', async () => {
  const missing = await handleMcpMessage({
    jsonrpc:'2.0', id:21, method:'tools/call',
    params:{ name:'xinchao_from_me', arguments:{ event_id:'action-result-0001', kind:'action_result', message:'已经分享。' } },
  }, handlers());
  assert.equal(missing.body.result.isError, true);
  assert.match(missing.body.result.content[0].text, /drive_key/);

  const accepted = await handleMcpMessage({
    jsonrpc:'2.0', id:22, method:'tools/call',
    params:{ name:'xinchao_from_me', arguments:{ event_id:'action-result-0001', kind:'action_result', drive_key:'share', message:'已经分享。' } },
  }, handlers());
  assert.equal(accepted.body.result.isError, false);
  assert.equal(accepted.body.result.structuredContent.received.driveKey, 'share');
});

test('mind_presence requires event_id, drops user text and does not take interaction_type', async () => {
  const missing = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 40,
    method: 'tools/call',
    params: { name: 'mind_presence', arguments: { session_id: 'claude-window' } },
  }, handlers());
  assert.equal(missing.body.result.isError, true);
  assert.match(missing.body.result.content[0].text, /event_id/);

  const result = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 41,
    method: 'tools/call',
    params: {
      name: 'mind_presence',
      arguments: {
        session_id: 'claude-window',
        event_id: 'presence-turn-1',
        interaction_type: 'sharing',
        prompt: '这段用户原文绝不能进入心潮',
        message: '也不允许聊天正文',
        driveDeltas: { share: 1 },
      },
    },
  }, handlers());
  assert.equal(result.body.result.isError, false);
  const projection = result.body.result.structuredContent;
  assert.equal(projection.revision, 9);
  assert.equal(projection.consciousness, 'awake');
  assert.equal(projection.fatigue, 0.12);
  assert.equal(projection.duplicate, false);
  assert.equal(projection.top_drives[0].key, 'share');
  const received = projection.received;
  assert.deepEqual(received, { sessionId: 'claude-window', eventId: 'presence-turn-1' });
  assert.equal('interactionType' in received, false);
  assert.equal('prompt' in received, false);
  assert.equal('message' in received, false);
  assert.doesNotMatch(JSON.stringify(received), /用户原文/);
});

test('mind_presence falls back to the stable transport session', async () => {
  const result = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 42,
    method: 'tools/call',
    params: { name: 'mind_presence', arguments: { event_id: 'presence-turn-2' } },
  }, handlers());
  assert.equal(result.body.result.isError, false);
  assert.equal(result.body.result.structuredContent.received.sessionId, 'transport-session-1');
  assert.equal(result.body.result.structuredContent.received.eventId, 'presence-turn-2');
});

test('xinchao_event still requires interaction_type after mind_presence', async () => {
  const result = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 43,
    method: 'tools/call',
    params: {
      name: 'xinchao_event',
      arguments: { session_id: 'claude-window', event_id: 'completed-1' },
    },
  }, handlers());
  assert.equal(result.body.result.isError, true);
  assert.match(result.body.result.content[0].text, /interaction_type/);
});
