export type FlowProviderCapabilities = {
  provider: "META" | "ZERNIO";
  media: { image: boolean; video: boolean; audio: boolean; pdf: boolean };
  pdfMode: "attachment" | "link";
  initialButtons: boolean;
  limits: { imageBytes: number; videoBytes: number; audioBytes: number; pdfBytes: number; textBytes: number; maxButtons: number; maxQuickReplies: number };
  messagingWindowHours: number;
  privateReplyWindowDays: number;
  privateReplyLimit: number;
};

/** Documented formats; an account must still have the needed permissions. */
export function getFlowCapabilities(provider: "META" | "ZERNIO"): FlowProviderCapabilities {
  const MB = 1024 * 1024;
  return {
    provider,
    media: { image: true, video: true, audio: true, pdf: provider === "ZERNIO" },
    pdfMode: provider === "ZERNIO" ? "attachment" : "link",
    // The executor uses an opening button only for a confirmed follower.
    initialButtons: true,
    limits: { imageBytes: 8 * MB, videoBytes: 25 * MB, audioBytes: 25 * MB, pdfBytes: 25 * MB, textBytes: 1000, maxButtons: 3, maxQuickReplies: 13 },
    messagingWindowHours: 24,
    privateReplyWindowDays: 7,
    privateReplyLimit: 1,
  };
}
