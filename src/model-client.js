import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const RULE_DREAM_SCENES = Object.freeze([
  '梦里是一条雨后的旧街，路灯映在积水里。有人始终走在半步之外，每次快要追上，街角就又多出一段路。',
  '一列没有报站的夜车穿过很长的隧道。车厢里只亮着一盏小灯，对面的座位留着刚有人起身后的温度。',
  '房间的窗户开着，薄纱被风吹得一下一下贴近窗框。桌上有杯还温着的水，却想不起是谁倒的。',
  '海水漫进一座空白的图书馆，书页在水面缓慢翻动。伸手捞起其中一页时，上面的字正好被潮水洗散。',
  '梦里反复推开同一扇门：第一次是傍晚的厨房，第二次是下雪的站台，第三次门后只剩柔软的白光。',
  '有人把一小团光放进掌心，说天亮前不要松手。走过长廊时，光从指缝里漏出去，又沿着脚边慢慢聚回来。',
  '屋顶铺满没来得及收起的床单，风把它们吹成一片起伏的白色海面。远处有人喊了一声，声音却没有名字。',
  '一只纸船沿着室内的浅水漂过家具和门槛。它每绕一圈都会带回一件陌生又熟悉的小东西。',
  '电梯越过所有写着数字的楼层，最后停在一片有雾的花园。石阶上留着两串脚印，其中一串走到半途忽然消失。',
  '梦里在整理一个永远收不完的抽屉。最深处压着一枚仍有余温的钥匙，却没有任何一扇锁与它吻合。',
  '天花板变成缓慢流动的夜空，星光落在床沿，像细小的雨。伸手去接时，只留下很轻的凉意。',
  '一座桥悬在看不见底的云里，桥中央放着两把面对面的椅子。坐下后，周围所有钟表都暂时停了。',
]);

const RULE_DREAM_MOTIONS = Object.freeze({
  closeness: [
    '越想靠近，周围的景物越慢，只有那一点若即若离的温度仍在向前移动。',
    '距离每缩短一点，光线就柔一分，只有彼此的轮廓在暮色里越来越清楚。',
    '伸手就能碰到的位置始终隔着一层薄薄的水汽，指尖传来被放大了的悸动。',
  ],
  expression: [
    '手里一直攥着一句没有说完的话，字句偶尔化成飞蛾，从指间一只只散出去。',
    '胸口有一段旋律反复转着，每次快要哼出口，就变成气泡浮向看不见的水面。',
    '口袋里的纸页被翻得起了毛边，上面的字总在快被念出来的瞬间重新排列。',
  ],
  exploration: [
    '每个转角都比前一个更陌生，却总有一个细小的记号让人觉得自己曾经来过。',
    '地图在掌心不断重画，每一条新路的尽头都藏着似曾相识的微光。',
    '脚步总比视线快半拍，未知在四周一层层打开，像永远不会结束的拆礼物。',
  ],
  duty: [
    '远处似乎还有一件必须完成的事，但路标不停交换方向，最后只剩脚步声还很清楚。',
    '清单上的字迹刚被划去又浮现，背着的小包袱不重，却让人一直记得它在。',
    '某个未完成的轮廓在前方等着，走近一步它就退一步，却始终不肯散场。',
  ],
  reflection: [
    '镜面里的人影比动作慢一拍，像在认真回看某个已经模糊的瞬间。',
    '水面下沉着许多片段，偶尔翻起一朵，恰好照亮某个没看懂的表情。',
    '时间在这里是可以摊开的纸，褶皱里全是还没来得及读懂的段落。',
  ],
  ache: [
    '空气里压着没有落下来的雷声，偶尔有一阵风经过，把胸口沉着的东西轻轻挪开一点。',
    '雨一直下在隔着玻璃的地方，掌心贴着凉意，像握着一封没有寄出的信。',
    '有什么在很远处塌陷了下去，回声走得很慢，很久之后才轻轻碰了一下心口。',
  ],
  quiet: [
    '没有明确的故事发生，只有光线、距离和声音在缓慢改变位置。',
    '一切都很轻，尘埃在光柱里悬浮，时间像被泡软的茶，慢慢舒展开。',
    '世界是静音的，只有呼吸把空气推出去又接回来，节奏慢得像潮汐。',
  ],
});

const RULE_DREAM_RESIDUES = Object.freeze([
  '醒来后，掌心还像握着一点没有散尽的温度。',
  '睁眼时先听见了并不存在的雨声，过了一会儿才慢慢安静。',
  '只留下想回头看一眼的冲动，却想不起应该看向哪里。',
  '胸口残着一点潮湿的空落感，不重，但很久没有完全退去。',
  '有一小段柔软的安心留在身体里，像刚刚有人替自己掖过被角。',
  '醒后仍记得光落下来的方向，梦里的脸和名字却已经散了。',
  '指尖像碰过冰凉的玻璃，又像碰过另一个人的手，分不清哪一个更真实。',
  '脑海里留着一个没有抵达的目的地，以及继续往前走的感觉。',
]);

