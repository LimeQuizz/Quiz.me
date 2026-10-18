export const CARD_TYPES = ["basic", "multiple_choice", "fill_blank"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const UPLOAD_STATUSES = ["accepted", "rejected", "failed"] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];
