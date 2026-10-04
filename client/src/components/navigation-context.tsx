import { createContext, useContext } from "react";

export const NavigationContext = createContext<{ open: () => void } | null>(null);
export const useWorkspaceNavigation = () => useContext(NavigationContext);
