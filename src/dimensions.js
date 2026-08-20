// Global fallback. Each dimension keeps its own event-response ceiling.
export const SATURATE_CEIL  = 0.90;

export const DIMENSIONS = Object.freeze({
  possess: {
    label: '亲密、占有与靠近',
    ceiling: 0.90,
    satisfyMul: 0.30,
  },
  monitor: {
    label: '牵挂、想知道对方近况',
    ceiling: 0.84,
    satisfyMul: 0.70,
  },
  crave: {
    label: '依恋与身体接近',
    ceiling: 0.80,
    satisfyMul: 0.35,
  },
  share: {
    label: '想分享自己的发现和感受',
    ceiling: 0.76,
    satisfyMul: 0.40,
  },
  libido: {
    label: '身体欲望',
    ceiling: 0.62,
    satisfyMul: 0.15,
    inhibitedBy: {
      reflection: 0.96,
      curiosity: 0.95,
      boredom: 0.93,
    },
  },
  curiosity: {
    label: '好奇、想探索新东西',
    ceiling: 0.72,
    satisfyMul: 0.45,
  },
  boredom: {
    label: '无聊、想找点事情做',
    ceiling: 0.66,
    satisfyMul: 0.25,
  },
  social: {
    label: '想聊天、想接触热闹',
    ceiling: 0.70,
    satisfyMul: 0.40,
  },
  duty: {
    label: '责任感、想把未完成的事推进',
    ceiling: 0.64,
    satisfyMul: 0.50,
  },
  reflection: {
    label: '想沉淀、整理和理解自己',
    ceiling: 0.60,
    satisfyMul: 0.35,
  },
  grieve: {
    label: '难过与失落',
    satisfyMul: 0.60,
  },
  anger: {
    label: '生气与不满',
    satisfyMul: 0.40,
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
