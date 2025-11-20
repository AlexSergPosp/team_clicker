// worker.js

const PK = 'global_state';

// Список достижений
const ACHIEVEMENTS = [
  { id: 'b_10',   threshold: 10 },
  { id: 'b_50',   threshold: 50 },
  { id: 'b_100',  threshold: 100 },
  { id: 'b_250',  threshold: 250 },
  { id: 'b_500',  threshold: 500 },
  { id: 'b_1k',   threshold: 1000 },
  { id: 'b_2k5',  threshold: 2500 },
  { id: 'b_5k',   threshold: 5000 },
  { id: 'b_10k',  threshold: 10000 },
  { id: 'b_25k',  threshold: 25000 },
  { id: 'b_50k',  threshold: 50000 },
  { id: 'b_100k', threshold: 100000 },
  { id: 'b_250k', threshold: 250000 },
  { id: 'b_500k', threshold: 500000 },
  { id: 'b_1m',   threshold: 1000000 },
  { id: 'b_2m5',  threshold: 2500000 },
  { id: 'b_5m',   threshold: 5000000 },
  { id: 'b_10m',  threshold: 10000000 },
  { id: 'b_50m',  threshold: 50000000 },
  { id: 'b_100m', threshold: 100000000 }
];

function defaultState() {
  return {
    balance: 0,
    tier: 1,
    globalLevel: 0,
    n: 5,
    lastUpdate: Date.now(),
    generators: [
      { index: 1, incomeBase: 1,  level: 0, purchased: true,  buyCost: 0 },
      { index: 2, incomeBase: 1,  level: 0, purchased: false, buyCost: 200 },
      { index: 3, incomeBase: 1,  level: 0, purchased: false, buyCost: 300 },
      { index: 4, incomeBase: 1,  level: 0, purchased: false, buyCost: 400 },
      { index: 5, incomeBase: 1,  level: 0, purchased: false, buyCost: 500 }
    ],
    unlockedAchievements: []
  };
}

function getEffectiveIncome(gen) {
  return gen.incomeBase * gen.index;
}

function getTotalIncomePerSecond(state) {
  return (state.generators || []).reduce(
    (sum, g) => g.purchased ? sum + getEffectiveIncome(g) : sum,
    0
  );
}

// Пассивный доход по времени
function applyPassiveIncome(state) {
  const now = Date.now();
  const last = state.lastUpdate || now;
  const deltaMs = now - last;
  const deltaSec = Math.max(0, Math.floor(deltaMs / 1000));
  if (deltaSec > 0) {
    const income = getTotalIncomePerSecond(state);
    state.balance += income * deltaSec;
  }
  state.lastUpdate = now;
}

// Пересчитать стоимости апгрейда
function recalcCosts(state) {
  (state.generators || []).forEach(gen => {
    const income = getEffectiveIncome(gen);
    gen.upgradeCost = Math.round(income * state.n);
  });
}

// Применить достижения
function applyAchievements(state) {
  const set = new Set(state.unlockedAchievements || []);
  for (const a of ACHIEVEMENTS) {
    if (state.balance >= a.threshold && !set.has(a.id)) {
      set.add(a.id);
    }
  }
  state.unlockedAchievements = Array.from(set);
}

// Загрузка стейта из KV
async function loadState(env) {
  const raw = await env.CLICKER_STATE.get(PK);
  let state;
  if (!raw) {
    state = defaultState();
  } else {
    try {
      state = JSON.parse(raw);
    } catch {
      state = defaultState();
    }
  }

  applyPassiveIncome(state);
  applyAchievements(state);
  recalcCosts(state);

  await env.CLICKER_STATE.put(PK, JSON.stringify(state));
  return state;
}

// Сохранение стейта в KV
async function saveState(env, state) {
  applyAchievements(state);
  recalcCosts(state);
  await env.CLICKER_STATE.put(PK, JSON.stringify(state));
  return state;
}

// Логика тап
function tap(state) {
  const income = getTotalIncomePerSecond(state);
  state.balance += income;
}

// Покупка генератора
function buyGenerator(state, genIndex) {
  const gen = (state.generators || []).find(g => g.index === genIndex);
  if (!gen || gen.purchased) {
    throw new Error('Generator not available or already purchased');
  }
  const cost = gen.buyCost ?? 0;
  if (state.balance < cost) {
    throw new Error('Not enough balance');
  }
  state.balance -= cost;
  gen.purchased = true;
}

// Апгрейд генератора
function upgradeGenerator(state, genIndex) {
  const gen = (state.generators || []).find(g => g.index === genIndex);
  if (!gen || !gen.purchased) {
    throw new Error('Generator not available');
  }
  const cost = Math.round(getEffectiveIncome(gen) * state.n);
  if (state.balance < cost) {
    throw new Error('Not enough balance');
  }

  state.balance -= cost;
  gen.level += 1;
  gen.incomeBase = +(gen.incomeBase * 1.15).toFixed(4);

  state.globalLevel += 1;
  if (state.globalLevel >= 20) {
    state.tier += 1;
    state.globalLevel = 0;
  }
  state.n = 5 + state.globalLevel;
}

function jsonResponse(bodyObj, status = 200) {
  return new Response(JSON.stringify(bodyObj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      // CORS preflight
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    try {
      if (pathname === '/state' && request.method === 'GET') {
        const state = await loadState(env);
        return jsonResponse(state);
      }

      if (pathname === '/tap' && request.method === 'POST') {
        let state = await loadState(env);
        tap(state);
        state = await saveState(env, state);
        return jsonResponse(state);
      }

      if (pathname === '/buy' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const index = body.index;
        if (!index) {
          return jsonResponse({ error: 'No generator index' }, 400);
        }

        let state = await loadState(env);
        buyGenerator(state, index);
        state = await saveState(env, state);
        return jsonResponse(state);
      }

      if (pathname === '/upgrade' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const index = body.index;
        if (!index) {
          return jsonResponse({ error: 'No generator index' }, 400);
        }

        let state = await loadState(env);
        upgradeGenerator(state, index);
        state = await saveState(env, state);
        return jsonResponse(state);
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (e) {
      console.error(e);
      const msg = e && e.message ? e.message : 'Internal error';
      const status = msg.startsWith('Not enough') || msg.startsWith('Generator')
        ? 400
        : 500;
      return jsonResponse({ error: msg }, status);
    }
  }
};
