import { resolveOmxDisplayVersionSync } from '../utils/version.js';

export function version(): void {
  const displayVersion = resolveOmxDisplayVersionSync();
  if (displayVersion) {
    console.log(`nomx ${displayVersion}`);
    console.log(`Node.js ${process.version}`);
    console.log(`Platform: ${process.platform} ${process.arch}`);
  } else {
    console.log('nomx (version unknown)');
  }
}
