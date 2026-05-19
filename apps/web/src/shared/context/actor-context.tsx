import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export interface ActorContextValue {
  actorId: string;
}

export const defaultActorContext: ActorContextValue = {
  actorId: 'actor-owner',
};

const ActorContext = createContext<ActorContextValue>(defaultActorContext);

export function ActorProvider({ children, value }: { children: ReactNode; value?: Partial<ActorContextValue> | undefined }) {
  return <ActorContext.Provider value={{ ...defaultActorContext, ...value }}>{children}</ActorContext.Provider>;
}

export function useActorContext() {
  return useContext(ActorContext);
}
