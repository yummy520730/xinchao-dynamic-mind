import { randomUUID } from 'node:crypto';
import { localDayAndHour, recordDream } from './engine.js';

export const NIGHT_DREAM_TTL_HOURS = 18;
export const NIGHT_DREAM_MIN_CHARS = 150;
export const NIGHT_DREAM_MAX_CHARS = 400;

const BANDS = Object.freeze(['low', 'medium', 'high']);

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function band(value) {
  const numeric = clamp01(value);
  if (numeric >= 0.66) return 'high';
  if (numeric >= 0.33) return 'medium';
  return 'low';
}

export function projectDreamState(state) {
  const drives = state?.drives ?? {};
  const attachment = Math.max(Number(drives.possess ?? 0), Number(drives.crave ?? 0));
  const warmth = Math.max(Number(drives.share ?? 0), Number(drives.social ?? 0));
  const tension = Math.max(Number(drives.anger ?? 0), Number(drives.grieve ?? 0));
  return {
    attachment: band(attachment),
    warmth: band(warmth),
    tension: band(tension),
    curiosity: band(drives.curiosity),
    fatigue: band(state?.fatigue),
    duty: band(drives.duty),
  };
}

export function nightDreamDue(state, now, options) {
  if (String(options?.mode ?? 'off') !== 'apply') return false;
  const { day, hour } = localDayAndHour(now, options.timeZone ?? 'Asia/Shanghai');
  if (hour < Number(options.hour ?? 4)) return false;
  return String(state?.lastNightDreamLocalDay ?? '') !== day;
}

export function recordNightDream(input, dream, now, timeZone = 'Asia/Shanghai') {
  const next = recordDream(input, dream);
  const { day } = localDayAndHour(now, timeZone);
  next.lastNightDreamLocalDay = day;
  return next;
}

export function recentNightDreamSourceDates(state, limit = 8) {
  return (Array.isArray(state?.recentDreams) ? state.recentDreams : [])
    .map((item) => String(item?.source_date ?? item?.sourceDate ?? '').slice(0, 10))
    .filter(Boolean)
    .slice(-Math.max(1, limit));
}

export function applyNightDreamResidue(input, dream, now = new Date()) {
  const state = structuredClone(input);
  const strength = clamp01(dream?.residue_strength ?? dream?.residueStrength ?? 0.3);
  const delta = Math.min(0.04, 0.02 + strength * 0.02);
  const before = Number(state.drives?.share ?? 0);
  const after = Number(Math.min(0.9, before + delta).toFixed(4));
  if (after !== before) {
    state.drives.share = after;
    state.revision = Number(state.revision ?? 0) + 1;
  }
  state.pendingDreamResidue = {
    text: String(dream?.residue_text ?? dream?.residue ?? '').slice(0, 240),
    strength,
    ttl_hours: NIGHT_DREAM_TTL_HOURS,
    expiresAt: new Date(now.getTime() + NIGHT_DREAM_TTL_HOURS * 3_600_000).toISOString(),
  };
  return state;
}

export function expireDreamResidue(input, now = new Date()) {
  const state = structuredClone(input);
  const expiresAt = Date.parse(state.pendingDreamResidue?.expiresAt ?? '');
  if (!state.pendingDreamResidue) return state;
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    state.pendingDreamResidue = null;
    state.revision = Number(state.revision ?? 0) + 1;
  }
  return state;
}

export function nightDreamWriterPrompt({ episode, stateProjection, agentName = '心潮' }) {
  const messages = (Array.isArray(episode?.messages) ? episode.messages : [])
    .map((item) => `${item.role}: ${String(item.content ?? '').trim()}`)
    .join('\n');
  return [
    `你为 ${agentName} 写一篇夜梦。这是梦，不是事实总结，不是日记，不是记忆提取。`,
    '可以重组、跳跃、象征化、轻微虚构。不得声称梦里新增内容在现实发生过。',
    '不负责提取长期事实。不创建 canonical memory。不输出分析说明。',
    `写成一篇短梦，大约 ${NIGHT_DREAM_MIN_CHARS} 到 ${NIGHT_DREAM_MAX_CHARS} 个中文字。`,
    '只输出 JSON：{"dream":"...","residue":"...","residue_strength":0.0}',
    'residue 是醒来后仍短暂留着的感觉，一句话；residue_strength 是 0 到 1 的小数。',
    `心潮当前状态投影（band，不是内部数值）：${JSON.stringify(stateProjection ?? {})}`,
    `真实历史 episode（连续原文，不是检索结果）：source_date=${episode?.source_date ?? ''} event_ids=${JSON.stringify(episode?.event_ids ?? [])}`,
    messages || '（没有取得历史 episode）',
  ].join('\n');
}

export function clipNightDreamText(value, maxChars = NIGHT_DREAM_MAX_CHARS) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

export function validateNightDreamOutput(parsed, maxOutputChars = NIGHT_DREAM_MAX_CHARS) {
  const dream = clipNightDreamText(parsed?.dream, maxOutputChars);
  if (dream.length < 24) return null;
  const residue = clipNightDreamText(parsed?.residue, 120);
  const strength = clamp01(parsed?.residue_strength ?? parsed?.residueStrength ?? 0.35);
  if (!BANDS.length) return null;
  return {
    dream,
    residue,
    residue_strength: Number(strength.toFixed(2)),
  };
}

export async function runNightDream({ state, now, config, ombre, model, log = () => {} }) {
  const options = {
    mode: config.dreamNight?.mode ?? 'off',
    hour: config.dreamNight?.hour ?? 4,
    timeZone: config.settle?.timeZone ?? 'Asia/Shanghai',
  };
  if (!nightDreamDue(state, now, options)) return { status: 'not_due' };

  const stateProjection = projectDreamState(state);
  let episode;
  try {
    episode = await ombre.fetchHistoricalEpisode({
      stateProjection,
      recentSourceDates: recentNightDreamSourceDates(state),
      minChars: 2000,
      maxChars: config.dreamNight?.maxSourceChars ?? 6000,
    });
  } catch (error) {
    log('night_dream_episode_failed', { message: error.message });
    return { status: 'skipped', reason: 'episode_unavailable' };
  }
  if (episode?.status !== 'ok' || !Array.isArray(episode.event_ids) || episode.event_ids.length < 2) {
    log('night_dream_episode_empty', { status: episode?.status ?? 'missing' });
    return { status: 'skipped', reason: 'empty_episode' };
  }

  let generated;
  try {
    generated = await model.generateNightDream({
      episode,
      stateProjection,
      maxOutputChars: config.dreamNight?.maxOutputChars ?? 400,
    });
  } catch (error) {
    log('night_dream_model_failed', { message: error.message, code: error.code });
    return { status: 'skipped', reason: 'model_failed' };
  }
  if (!generated?.dream || generated.source === 'rules' || generated.source === 'fallback') {
    log('night_dream_template_rejected', { source: generated?.source ?? 'missing' });
    return { status: 'skipped', reason: 'model_failed' };
  }

  const createdAt = now.toISOString();
  const dream = {
    id: randomUUID(),
    createdAt,
    dreamed_at: createdAt,
    kind: 'night',
    source_date: episode.source_date,
    source_start_at: episode.start_at,
    source_end_at: episode.end_at,
    source_event_ids: [...episode.event_ids],
    dream: generated.dream,
    dream_text: generated.dream,
    residue: generated.residue,
    residue_text: generated.residue,
    residue_strength: generated.residue_strength,
    state_projection: stateProjection,
    source: generated.source,
    model: generated.model ?? null,
  };
  return { status: 'ok', dream, episode, stateProjection };
}

