// Dedicated entry point for the complete Warriors broadcast release.
if (!process.argv.includes('--broadcasts')) process.argv.push('--broadcasts');
await import('./publish-player-status.mjs');
