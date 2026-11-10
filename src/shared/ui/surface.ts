import { createContext, useContext } from 'react';

/** True inside sheets: grouped cells use `surface-elevated` there (01 §2.3). */
export const ElevatedSurfaceContext = createContext(false);

export function useElevatedSurface(): boolean {
  return useContext(ElevatedSurfaceContext);
}
