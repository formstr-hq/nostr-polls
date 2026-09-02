import { useSyncExternalStore } from "react";
import { wllamaTranslationService } from "../services/wllama-translation-service";

export const useWllamaTranslation = () =>
  useSyncExternalStore(
    wllamaTranslationService.subscribe,
    wllamaTranslationService.getSnapshot,
    wllamaTranslationService.getSnapshot,
  );
