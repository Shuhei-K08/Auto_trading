/**
 * Repository Factory
 * DATABASE_URL が設定されていれば Neon（PostgreSQL）、
 * なければ従来の SQLite（TradeRepository）を返す
 */

let _instance = null;

async function getRepository() {
  if (_instance) return _instance;

  if (process.env.DATABASE_URL) {
    const { default: NeonRepository } = await import('./neon-repository.js');
    _instance = new NeonRepository();
    // 接続テスト
    await _instance.ping();
    console.log('[DB] Neon PostgreSQL に接続しました');
  } else {
    const { default: TradeRepository } = await import('./trade-repository.js');
    _instance = new TradeRepository();
    console.log('[DB] SQLite（ローカル）を使用します');
  }

  return _instance;
}

export { getRepository };
export default getRepository;
