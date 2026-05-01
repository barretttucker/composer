import { create } from "zustand";

type ComposerStore = {
  previewMuted: boolean;
  togglePreviewMuted: () => void;
};

export const useComposerStore = create<ComposerStore>((set, get) => ({
  previewMuted: true,
  togglePreviewMuted: () =>
    set({ previewMuted: !get().previewMuted }),
}));
