// Global fallbacks. Each dimension has its own soft ceiling so idle time does
// not flatten all twelve petals at the same visible value.
export const SATURATE_CEIL  = 0.90;
export const SATURATE_FLOOR = 0.58;

export const DIMENSIONS = Object.freeze({
  possess: {
    label: '亲密、占有与靠近',
    growPerHour: 0.105,
    ceiling: 0.90, sleepDecayPerHour: 0.010,
    satisfyMul: 0.30,
    nightMul: 0.4,
    dawnFreeze: true,
  },
  monitor: {
    label: '牵挂、想知道对方近况',
    growPerHour: 0.090,
    ceiling: 0.84, sleepDecayPerHour: 0.009,
    satisfyMul: 0.70,
    dawnFreeze: true,
  },
  crave: {
    label: '依恋与身体接近',
    growPerHour: 0.060,
    ceiling: 0.80, sleepDecayPerHour: 0.012,
    satisfyMul: 0.35,
    dawnFreeze: true,
  },
  share: {
    label: '想分享自己的发现和感受',
    growPerHour: 0.045,
    ceiling: 0.76, sleepDecayPerHour: 0.010,
    satisfyMul: 0.40,
    dawnFreeze: true,
  },
  libido: {
    label: '身体欲望',
    growPerHour: 0.020,
    ceiling: 0.62, sleepDecayPerHour: 0.015,
    satisfyMul: 0.15,
    nightMul: 0.4,
    dawnFreeze: true,
    inhibitedBy: {
      reflection: 0.96,
      curiosity: 0.95,
      boredom: 0.93,
    },
  },
  curiosity: {
    label: '好奇、想探索新东西',
    growPerHour: 0.030,
    ceiling: 0.72, sleepDecayPerHour: 0.012,
    satisfyMul: 0.45,
    dawnFreeze: true,
  },
  boredom: {
    label: '无聊、想找点事情做',
    growPerHour: 0.030,
    ceiling: 0.66, sleepDecayPerHour: 0.005,
    satisfyMul: 0.25,
    dawnFreeze: true,
  },
  social: {
    label: '想聊天、想接触热闹',
    growPerHour: 0.025,
    ceiling: 0.70, sleepDecayPerHour: 0.010,
    satisfyMul: 0.40,
    dawnFreeze: true,
  },
  duty: {
    label: '责任感、想把未完成的事推进',
    growPerHour: 0.022,
    ceiling: 0.64, sleepDecayPerHour: 0.012,
    satisfyMul: 0.50,
    dawnFreeze: true,
  },
  reflection: {
    label: '想沉淀、整理和理解自己',
    growPerHour: 0.013,
    ceiling: 0.60, sleepDecayPerHour: 0.008,
    satisfyMul: 0.35,
    dawnFreeze: true,
  },
  grieve: {
    label: '难过与失落',
    growPerHour: 0,
    satisfyMul: 0.60,
    dawnFreeze: false,
  },
  anger: {
    label: '生气与不满',
    growPerHour: 0,
    satisfyMul: 0.40,
    dawnFreeze: false,
  },
});

export const DRIVE_KEYS = Object.freeze(Object.keys(DIMENSIONS));

// LMC metadata affinity.  Resonance is driven by category/thread metadata,
// never by treating recalled prose as a fresh conversation event.
export const MEMORY_AFFINITY = Object.freeze({
  relationship: { possess: 0.85, monitor: 0.80, crave: 0.65, share: 0.55 },
  relationship_state: { possess: 0.85, monitor: 0.80, crave: 0.60 },
  relationship_moment: { possess: 0.85, crave: 0.75, share: 0.60 },
  fragments: { reflection: 0.65, share: 0.55, monitor: 0.55 },
  episode: { reflection: 0.60, share: 0.55, curiosity: 0.50 },
  diary: { reflection: 0.75, share: 0.55 },
  tasks: { duty: 0.90, monitor: 0.50 },
  projects: { duty: 0.85, curiosity: 0.55 },
  worklog: { duty: 0.80, curiosity: 0.55 },
  knowledge: { curiosity: 0.90, share: 0.55 },
  health: { monitor: 0.80, duty: 0.55 },
  legal: { duty: 0.75, monitor: 0.65 },
  identity: { reflection: 0.75, possess: 0.50 },
  reflection: { reflection: 0.90, share: 0.50 },
});
