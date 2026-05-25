/**
 * 手動売買実行スクリプト
 */

import Scheduler from './src/scheduler/trading-scheduler.js';

async function runManualTrade() {
  console.log('\n🚀 Manual Trading Execution Started\n');

  try {
    const scheduler = new Scheduler();
    await scheduler.manualExecute();
    console.log('\n✅ Manual Trading Completed Successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message, '\n');
    process.exit(1);
  }
}

runManualTrade();
