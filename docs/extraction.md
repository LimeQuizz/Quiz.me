# Extraction

The extractor (`extractor/`) turns one PDF or PPTX into candidate flashcards.
It is a small FastAPI service with no database, no object storage, and no
outbound network access. Web is its only client.

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/healthz` | none | Liveness/readiness. Returns `{"status": "ok"}`. |
| `POST` | `/v1/extract` | `X-Extractor-Secret` | Raw file bytes in the body (`application/octet-stream`). Returns candidate cards. |

The secret is compared with `hmac.compare_digest`. The service refuses to start
if `EXTRACTOR_SHARED_SECRET` is shorter than 32 characters. OpenAPI and docs
endpoints are disabled.

Response:

```json
{
  "kind": "pdf",
  "sections": 3,
  "ocr_sections": 0,
  "cards": [
    {
      "front": "Which planet is known as the Red Planet?",
      "back": "Mars",
      "card_type": "multiple_choice",
      "options": ["Venus", "Mars", "Jupiter", "Saturn"],
      "confidence": 0.9,
      "source_ref": "page 2",
      "detector": "multiple_choice"
    }
  ]
}
```

Errors are JSON `{"error": "<code>", "message": "..."}`:

| Status | `error` | Cause |
|--------|---------|-------|
| 400 | `empty_body` | No bytes sent |
| 408 | `body_timeout` | The body did not arrive within `EXTRACTOR_BODY_TIMEOUT_SECONDS` (30) |
| 401 | `unauthorized` | Missing or wrong shared secret |
| 413 | `too_large` | Over `EXTRACTOR_MAX_BYTES` (25 MB), checked on `Content-Length` and while streaming |
| 415 | `unsupported_file` | Magic bytes are not `%PDF-` or a ZIP, or the ZIP is not a presentation |
| 422 | `encrypted_file` | Encrypted/password-protected PDF, encrypted OOXML, or legacy `.ppt` |
| 422 | `macro_enabled` | `.pptm` content type or a `vbaProject.bin` part |
| 422 | `too_many_pages` | More than `EXTRACTOR_MAX_PAGES` (300) pages or slides |
| 422 | `corrupt_file` | Parser failure, ZIP bomb heuristics |
| 503 | `busy` | Overloaded; see "Admission control". Carries `Retry-After`. |
| 504 | `timeout` | Extraction exceeded `EXTRACTOR_TIMEOUT_SECONDS` (60) |

## File handling

1. The body is streamed to `mkstemp()` in `EXTRACTOR_TMP_DIR` (a tmpfs in
   every deployment), mode `0600`, counting bytes as it goes.
2. The type is decided from the first bytes, never the filename (the
   extractor never sees the filename).
3. A child process (`python -m app.pipeline.worker <path>`) runs the
   pipeline with `RLIMIT_AS` set to `EXTRACTOR_MEMORY_LIMIT_MB`, in its own
   process group, with a minimal environment that does not include the shared
   secret.
4. If the child exceeds the timeout, the whole process group (including any
   `tesseract` processes) is killed with `SIGKILL`.
5. The temp file is deleted in a `finally` block on every path: success,
   validation error, timeout, crash, or client disconnect.

## Admission control

At most `EXTRACTOR_MAX_CONCURRENCY` (default 2) extractions run at once per
replica and at most `EXTRACTOR_QUEUE_SIZE` (default 4) more wait. A request is
admitted before its body is read, so an overloaded replica does not spend
bandwidth or disk on uploads it cannot process.

The extractor keeps a moving average of how long extractions take. A new
request is turned away with `503 busy` at once if the queue is full, or if
the average says it would wait longer than
`EXTRACTOR_MAX_QUEUE_WAIT_SECONDS` (default 30). `Retry-After` is derived
from the same average, so it grows when documents are slow (OCR-heavy) and
shrinks when they are fast. A request that does get queued but still waits
past the limit also gets `503`.

uvicorn caps open connections at 64 (`--limit-concurrency`, excess gets
`503`) and drops idle keep-alive connections after 5 s. The whole body must
arrive within 30 s, which defeats slow-upload attacks.

## Pipeline

Code lives in `extractor/app/pipeline/`.

### 1. Text extraction (`text_pdf.py`, `text_pptx.py`)

- **PDF:** PyMuPDF, one `Section` per page, text sorted in reading order.
- **PPTX:** python-pptx, one `Section` per slide with the title placeholder
  kept separately, body paragraphs (placeholder paragraphs and indented
  paragraphs become `- ` bullets), tables (two-column rows become
  `left: right`, wider rows are joined with ` | `), and speaker notes. Group
  shapes are walked recursively.

### 2. Quality gate (`ocr.py`)

A page or slide whose text has fewer than `EXTRACTOR_OCR_MIN_CHARS` (25)
letters and digits is treated as scanned:

- PDF pages are rasterized in grayscale at `EXTRACTOR_OCR_DPI` (default 200,
  hard cap 300), further scaled down so no render exceeds 40 megapixels.
- PPTX slides have up to five embedded pictures OCR'd. Pillow's decompression
  bomb guard is set to 40 megapixels and images are downscaled to 5000 px on
  the long side.

Tesseract runs with `--psm 3`, language `eng`, one thread. Cards from OCR text
get their confidence multiplied by 0.85.

### 3. Cleanup (`cleanup.py`)

All pure functions over lists of strings:

- `normalize_text`: NFKC, ligatures (`ﬁ` to `fi`), smart quotes, soft hyphens
  and zero-width characters removed, whitespace squeezed.
- `find_repeated_lines` / `strip_lines_with_signatures`: lines in the top or
  bottom three lines of at least half the pages (minimum three pages) are
  headers or footers. Digits are folded so "Page 3" matches "Page 4".
- `is_page_number`: `3`, `Page 3 of 10`, `- 12 -`, `4/20`.
- `normalize_bullet`: `•`, `▪`, `◦`, `*`, `–`, `o`, Wingdings bullets and
  others become `- `.
- `dehyphenate`: `exam-` + `ple` becomes `example` when the next line starts
  lowercase.
- `join_wrapped_lines`: a line that does not end a sentence followed by a
  lowercase line that is not a list item is one logical line.

### 4. Detection (`detect.py`)

Detectors are pure functions over cleaned lines that return `Match` objects
(card plus line span). `detect_section` runs them in this order and never lets
two cards use the same line:

| Detector | Recognizes | Confidence |
|----------|-----------|-----------|
| answer key (pre-pass) | `Answer key` block with `1. B 2. C`, `1-B`, `3. Paris` | n/a |
| `multiple_choice` | stem + options `A)`..`E)` / `(a)`.. in order; answer from `Answer: B`, a `*` / `(correct)` marker, or the answer key | 0.90, or 0.55 with no answer |
| `labeled_pair` | `Q:`/`A:`, `Question 1:`/`Answer:`, `Front:`/`Back:`, `Term:`/`Definition:` | 0.95 |
| `numbered_question` | `1.`, `2)`, `(3)`, `Q4.`, `a)` items ending in `?`, answer on the same line after `?` or on the following lines | 0.85 |
| `fill_blank` | `____` or `[blank]`; answer from a trailing `(answer)`, a following `Answer:` line, or the answer key | 0.80, or 0.45 with no answer |
| `term_definition` | `Term: definition`, `Term - definition`, `Term = definition` with a 1 to 6 word term (1 to 4 for dashes) and stop words such as `Note`, `Page`, URLs, and times excluded | 0.75 |
| `slide_title` | PPTX only, when no other detector found a card on the slide: title as question, bullets (or speaker notes) as answer. Generic titles (Agenda, Summary, Thank you...) are skipped | 0.80 if the title ends in `?`, else 0.60 |
| `definitional` | Fallback on unused lines: `X is a ...`, `X refers to ...`, `X is defined as ...`, `X means ...`. Pronoun subjects (It, This, They...) are skipped | 0.45 |

Cards with an empty back (multiple choice without a key, blanks without an
answer) are still returned so the user can fill them in during review; the
web app will not save a card with an empty side.

Fields are clipped to 2000 characters. Exact duplicate fronts are removed,
keeping the highest-confidence copy.

### 5. Output

Cards are sorted by confidence, highest first, ties in document order.

## Tuning against fixtures

`extractor/scripts/make_fixtures.py` generates the files in
`extractor/tests/fixtures/` and documents what each contains.
`extractor/tests/test_fixtures.py` asserts the exact cards that should come
out of each one. Add a fixture and a test whenever you change a heuristic.

## Interface for a future LLM extractor

v1 uses rules only. A model-based extractor should be a drop-in stage that
receives the same cleaned sections and returns the same card type, so the API,
web review screen, and tests do not change:

```python
from typing import Protocol, Sequence
from app.pipeline.types import Card, Section

class CardExtractor(Protocol):
    name: str

    def extract(self, sections: Sequence[Section], *, max_cards: int) -> list[Card]:
        """Return candidate cards.

        Requirements for any implementation:
        - Deterministic `source_ref` taken from the section the card came from.
        - `confidence` in [0, 1], calibrated so that the review screen's
          ordering stays meaningful next to rule-based cards.
        - `detector` set to a stable identifier, for example "llm:<model>".
        - Never raise on model errors; return [] and let the rule-based
          detectors' cards stand.
        - Must not log section text or card content.
        """
```

Operational constraints for such an extractor:

- It would need outbound network access to a model endpoint, which v1 does
  not. Operators who keep the egress-deny NetworkPolicy would need an explicit
  allow rule for that single host.
- Card text and file text would leave the cluster. The README privacy section
  must say so, and it must be opt-in per deployment
  (`EXTRACTOR_LLM_ENABLED=false` by default).
- It must run inside the same worker process so the 60 s timeout and memory
  limit still apply.
- Prompt injection from document text must not be able to do anything except
  produce bad cards, which the user reviews before saving.
