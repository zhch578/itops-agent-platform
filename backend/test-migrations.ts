
import { ALL_MIGRATIONS } from './src/models/migrations/index';

console.log('=== ALL MIGRATIONS ===');
const versions = new Set<number>();
let duplicateFound = false;

ALL_MIGRATIONS.forEach(m => {
  console.log(`v${m.version} - ${m.name}`);
  if (versions.has(m.version)) {
    console.error(`❌ DUPLICATE VERSION v${m.version} for ${m.name}`);
    duplicateFound = true;
  }
  versions.add(m.version);
});

console.log('\n=== UNIQUE VERSIONS ===');
console.log([...versions].sort((a, b) => a - b));

if (duplicateFound) {
  console.error('\n❌ FOUND DUPLICATE VERSIONS!');
  process.exit(1);
} else {
  console.log('\n✅ NO DUPLICATES FOUND!');
  process.exit(0);
}
