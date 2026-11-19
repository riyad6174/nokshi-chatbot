import { cache } from "react";
import { getPrimaryStore } from "@/modules/stores/store.service";

/**
 * The store for rendering admin pages, loaded once per request: the layout and the page share one
 * query instead of each running their own. Only for rendering: server actions keep calling
 * getPrimaryStore, so a page re-rendered after a save reads the saved settings, not a copy cached
 * before the save.
 */
export const getAdminPageStore = cache(getPrimaryStore);
