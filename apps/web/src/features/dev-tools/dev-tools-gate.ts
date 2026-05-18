export function isDevToolsEnabled(input: { dev: boolean; flag?: string }) {
  return input.dev || input.flag === 'true';
}
