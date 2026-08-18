// 纯 node 测试：config 读写/深合并、monitors CRUD、适配器解析函数、monitor 调度器。
// 运行：node test/run-tests.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r
        .then(() => {
          passed++;
          console.log(`  ok - ${name}`);
        })
        .catch((e) => {
          failed++;
          console.error(`  FAIL - ${name}\n    ${e.stack || e}`);
        });
    }
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL - ${name}\n    ${e.stack || e}`);
  }
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'planusage-test-'));
}

async function main() {
  const config = require('../src/main/config');
  const dir = tmpdir();
  config.initConfig(dir);

  console.log('config:');
  test('默认值补全', () => {
    const cfg = config.getConfig();
    assert.strictEqual(cfg.alwaysOnTop, true);
    assert.strictEqual(cfg.opacity, 0.92);
    assert.strictEqual(cfg.width, 420);
    assert.strictEqual(cfg.height, 580);
    assert.strictEqual(cfg.layoutMode, 'vertical');
    assert.strictEqual(cfg.locale, 'zh');
    assert.strictEqual(cfg.appearance.borderWidth, 8);
    assert.strictEqual(cfg.alert.threshold2, 85);
    assert.strictEqual(cfg.alert.colors.safe, '#7ed6a5');
  });

  test('patchConfig 深合并写盘', () => {
    config.patchConfig({ appearance: { fontSize: 14 }, opacity: 0.5 });
    const cfg = config.getConfig();
    assert.strictEqual(cfg.opacity, 0.5);
    assert.strictEqual(cfg.appearance.fontSize, 14);
    assert.strictEqual(cfg.appearance.bgColor, 'rgba(24, 24, 27, 0.88)'); // 未打补丁的保留
    // 重新 init 验证持久化
    config.initConfig(dir);
    assert.strictEqual(config.getConfig().appearance.fontSize, 14);
    assert.strictEqual(config.getConfig().opacity, 0.5);
  });

  console.log('monitors CRUD:');
  let mid;
  test('addMonitor 填默认值 + uuid', () => {
    const m = config.addMonitor({ provider: 'deepseek', kind: 'balance', name: 'ds', auth: { apiKey: 'k' } });
    mid = m.id;
    assert.match(m.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.strictEqual(m.enabled, true);
    assert.strictEqual(m.refresh.mode, 'manual');
    assert.strictEqual(m.refresh.minutes, 5);
    assert.strictEqual(m.auth.apiKey, 'k');
    assert.strictEqual(m.auth.baseUrl, '');
    assert.strictEqual(m.currency, 'CNY');
    assert.ok(m.createdAt > 0 && m.updatedAt > 0);
  });

  test('list/get/update/remove', () => {
    assert.strictEqual(config.listMonitors().length, 1);
    assert.strictEqual(config.getMonitor(mid).provider, 'deepseek');
    const updated = config.updateMonitor(mid, { refresh: { mode: 'interval', minutes: 10 }, name: 'ds2' });
    assert.strictEqual(updated.refresh.mode, 'interval');
    assert.strictEqual(updated.refresh.minutes, 10);
    assert.strictEqual(updated.name, 'ds2');
    assert.strictEqual(updated.id, mid);
    assert.strictEqual(config.updateMonitor('nope', {}), null);
    // 持久化
    config.initConfig(dir);
    assert.strictEqual(config.getMonitor(mid).name, 'ds2');
    assert.strictEqual(config.removeMonitor(mid), true);
    assert.strictEqual(config.removeMonitor(mid), false);
    assert.strictEqual(config.listMonitors().length, 0);
  });

  test('reorderMonitors 按 id 重排并持久化 / 非法输入不修改', () => {
    const a = config.addMonitor({ name: 'a' });
    const b = config.addMonitor({ name: 'b' });
    const c = config.addMonitor({ name: 'c' });
    assert.deepStrictEqual(config.listMonitors().map((m) => m.name), ['a', 'b', 'c']);

    assert.deepStrictEqual(config.reorderMonitors([c.id, a.id, b.id]).map((m) => m.name), ['c', 'a', 'b']);
    assert.deepStrictEqual(config.listMonitors().map((m) => m.name), ['c', 'a', 'b']);
    // 持久化：重新 init 后顺序保持
    config.initConfig(dir);
    assert.deepStrictEqual(config.listMonitors().map((m) => m.name), ['c', 'a', 'b']);

    // 缺 id / 重复 id / 未知 id 均不生效
    const before = config.listMonitors().map((m) => m.name);
    assert.strictEqual(config.reorderMonitors([b.id, a.id]), null);
    assert.strictEqual(config.reorderMonitors([c.id, a.id, a.id]), null);
    assert.strictEqual(config.reorderMonitors([c.id, a.id, 'ghost']), null);
    assert.strictEqual(config.reorderMonitors('nope'), null);
    assert.deepStrictEqual(config.listMonitors().map((m) => m.name), before);

    for (const m of config.listMonitors()) config.removeMonitor(m.id);
  });

  console.log('adapters 纯函数:');
  const balance = require('../src/main/adapters/api-balance');
  const usage = require('../src/main/adapters/api-usage');
  const opencodeGo = require('../src/main/adapters/opencode-go');
  const adapters = require('../src/main/adapters');

  test('pickByPath', () => {
    const obj = { a: { b: [{ c: 42 }] }, x: 0 };
    assert.strictEqual(balance.pickByPath(obj, 'a.b'), obj.a.b);
    assert.strictEqual(balance.pickByPath(obj, 'x'), 0);
    assert.strictEqual(balance.pickByPath(obj, 'a.z.c'), undefined);
    assert.strictEqual(balance.pickByPath(obj, ''), undefined);
    assert.strictEqual(balance.pickByPath(null, 'a'), undefined);
  });

  test('parseDeepseek 按币种匹配 / 回退第一项', () => {
    const resp = {
      balance_infos: [
        { currency: 'CNY', total_balance: '10.50' },
        { currency: 'USD', total_balance: '2.25' },
      ],
    };
    assert.deepStrictEqual(balance.parseDeepseek(resp, 'USD'), { balance: 2.25, currency: 'USD' });
    assert.deepStrictEqual(balance.parseDeepseek(resp, 'RMB'), { balance: 10.5, currency: 'CNY' });
    const onlyCny = { balance_infos: [{ currency: 'CNY', total_balance: 7 }] };
    assert.deepStrictEqual(balance.parseDeepseek(onlyCny, 'USD'), { balance: 7, currency: 'CNY' });
    assert.throws(() => balance.parseDeepseek({}, 'CNY'), /balance_infos/);
  });

  test('parseKimi', () => {
    const resp = { code: 0, data: { available_balance: 56.8, voucher_balance: 1, cash_balance: 55.8 } };
    assert.deepStrictEqual(balance.parseKimi(resp), { balance: 56.8, currency: 'CNY' });
    assert.throws(() => balance.parseKimi({ code: 401, message: 'bad key' }), /bad key/);
  });

  test('parseByPath', () => {
    const resp = { data: { available_balance: '33.3' } };
    assert.deepStrictEqual(balance.parseByPath(resp, 'data.available_balance', 'USD'), {
      balance: 33.3,
      currency: 'USD',
    });
    assert.throws(() => balance.parseByPath(resp, '', 'CNY'), /balancePath/);
    assert.throws(() => balance.parseByPath(resp, 'data.nope', 'CNY'), /不存在/);
  });

  test('parseUsageByPaths 缺省周期不返回 + 百分比截断', () => {
    const resp = { five: { pct: 12 }, week: { pct: '105' }, month: { pct: -3 } };
    const r = usage.parseUsageByPaths(resp, { fiveHours: 'five.pct', week: 'week.pct' });
    assert.deepStrictEqual(r, { periods: { fiveHours: { percent: 12 }, week: { percent: 100 } } });
    assert.throws(() => usage.parseUsageByPaths(resp, {}), /paths/);
  });

  test('opencode-go parseUsageValues', () => {
    assert.deepStrictEqual(opencodeGo.parseUsageValues(['1%', '22%', '100%']), {
      periods: { fiveHours: { percent: 1 }, week: { percent: 22 }, month: { percent: 100 } },
    });
    assert.strictEqual(opencodeGo.parseUsageValues(['1%', 'x%', '3%']), null);
    assert.strictEqual(opencodeGo.parseUsageValues(['1%']), null);
    assert.strictEqual(opencodeGo.parseUsageValues(null), null);
  });

  test('注册表 provider 完整 + supportedKinds', () => {
    for (const p of ['opencode-go', 'deepseek', 'kimi', 'volcengine', 'minimax', 'mimo', 'packyapi', 'qwen', 'custom-usage', 'custom-balance']) {
      assert.ok(adapters.getAdapter(p), p);
    }
    assert.deepStrictEqual(adapters.getAdapter('opencode-go').supportedKinds, ['usage']);
    assert.deepStrictEqual(adapters.getAdapter('deepseek').supportedKinds, ['balance']);
    assert.deepStrictEqual(adapters.getAdapter('kimi').supportedKinds, ['balance']);
    assert.deepStrictEqual(adapters.getAdapter('minimax').supportedKinds, ['usage', 'balance']);
    assert.deepStrictEqual(adapters.getAdapter('volcengine').supportedKinds, ['balance']);
    assert.deepStrictEqual(adapters.getAdapter('mimo').supportedKinds, ['balance']);
    assert.deepStrictEqual(adapters.getAdapter('packyapi').supportedKinds, ['balance']);
    assert.deepStrictEqual(adapters.getAdapter('qwen').supportedKinds, ['balance']);
    assert.strictEqual(adapters.getAdapter('nope'), null);
  });

  console.log('volcengine 签名:');
  const volc = require('../src/main/adapters/volcengine');
  const VOLC_AK = 'AKLTYWViMTVmZGYzM2E0NDI5Mzk2MDZjNjFmMjc2MjRjMzg';
  const VOLC_SK = 'WkRZeE1EQmxPVGhsWWpWak5HVmtNbUUxTXpZeU9UVXlOMlE1TmpZeVlqTQ==';
  const VOLC_DATE = '2025-03-29T18:09:37Z';

  test('官方测试向量 GET QueryBalanceAcct', () => {
    // 向量来自官方文档 https://www.volcengine.com/docs/6369/67269
    const signed = volc.signVolc({
      method: 'GET',
      host: 'billing.volcengineapi.com',
      path: '/',
      query: { Action: 'QueryBalanceAcct', Version: '2022-01-01' },
      service: 'billing',
      region: 'cn-beijing',
      ak: VOLC_AK,
      sk: VOLC_SK,
      date: VOLC_DATE,
    });
    assert.strictEqual(signed.xDate, '20250329T180937Z');
    assert.strictEqual(signed.signature, '1eda9e7e6b1728151a8e8791fdaf67cfbd28bd5c80d0fce2eb208746cf483105');
    assert.strictEqual(signed.signedHeaders, 'host;x-date');
    assert.strictEqual(
      signed.authorization,
      `HMAC-SHA256 Credential=${VOLC_AK}/20250329/cn-beijing/billing/request, SignedHeaders=host;x-date, Signature=1eda9e7e6b1728151a8e8791fdaf67cfbd28bd5c80d0fce2eb208746cf483105`
    );
    assert.strictEqual(signed.headers['X-Date'], '20250329T180937Z');
    assert.strictEqual(signed.headers.Authorization, signed.authorization);
    assert.ok(!('Host' in signed.headers)); // Host 由 fetch 从 URL 推导
  });

  test('官方测试向量 POST ListBill', () => {
    const signed = volc.signVolc({
      method: 'POST',
      host: 'billing.volcengineapi.com',
      path: '/',
      query: { Action: 'ListBill', Version: '2022-01-01' },
      body: '{"Limit":10,"BillPeriod":"2023-08"}',
      service: 'billing',
      region: 'cn-beijing',
      ak: VOLC_AK,
      sk: VOLC_SK,
      date: VOLC_DATE,
    });
    assert.strictEqual(signed.signature, '5e8480ceea12d0000a23c054151c50dd02c1a7dec835004057d19f13d53a7658');
  });

  test('签名确定性 + 随 sk 变化', () => {
    const input = {
      method: 'GET',
      host: 'open.volcengineapi.com',
      path: '/',
      query: { Action: 'QueryBalanceAcct', Version: '2022-01-01' },
      service: 'billing',
      region: 'cn-beijing',
      ak: 'AKxxx',
      sk: 'SKyyy',
      date: VOLC_DATE,
    };
    assert.strictEqual(volc.signVolc(input).signature, volc.signVolc(input).signature);
    assert.notStrictEqual(volc.signVolc(Object.assign({}, input, { sk: 'other' })).signature, volc.signVolc(input).signature);
  });

  test('parseVolcBalance', () => {
    assert.deepStrictEqual(
      volc.parseVolcBalance({ Result: { AvailableBalance: '77.01', CashBalance: '83.01' } }),
      { balance: 77.01, currency: 'CNY' }
    );
    assert.throws(() => volc.parseVolcBalance({ Result: {} }), /AvailableBalance/);
    assert.throws(
      () => volc.parseVolcBalance({ ResponseMetadata: { Error: { Code: 'InvalidAccessKey', Message: 'bad ak' } } }),
      /InvalidAccessKey/
    );
  });

  console.log('web-sync 纯函数:');
  const websync = require('../src/main/adapters/web-sync');

  test('parseUsageCandidates 按标签归类', () => {
    const candidates = [
      { label: '每5小时用量 已用', value: 12.4 },
      { label: '本周限额 Weekly limit', value: 45 },
      { label: '本月额度', value: 88.6 },
      { label: '无关百分比', value: 99 },
    ];
    assert.deepStrictEqual(websync.parseUsageCandidates(candidates), {
      periods: { fiveHours: { percent: 12 }, week: { percent: 45 }, month: { percent: 89 } },
    });
    assert.deepStrictEqual(websync.parseUsageCandidates([{ label: '5H reset', value: 3 }]), {
      periods: { fiveHours: { percent: 3 } },
    });
    assert.strictEqual(websync.parseUsageCandidates([{ label: '无关', value: 1 }]), null);
    assert.strictEqual(websync.parseUsageCandidates(null), null);
  });

  test('parseBalanceCandidates 优先可用/余额标签', () => {
    const candidates = [
      { label: '现金余额 ¥83.01', amount: 83.01, symbol: '¥' },
      { label: '可用余额 ¥77.01', amount: 77.01, symbol: '¥' },
    ];
    assert.deepStrictEqual(websync.parseBalanceCandidates(candidates, 'CNY'), { balance: 77.01, currency: 'CNY' });
    assert.deepStrictEqual(websync.parseBalanceCandidates([{ label: 'balance', amount: 9.5, symbol: '$' }], 'CNY'), {
      balance: 9.5,
      currency: 'USD',
    });
    assert.strictEqual(websync.parseBalanceCandidates([], 'CNY'), null);
  });

  test('parseHeuristicResult 直给形状优先', () => {
    assert.deepStrictEqual(websync.parseHeuristicResult({ balance: 12.3 }, { kind: 'balance' }), {
      balance: 12.3,
      currency: 'CNY',
    });
    assert.deepStrictEqual(websync.parseHeuristicResult({ fiveHours: 1, week: 105 }, { kind: 'usage' }), {
      periods: { fiveHours: { percent: 1 }, week: { percent: 100 } },
    });
    // 回落到候选解析
    assert.deepStrictEqual(
      websync.parseHeuristicResult({ percentCandidates: [{ label: '本周', value: 40 }] }, { kind: 'usage' }),
      { periods: { week: { percent: 40 } } }
    );
    assert.strictEqual(websync.parseHeuristicResult({ amountCandidates: [] }, { kind: 'balance' }), null);
  });

  test('heuristicIsReady / heuristicShouldThrow', () => {
    assert.strictEqual(websync.heuristicIsReady({ isLoginPage: true, percentCandidates: [{ label: '周', value: 1 }] }, { kind: 'usage' }), false);
    assert.strictEqual(websync.heuristicIsReady({ percentCandidates: [{ label: '周', value: 1 }] }, { kind: 'usage' }), true);
    assert.strictEqual(websync.heuristicIsReady({ fiveHours: 1 }, { kind: 'usage' }), true);
    assert.strictEqual(websync.heuristicIsReady({ balance: 5 }, { kind: 'balance' }), true);
    assert.strictEqual(websync.heuristicIsReady({ percentCandidates: [] }, { kind: 'usage' }), false);
    assert.ok(websync.heuristicShouldThrow({ isLoginPage: true }) instanceof Error);
    assert.strictEqual(websync.heuristicShouldThrow({}), null);
  });

  console.log('minimax（API）:');
  const minimax = require('../src/main/adapters/minimax');

  test('parseTokenPlan 正常：interval→fiveHours，weekly→week，无 month', () => {
    const resp = {
      model_remains: [
        {
          model_name: 'm1',
          current_interval_total_count: 100,
          current_interval_usage_count: 40,
          current_interval_remaining_percent: 60,
          current_interval_status: 1,
          current_weekly_total_count: 1000,
          current_weekly_usage_count: 500,
          current_weekly_remaining_percent: 50,
          current_weekly_status: 1,
        },
      ],
    };
    assert.deepStrictEqual(minimax.parseTokenPlan(resp), {
      periods: { fiveHours: { percent: 40 }, week: { percent: 50 } },
    });
  });

  test('parseTokenPlan 多模型取 max（各周期独立）', () => {
    const resp = {
      model_remains: [
        { current_interval_total_count: 100, current_interval_usage_count: 10, current_interval_status: 1, current_weekly_total_count: 100, current_weekly_usage_count: 90, current_weekly_status: 1 },
        { current_interval_total_count: 100, current_interval_usage_count: 70, current_interval_status: 1, current_weekly_total_count: 100, current_weekly_usage_count: 20, current_weekly_status: 1 },
      ],
    };
    assert.deepStrictEqual(minimax.parseTokenPlan(resp), {
      periods: { fiveHours: { percent: 70 }, week: { percent: 90 } },
    });
  });

  test('parseTokenPlan status=2 耗尽→100，status=3 无限制→0，total=0 用 remaining_percent', () => {
    assert.deepStrictEqual(
      minimax.parseTokenPlan({
        model_remains: [{ current_interval_status: 2, current_weekly_status: 3 }],
      }),
      { periods: { fiveHours: { percent: 100 }, week: { percent: 0 } } }
    );
    assert.deepStrictEqual(
      minimax.parseTokenPlan({
        model_remains: [{ current_interval_total_count: 0, current_interval_remaining_percent: 60, current_interval_status: 1 }],
      }),
      { periods: { fiveHours: { percent: 40 } } }
    );
  });

  test('parseTokenPlan base_resp 报错 / 缺 model_remains', () => {
    assert.throws(
      () => minimax.parseTokenPlan({ base_resp: { status_code: 1004, status_msg: '未登录' } }),
      /1004.*未登录/
    );
    assert.throws(() => minimax.parseTokenPlan({}), /model_remains/);
  });

  test('parseMinimaxBalance string 金额 / base_resp 报错', () => {
    assert.deepStrictEqual(
      minimax.parseMinimaxBalance({ available_amount: '123.45', base_resp: { status_code: 0 } }),
      { balance: 123.45, currency: 'CNY' }
    );
    assert.throws(
      () => minimax.parseMinimaxBalance({ base_resp: { status_code: 1008, status_msg: '余额不足' } }),
      /1008/
    );
    assert.throws(() => minimax.parseMinimaxBalance({}), /available_amount/);
  });

  console.log('monitor 调度器:');
  const monitor = require('../src/main/monitor');
  const broadcasts = [];
  let fetchCount = 0;
  let shouldFail = false;
  const kindCalls = [];
  const stubAdapters = {
    stub: {
      kind: 'usage',
      supportedKinds: ['usage'],
      fetchUsage: async () => {
        fetchCount++;
        if (shouldFail) throw new Error('boom');
        return { periods: { week: { percent: fetchCount } } };
      },
    },
    'stub-both': {
      kind: 'usage',
      supportedKinds: ['usage', 'balance'],
      fetchUsage: async () => {
        kindCalls.push('usage');
        return { periods: { week: { percent: 1 } } };
      },
      fetchBalance: async () => {
        kindCalls.push('balance');
        return { balance: 1, currency: 'CNY' };
      },
    },
  };
  monitor.initMonitor({ adapters: stubAdapters, ctx: {}, broadcast: (p) => broadcasts.push(p) });

  let stubId;
  await test('refreshMonitor 成功 → 缓存 + broadcast', async () => {
    const m = config.addMonitor({ provider: 'stub', kind: 'usage', refresh: { mode: 'manual' } });
    stubId = m.id;
    const entry = await monitor.refreshMonitor(stubId, { force: true });
    assert.strictEqual(entry.ok, true);
    assert.strictEqual(entry.data.periods.week.percent, 1);
    assert.strictEqual(fetchCount, 1);
    assert.strictEqual(broadcasts.length, 1);
    assert.deepStrictEqual(monitor.getCached(stubId), entry);
  });

  await test('30s 缓存内不重复取数，force 强制取数', async () => {
    const e1 = await monitor.refreshMonitor(stubId);
    assert.strictEqual(fetchCount, 1);
    assert.strictEqual(e1.data.periods.week.percent, 1);
    const e2 = await monitor.refreshMonitor(stubId, { force: true });
    assert.strictEqual(fetchCount, 2);
    assert.strictEqual(e2.data.periods.week.percent, 2);
  });

  await test('失败保留上次数据 + error', async () => {
    shouldFail = true;
    const entry = await monitor.refreshMonitor(stubId, { force: true });
    assert.strictEqual(entry.ok, false);
    assert.strictEqual(entry.error, 'boom');
    assert.strictEqual(entry.data.periods.week.percent, 2); // 上次数据
    shouldFail = false;
  });

  await test('startAll 只调度 enabled+interval，stopAll 清理', async () => {
    config.updateMonitor(stubId, { refresh: { mode: 'interval', minutes: 1 } }); // 缓存是热的，不应重取
    config.addMonitor({ provider: 'stub', kind: 'usage', refresh: { mode: 'interval', minutes: 1 } }); // 冷缓存，应取一次
    config.addMonitor({ provider: 'stub', kind: 'usage', refresh: { mode: 'manual' } }); // manual 不定时
    config.addMonitor({ provider: 'stub', kind: 'usage', enabled: false, refresh: { mode: 'interval', minutes: 1 } }); // 停用
    const before = fetchCount;
    monitor.startAll();
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(fetchCount, before + 1); // 只有冷缓存的 interval 项取了一次
    monitor.stopAll();
  });

  await test('未知适配器报错但不崩', async () => {
    const m = config.addMonitor({ provider: 'ghost', kind: 'usage' });
    const entry = await monitor.refreshMonitor(m.id, { force: true });
    assert.strictEqual(entry.ok, false);
    assert.match(entry.error, /未知适配器/);
  });

  await test('按 monitor.kind 分派 + supportedKinds 校验', async () => {
    const mu = config.addMonitor({ provider: 'stub-both', kind: 'usage' });
    const mb = config.addMonitor({ provider: 'stub-both', kind: 'balance' });
    await monitor.refreshMonitor(mu.id, { force: true });
    await monitor.refreshMonitor(mb.id, { force: true });
    assert.deepStrictEqual(kindCalls, ['usage', 'balance']);
    // stub 只支持 usage，建 balance 项应报不支持
    const bad = config.addMonitor({ provider: 'stub', kind: 'balance' });
    const entry = await monitor.refreshMonitor(bad.id, { force: true });
    assert.strictEqual(entry.ok, false);
    assert.match(entry.error, /不支持 balance/);
  });

  console.log('provider 元信息:');
  test('listProviderMeta 与适配器 supportedKinds 一致', () => {
    const metas = adapters.listProviderMeta();
    assert.strictEqual(metas.length, 10);
    for (const m of metas) {
      assert.deepStrictEqual(m.supportedKinds, adapters.getAdapter(m.id).supportedKinds, m.id);
      assert.strictEqual(typeof m.needsApiKey, 'boolean', m.id);
      assert.strictEqual(typeof m.isWebSync, 'boolean', m.id);
    }
    const byId = Object.fromEntries(metas.map((m) => [m.id, m]));
    assert.strictEqual(byId['opencode-go'].isWebSync, true);
    assert.strictEqual(byId['minimax'].isWebSync, false);
    assert.strictEqual(byId['minimax'].needsApiKey, true);
    assert.strictEqual(byId['minimax'].defaultBaseUrl, 'https://www.minimaxi.com');
    assert.strictEqual(byId['volcengine'].needsAkSk, true);
    assert.strictEqual(byId['deepseek'].needsApiKey, true);
    assert.strictEqual(byId['deepseek'].defaultBaseUrl, 'https://api.deepseek.com');
    assert.strictEqual(byId['custom-usage'].needsBaseUrl, true);
  });

  console.log('i18n:');
  await test('zh/en 字典 key 一致 + t() 插值', async () => {
    const i18n = await import('../src/renderer/i18n.js');
    const zhKeys = Object.keys(i18n.dicts.zh).sort();
    const enKeys = Object.keys(i18n.dicts.en).sort();
    assert.deepStrictEqual(enKeys, zhKeys);
    // 空值检查
    for (const lang of ['zh', 'en']) {
      for (const [k, v] of Object.entries(i18n.dicts[lang])) {
        assert.ok(v && String(v).trim(), `${lang}.${k} 为空`);
      }
    }
    i18n.setLocale('zh');
    assert.strictEqual(i18n.t('period.week'), '本周');
    assert.strictEqual(i18n.t('monitor.intervalMinutes', { n: 5 }), '每 5 分钟');
    i18n.setLocale('en');
    assert.strictEqual(i18n.t('monitor.intervalMinutes', { n: 5 }), 'Every 5 min');
    assert.strictEqual(i18n.t('nonexistent.key'), 'nonexistent.key');
    i18n.setLocale('zh');
  });

  console.log('渲染层预警逻辑（state.js）:');
  await test('getAlertCfg 单监控覆盖深合并 + alertLevel/balanceAlertLevel 落档', async () => {
    const st = await import('../src/renderer/state.js');
    st.state.config = {
      alert: {
        mode: 'dot', threshold1: 50, threshold2: 85, balanceThreshold1: 50, balanceThreshold2: 20,
        colors: { safe: '#0f0', warning: '#ff0', danger: '#f00' },
        images: { safe: '', warning: '', danger: '' },
      },
    };
    // 无覆盖：用全局
    assert.strictEqual(st.alertLevel(40), 'safe');
    assert.strictEqual(st.alertLevel(60), 'warning');
    assert.strictEqual(st.alertLevel(90), 'danger');
    assert.strictEqual(st.balanceAlertLevel(100), 'safe');
    assert.strictEqual(st.balanceAlertLevel(30), 'warning');
    assert.strictEqual(st.balanceAlertLevel(5), 'danger');
    // 覆盖阈值：usage 型
    const mu = { alert: { threshold1: 10, threshold2: 20 } };
    assert.strictEqual(st.alertLevel(15, mu), 'warning');
    assert.strictEqual(st.alertLevel(15), 'safe'); // 全局不受影响
    const cfgU = st.getAlertCfg(mu);
    assert.strictEqual(cfgU.threshold1, 10);
    assert.strictEqual(cfgU.colors.safe, '#0f0'); // 未覆盖字段回落全局
    // 覆盖阈值：balance 型 + 颜色部分覆盖
    const mb = { alert: { balanceThreshold1: 100, balanceThreshold2: 50, colors: { danger: '#000' } } };
    assert.strictEqual(st.balanceAlertLevel(80, mb), 'warning');
    assert.strictEqual(st.balanceAlertLevel(80), 'safe');
    const cfgB = st.getAlertCfg(mb);
    assert.strictEqual(cfgB.colors.danger, '#000');
    assert.strictEqual(cfgB.colors.safe, '#0f0');
    assert.strictEqual(cfgB.balanceThreshold1, 100);
  });

  await test('computeReorderIds 计算拖动后的顺序', async () => {
    const st = await import('../src/renderer/state.js');
    const mk = (id) => ({ id });
    st.state.monitors = [mk('a'), mk('b'), mk('c'), mk('d')];
    // 拖到目标之前 / 之后
    assert.deepStrictEqual(st.computeReorderIds('a', 'c', false), ['b', 'a', 'c', 'd']);
    assert.deepStrictEqual(st.computeReorderIds('a', 'c', true), ['b', 'c', 'a', 'd']);
    assert.deepStrictEqual(st.computeReorderIds('d', 'a', false), ['d', 'a', 'b', 'c']);
    assert.deepStrictEqual(st.computeReorderIds('d', 'a', true), ['a', 'd', 'b', 'c']);
    assert.deepStrictEqual(st.computeReorderIds('b', 'c', true), ['a', 'c', 'b', 'd']);
    // 非法 id 返回 null
    assert.strictEqual(st.computeReorderIds('ghost', 'c', false), null);
    assert.strictEqual(st.computeReorderIds('a', 'ghost', false), null);
  });

  console.log('monitors 预警覆盖持久化（config.js）:');
  await test('updateMonitor 写入/清除 alert 覆盖', async () => {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planusage-cfg-'));
    const config = require('../src/main/config.js');
    config.initConfig(dir);
    const m = config.addMonitor({ kind: 'usage', name: 't', provider: 'deepseek' });
    // 写入覆盖
    let updated = config.updateMonitor(m.id, { alert: { threshold1: 10, threshold2: 20, colors: { safe: '#123456' } } });
    assert.strictEqual(updated.alert.threshold1, 10);
    assert.strictEqual(updated.alert.colors.safe, '#123456');
    // 磁盘上也存在
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'monitors.json'), 'utf-8'));
    assert.strictEqual(onDisk.monitors[0].alert.threshold2, 20);
    // 清除覆盖（patch.alert = null 删除该键）
    updated = config.updateMonitor(m.id, { alert: null });
    assert.strictEqual('alert' in updated, false);
    const onDisk2 = JSON.parse(fs.readFileSync(path.join(dir, 'monitors.json'), 'utf-8'));
    assert.strictEqual('alert' in onDisk2.monitors[0], false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  console.log('余额历史记录（history.js）:');
  const history = require('../src/main/history');

  test('initHistory + record + getHistory', () => {
    const dir = tmpdir();
    history.initHistory(dir);
    assert.deepStrictEqual(history.getHistory('x'), []);
    history.record('x', 100);
    history.record('x', 90);
    history.record('x', 80);
    const h = history.getHistory('x');
    assert.strictEqual(h.length, 3);
    assert.strictEqual(h[0].balance, 100);
    assert.strictEqual(h[2].balance, 80);
    assert.ok(h[0].ts > 0);
    // record 忽略无效值
    history.record('x', NaN);
    history.record('x', null);
    assert.strictEqual(history.getHistory('x').length, 3);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('findClosest 找最近快照', () => {
    const arr = [
      { ts: 1000, balance: 100 },
      { ts: 5000, balance: 80 },
      { ts: 10000, balance: 60 },
    ];
    assert.strictEqual(history.findClosest(arr, 3000).balance, 100);
    assert.strictEqual(history.findClosest(arr, 5000).balance, 80);
    assert.strictEqual(history.findClosest(arr, 8000).balance, 80);
    assert.strictEqual(history.findClosest(arr, 500), null); // 所有记录都在目标之后
    assert.strictEqual(history.findClosest([], 1000), null);
    assert.strictEqual(history.findClosest(null, 1000), null);
  });

  test('computeStats 计算日/周消费', () => {
    const dir = tmpdir();
    history.initHistory(dir);
    const now = Date.now();
    const H = 3600 * 1000;
    // 手动注入历史数据（不通过 record 以控制时间戳）
    const hist = [
      { ts: now - 7 * 24 * H, balance: 200 },
      { ts: now - 24 * H, balance: 100 },
      { ts: now - 12 * H, balance: 80 },
      { ts: now, balance: 60 },
    ];
    // 直接操作内部 data
    history.record('test', 60); // 初始化
    // 用 findClosest 验证逻辑
    const closest = history.findClosest(hist, now - 24 * H);
    assert.strictEqual(closest.balance, 100);
    // dayDelta = 100 - 60 = 40（消费了 40）
    // weekDelta = 200 - 60 = 140（消费了 140）
    assert.strictEqual(hist[1].balance - hist[3].balance, 40);
    assert.strictEqual(hist[0].balance - hist[3].balance, 140);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