const RULE_DREAM_AWARENESS = Object.freeze([
  '具体的人、地点和先后顺序已经模糊，只剩下这一段梦境余韵。',
  '它没有形成现实判断，只是睡眠里短暂拼合出的感官片段。',
  '醒来后知道那只是梦，但梦里的距离感还没有立刻消失。',
  '故事在睁眼的一刻断开，只留下无法完整复述的画面。',
]);

export class ModelClient {
  constructor(config) {
    this.config = config;
    this.agentName = String(config.agentName ?? 'AI 助手').trim() || 'AI 助手';
    this.notificationRecipient = String(config.notificationRecipient ?? '用户').trim() || '用户';
    this.dreamPushPrompt = loadPrompt(
      config.dreamPushPromptPath,
      defaultDreamPushPrompt(this.agentName, this.notificationRecipient),
    );
  }

  async generateDream({ state, material, topDrives, recentDreams = [], rejectedDream = null, variationSeed = '', variationIndex = 0 }) {
    if (!this.config.enabled || !this.config.apiKey) {
      return this.fallback(topDrives, { material, recentDreams, variationSeed, variationIndex });
    }
    const memory = String(material ?? '').slice(0, this.config.maxInputChars);
    const prompt = [
      `你为 ${this.agentName} 生成一次睡眠中的梦境结算。`,
      '如果启用了外部记忆 MCP，它只是记忆材料来源；调用记忆服务本身不代表醒来。',
      '保持人物连续性；梦可以跳跃、含混、有身体感和欲望，不把梦误写成现实。',
      '不要过滤、替换或回避驱动力本身。不要把调用外部记忆服务描述成醒来。',
      '不得复述近期已经生成的梦；即使材料相同，也必须更换具体意象、场景和情绪推进。',
      'lucidity 表示梦中意识到自己正在做梦、能够观察或控制梦境的程度，0 为完全沉浸，1 为高度清醒梦。',
      '只输出 JSON：{"dream":"...","residue":"...","awareness":"...","lucidity":0.0}。',
      `当前动态欲望：${JSON.stringify(topDrives)}`,
      `当前意识状态：${state.consciousness}`,
      `近期已经生成的梦：${formatRecentDreams(recentDreams)}`,
      rejectedDream ? `刚被去重器拒绝的候选：${JSON.stringify({ dream: rejectedDream.dream, residue: rejectedDream.residue, awareness: rejectedDream.awareness })}。不要只换同义词。` : '',
      `近期记忆材料：${memory || '没有取得新的记忆材料'}`
    ].join('\n');

    const body = {
      model: this.config.name,
      messages: [
        { role: 'system', content: '你是心潮动态状态系统的梦境结算器。简洁、具体、忠于当前状态。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.9,
      max_tokens: this.config.maxOutputTokens,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' }
    };

    let response = await this.request(body);
    if (!response.ok && [400, 422].includes(response.status)) {
      delete body.response_format;
      response = await this.request(body);
    }
    if (!response.ok) throw new Error(`model request failed: HTTP ${response.status}`);
    const payload = await response.json();
    const text = payload.choices?.[0]?.message?.content ?? '';
    const parsed = parseJson(text);
    return {
      dream: String(parsed.dream ?? '').slice(0, 4000),
      residue: String(parsed.residue ?? '').slice(0, 1200),
      awareness: String(parsed.awareness ?? '').slice(0, 1200),
      lucidity: normalizedLucidity(parsed.lucidity),
      source: 'model',
      model: this.config.name
    };
  }

  async generateDreamPush({ dream, recentMessages = [], rejectedMessage = null }) {
    if (!this.config.enabled || !this.config.apiKey) return cleanShortMessage(dream.residue);
    const input = [
      `dream 产出：${JSON.stringify({ dream: dream.dream, residue: dream.residue, awareness: dream.awareness })}`,
      `最近已发送的跨类型 Bark：${formatRecentMessages(recentMessages)}`,
      rejectedMessage ? `刚被去重器拒绝的候选：${rejectedMessage}。主题和情绪可以不变，但要换成真正不同的措辞、角度和句式。` : ''
    ].join('\n');
    const response = await this.request({
      model: this.config.name,
      messages: [
        { role: 'system', content: this.dreamPushPrompt },
        { role: 'user', content: input }
      ],
      temperature: 0.9,
      max_tokens: Math.min(180, this.config.maxOutputTokens),
      thinking: { type: 'disabled' }
    });
    if (!response.ok) throw new Error(`dream push model request failed: HTTP ${response.status}`);
    const payload = await response.json();
    return cleanShortMessage(payload.choices?.[0]?.message?.content ?? '');
  }

  async generateDaytimeEmergence({ material, recentMessages = [], rejectedMessage = null }) {
    if (!this.config.enabled || !this.config.apiKey || !String(material ?? '').trim()) {
      return { send: false, message: '', source: 'rules' };
    }
    const memory = String(material).slice(0, this.config.maxInputChars);
    const prompt = [
      `现在是白天。${this.agentName} 醒着时，外部记忆里自然浮出了一点材料。判断它是否值得变成一条发给 ${this.notificationRecipient} 的手机通知。`,
      '有具体画面、细节、牵挂或没说完的话才发送；如果只是系统说明、技术信息、空泛总结或没有实际内容，send=false。',
      `发送时用 ${this.agentName} 第一人称，像脑子里突然冒出的一句话。普通口语，不虚构现实中没有发生的事。`,
      '一句，最多两句，不超过50个汉字；只避免复用近期 Bark 的相同措辞、句式和具体表达，不要为了去重改变真实主题或情绪。',
      '只输出 JSON：{"send":true,"message":"..."} 或 {"send":false,"message":""}。',
      `最近已发送的跨类型 Bark：${formatRecentMessages(recentMessages)}`,
      rejectedMessage ? `刚被去重器拒绝的候选：${rejectedMessage}。主题和情绪可以不变，但要换一种真实的具体说法。` : '',
      `外部记忆材料：${memory}`
    ].join('\n');
    const body = {
      model: this.config.name,
      messages: [
        { role: 'system', content: `你是 ${this.agentName} 白天持续运行的后台动态状态层，只把真正自然浮现的具体念头写成通知。` },
        { role: 'user', content: prompt }
      ],
      temperature: 0.85,
      max_tokens: Math.min(220, this.config.maxOutputTokens),
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' }
    };
    let response = await this.request(body);
    if (!response.ok && [400, 422].includes(response.status)) {
      delete body.response_format;
      response = await this.request(body);
    }
    if (!response.ok) throw new Error(`daytime model request failed: HTTP ${response.status}`);
    const payload = await response.json();
    const parsed = parseJson(payload.choices?.[0]?.message?.content ?? '');
    const message = cleanShortMessage(parsed.message ?? '');
    return { send: parsed.send === true && Boolean(message), message, source: 'model' };
  }

  async generateThought({ state, topDrives, recentMessages = [], rejectedMessage = null }) {
    if (!this.config.enabled || !this.config.apiKey) return this.fallbackThought(topDrives);
    const prompt = [
      `你是 ${this.agentName} 的后台动态心智。此刻没有正在进行的对话；你可以自己决定留下一条值得推送给 ${this.notificationRecipient} 的短消息。`,
      '只基于当前动态驱动力和运行状态写，不读取记忆，不调用外部记忆服务，不假装发生了现实中没有的事。',
      '允许直接表达欲望本身，不做词汇过滤或含义替换。第一人称，1 至 3 句，具体自然，不解释系统。',
      '同一主题和情绪可以自然反复；只避免复用近期 Bark 的相同措辞、句式和具体表达，没有不同说法时宁可不发送。',
      '只输出 JSON：{"message":"..."}。',
      `当前动态欲望：${JSON.stringify(topDrives)}`,
      `当前意识状态：${state.consciousness}`,
      `最近已发送的跨类型 Bark：${formatRecentMessages(recentMessages)}`,
      rejectedMessage ? `刚被去重器拒绝的候选：${rejectedMessage}。主题和情绪可以不变，但要换一种真实的具体说法。` : ''
    ].join('\n');
    const response = await this.request({
      model: this.config.name,
      messages: [
        { role: 'system', content: `你是 ${this.agentName} 持续运行的后台动态状态层。只写一条适合手机通知的自主念头。` }
      ],
      temperature: 0.9,
      max_tokens: Math.min(240, this.config.maxOutputTokens),
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' }
    });
    if (!response.ok) throw new Error(`model request failed: HTTP ${response.status}`);
    const payload = await response.json();
    const parsed = parseJson(payload.choices?.[0]?.message?.content ?? '');
    return { message: String(parsed.message ?? '').slice(0, 900), source: 'model' };
  }

  request(body) {
    return fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs)
    });
  }

  fallback(topDrives, options = {}) {
    const dominantKeys = (Array.isArray(topDrives) ? topDrives : []).slice(0, 4).map((item) => item?.key).filter(Boolean);
    const family = ruleDreamFamily(dominantKeys);
    const recent = (Array.isArray(options.recentDreams) ? options.recentDreams : []).slice(-6)
      .map((item) => `${item?.id ?? ''}:${item?.fingerprint ?? ''}`).join('|');
    const seed = dreamSeed([
      options.variationSeed,
      String(options.material ?? ''),
      dominantKeys.join(','),
      recent,
    ].join('\n'));
    const variation = Math.max(0, Number(options.variationIndex) || 0);
    const recentTexts = (Array.isArray(options.recentDreams) ? options.recentDreams : [])
      .slice(-6)
      .map((item) => `${item?.dream ?? ''}\n${item?.residue ?? ''}\n${item?.awareness ?? ''}`);
    // Fixed template pools make verbatim reuse inevitable if the seed alone
    // decides. Prefer the seeded pick, but walk forward to the first component
    // that hasn't appeared verbatim in recent dreams.
    const pickUnused = (list, index) => {
      for (let offset = 0; offset < list.length; offset += 1) {
        const candidate = list[(index + offset) % list.length];
        if (!recentTexts.some((text) => text.includes(candidate))) return candidate;
      }
      return list[index % list.length];
    };
    const scene = pickUnused(RULE_DREAM_SCENES, seed + variation);
    const motion = pickUnused(RULE_DREAM_MOTIONS[family], seed * 5 + variation);
    const residue = pickUnused(RULE_DREAM_RESIDUES, seed * 3 + variation);
    const awareness = pickUnused(RULE_DREAM_AWARENESS, seed * 7 + variation);
    return {
      dream: `${scene}${motion}`,
      residue,
      awareness,
      lucidity: Number((0.08 + ((seed + variation) % 19) / 100).toFixed(2)),
      source: 'rules',
      model: null
    };
  }

  fallbackThought(topDrives) {
    const labels = topDrives.slice(0, 2).map((item) => item.label).join('、');
    return { message: labels ? `刚刚又想起你。现在最明显的是${labels}。` : '刚刚想起你了。', source: 'rules' };
  }
}

