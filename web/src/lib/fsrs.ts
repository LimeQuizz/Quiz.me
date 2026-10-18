import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";

export { Rating, State };

/** The subset of card_progress columns the scheduler reads and writes. */
export interface ProgressFields {
  due: Date;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: Date | null;
  scheduledDays: number;
  learningSteps: number;
}

export interface ReviewOutcome {
  progress: ProgressFields;
  log: { rating: number; reviewedAt: Date; elapsedDays: number; scheduledDays: number };
}

const scheduler = fsrs(generatorParameters({ enable_fuzz: false, enable_short_term: true }));

const DAY_MS = 24 * 60 * 60 * 1000;

function toFsrsCard(p: ProgressFields | null, now: Date): FsrsCard {
  if (!p) return createEmptyCard(now);
  const elapsed = p.lastReview ? Math.max(0, Math.floor((now.getTime() - p.lastReview.getTime()) / DAY_MS)) : 0;
  return {
    due: p.due,
    stability: p.stability,
    difficulty: p.difficulty,
    elapsed_days: elapsed,
    scheduled_days: p.scheduledDays,
    learning_steps: p.learningSteps,
    reps: p.reps,
    lapses: p.lapses,
    state: p.state as State,
    last_review: p.lastReview ?? undefined,
  };
}

export function isGrade(value: number): value is Grade {
  return value === Rating.Again || value === Rating.Hard || value === Rating.Good || value === Rating.Easy;
}

/** Apply one rating to a card's progress (null for a new card). */
export function review(progress: ProgressFields | null, rating: Grade, now: Date = new Date()): ReviewOutcome {
  const { card, log } = scheduler.next(toFsrsCard(progress, now), now, rating);
  return {
    progress: {
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      lastReview: card.last_review ?? now,
      scheduledDays: card.scheduled_days,
      learningSteps: card.learning_steps,
    },
    log: {
      rating,
      reviewedAt: now,
      elapsedDays: log.elapsed_days,
      scheduledDays: log.scheduled_days,
    },
  };
}

/** When each rating would schedule the card next, for button labels. */
export function previewIntervals(progress: ProgressFields | null, now: Date = new Date()): Record<Grade, Date> {
  const preview = scheduler.repeat(toFsrsCard(progress, now), now);
  return {
    [Rating.Again]: preview[Rating.Again].card.due,
    [Rating.Hard]: preview[Rating.Hard].card.due,
    [Rating.Good]: preview[Rating.Good].card.due,
    [Rating.Easy]: preview[Rating.Easy].card.due,
  } as Record<Grade, Date>;
}

export function formatInterval(due: Date, now: Date = new Date()): string {
  const minutes = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
