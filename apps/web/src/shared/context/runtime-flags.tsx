import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

import { isDevToolsEnabled } from '../../features/dev-tools/dev-tools-gate';

export interface RuntimeFlags {
  devToolsEnabled: boolean;
}

export const defaultRuntimeFlags = (): RuntimeFlags => ({
  devToolsEnabled: isDevToolsEnabled({ dev: import.meta.env.DEV, flag: import.meta.env.VITE_FORGELOOP_ENABLE_DEV_TOOLS }),
});

const RuntimeFlagsContext = createContext<RuntimeFlags>(defaultRuntimeFlags());

export function RuntimeFlagsProvider({ children, value }: { children: ReactNode; value?: Partial<RuntimeFlags> | undefined }) {
  return <RuntimeFlagsContext.Provider value={{ ...defaultRuntimeFlags(), ...value }}>{children}</RuntimeFlagsContext.Provider>;
}

export function useRuntimeFlags() {
  return useContext(RuntimeFlagsContext);
}
