// Dedicated entry point for event-specific ticket links.
if(!process.argv.includes('--tickets'))process.argv.push('--tickets');
await import('./publish-player-status.mjs');
