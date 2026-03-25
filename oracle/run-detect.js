import { detectSignals } from './signal-detector.js';

const result = detectSignals();
console.log(`\n🔮 Oracle Detection Complete`);
console.log(`Signals generated: ${result.summary.total}`);
for (const [type, count] of Object.entries(result.summary.by_type)) {
  console.log(`  ${type}: ${count}`);
}
if (result.signals.length) {
  console.log('\nActive signals:');
  for (const s of result.signals) {
    console.log(`  [${s.severity}] ${s.signal_type}: ${s.title}`);
  }
} else {
  console.log('\nNo new signals detected.');
}
