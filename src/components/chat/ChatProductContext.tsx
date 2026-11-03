"use client";

import { useEffect, useSyncExternalStore } from "react";

// The assistant lives in the root layout (so a voice call survives page changes); a product page
// tells it which product is open with <ChatProductContext productId=… />.

let currentProductId: string | undefined;
const listeners = new Set<() => void>();

function setProductContext(productId: string | undefined) {
  currentProductId = productId;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The product page the customer is on, if any. */
export function useProductContext(): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => currentProductId,
    () => undefined,
  );
}

export function ChatProductContext({ productId }: { productId: string }) {
  useEffect(() => {
    setProductContext(productId);
    return () => setProductContext(undefined);
  }, [productId]);
  return null;
}