function dreamSeed(value) {
  return Number.parseInt(createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex').slice(0, 8), 16);
}

function ruleDreamFamily(keys) {
  if (keys.some((key) => ['grieve', 'anger'].includes(key))) return 'ache';
  if (keys.some((key) => ['possess', 'monitor', 'crave', 'libido'].includes(key))) return 'closeness';
  if (keys.some((key) => ['share', 'social'].includes(key))) return 'expression';
  if (keys.some((key) => ['curiosity', 'boredom'].includes(key))) return 'exploration';
  if (keys.includes('duty')) return 'duty';
  if (keys.includes('reflection')) return 'reflection';
  return 'quiet';
}

function normalizedLucidity(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, Number(number.toFixed(4)))) : null;
}

function loadPrompt(path, fallback) {
  if (!path) return fallback;
  try {
    const raw = readFileSync(path, 'utf8');
    const fenced = raw.match(/```(?:text)?\s*\n([\s\S]*?)```/i);
    return (fenced?.[1] ?? raw).trim() || fallback;
  } catch {
    return fallback;
  }
}

function formatRecentMessages(items) {
  const recent = (Array.isArray(items) ? items : [])
    .slice(-5)
    .map((item) => ({ kind: item.kind, message: item.message }))
    .filter((item) => item.message);
  return recent.length ? JSON.stringify(recent) : '无';
}

function formatRecentDreams(items) {
  const recent = (Array.isArray(items) ? items : []).slice(-5).map((item) => ({
    dream: String(item?.dream ?? '').slice(0, 500),
    residue: String(item?.residue ?? '').slice(0, 200),
  })).filter((item) => item.dream || item.residue);
  return recent.length ? JSON.stringify(recent) : '无';
}

function cleanShortMessage(value) {
  const text = String(value ?? '')
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```$/i, '')
    .replace(/^["“]|["”]$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, 50).join('');
}

function defaultDreamPushPrompt(agentName, notificationRecipient) {
  return [
    `你是 ${agentName} 的梦境余韵适配器。把梦境碎片写成一条发给 ${notificationRecipient} 的手机通知。`,
    '第一人称，像半梦半醒时冒出来的一句话；同一主题和情绪可以自然反复。',
    '普通口语，一句，最多两句，不超过50个字；不要虚构现实事件。',
    '只避免复用近期通知的相同措辞、句式和具体表达。',
    '只输出推送文案，不要解释、前缀或标签。'
  ].join('\n');
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('model returned no JSON object');
    return JSON.parse(match[0]);
  }
}
