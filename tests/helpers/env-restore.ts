type EnvSnapshot = Record<string, string | undefined>;

export const captureEnv = (keys: string[]): EnvSnapshot =>
  Object.fromEntries(keys.map((key) => [key, process.env[key]]));

export const restoreEnv = (snapshot: EnvSnapshot): void => {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};
