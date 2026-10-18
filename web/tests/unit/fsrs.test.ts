import { describe, expect, it } from "vitest";
import { formatInterval, isGrade, previewIntervals, Rating, review, State } from "@/lib/fsrs";

const NOW = new Date("2026-01-01T12:00:00Z");
const DAY = 86_400_000;

describe("FSRS integration", () => {
  it("schedules a new card by rating", () => {
    const again = review(null, Rating.Again, NOW);
    const good = review(null, Rating.Good, NOW);
    const easy = review(null, Rating.Easy, NOW);
    expect(again.progress.state).toBe(State.Learning);
    expect(again.progress.due.getTime()).toBeLessThan(good.progress.due.getTime() + 1);
    expect(easy.progress.state).toBe(State.Review);
    expect(easy.progress.due.getTime() - NOW.getTime()).toBeGreaterThanOrEqual(DAY);
    expect(easy.progress.reps).toBe(1);
    expect(easy.progress.lastReview).toEqual(NOW);
    expect(easy.log).toMatchObject({ rating: 4, reviewedAt: NOW });
  });

  it("grows intervals with successive Good ratings", () => {
    let p = review(null, Rating.Good, NOW).progress;
    const intervals: number[] = [];
    for (let i = 0; i < 4; i++) {
      const at = p.due;
      p = review(p, Rating.Good, at).progress;
      intervals.push(p.due.getTime() - at.getTime());
    }
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]!).toBeGreaterThanOrEqual(intervals[i - 1]!);
    }
    expect(p.reps).toBe(5);
  });

  it("counts a lapse when a review card is forgotten", () => {
    let p = review(null, Rating.Easy, NOW).progress;
    p = review(p, Rating.Again, p.due).progress;
    expect(p.lapses).toBe(1);
    expect(p.state).toBe(State.Relearning);
  });

  it("previews intervals in rating order", () => {
    const preview = previewIntervals(null, NOW);
    expect(preview[Rating.Again].getTime()).toBeLessThanOrEqual(preview[Rating.Hard].getTime());
    expect(preview[Rating.Good].getTime()).toBeLessThanOrEqual(preview[Rating.Easy].getTime());
  });

  it("validates grades and formats intervals", () => {
    expect([0, 1, 2, 3, 4, 5].map(isGrade)).toEqual([false, true, true, true, true, false]);
    expect(formatInterval(new Date(NOW.getTime() + 10 * 60_000), NOW)).toBe("10m");
    expect(formatInterval(new Date(NOW.getTime() + 3 * 3600_000), NOW)).toBe("3h");
    expect(formatInterval(new Date(NOW.getTime() + 4 * DAY), NOW)).toBe("4d");
    expect(formatInterval(new Date(NOW.getTime() + 90 * DAY), NOW)).toBe("3mo");
    expect(formatInterval(new Date(NOW.getTime() + 800 * DAY), NOW)).toBe("2.2y");
  });
});
