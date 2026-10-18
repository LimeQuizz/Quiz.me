import type { ProgressFields } from "@/lib/fsrs";

export interface PracticeCard {
  id: string;
  front: string;
  back: string;
  options: string[] | null;
}

export interface DueCard extends PracticeCard {
  progress: ProgressFields | null;
}
