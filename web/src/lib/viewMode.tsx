"use client";

import { createContext, useContext } from "react";

/**
 * Demo mode: the page shows the showcase allowance without a wallet. Every action button is disabled
 * (useAction reports busy), but reading, previews and navigation still work.
 */
export const ReadOnlyContext = createContext(false);
export const useReadOnly = () => useContext(ReadOnlyContext);
