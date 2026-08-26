## 🧠 SRS — one card, one clock, weighted facets

- **One schedule per word** (Anki-style: interval × ease, grades Forgot/Hard/Okay/Easy with next-interval previews on the buttons; leech suspension after 8 lapses, reactivatable).
- **Three question facets** (meaning / reading / writing) share the clock but track their own `strength` (mastery 0–8) and `asked` (rotation counter). Queue picks per card: `score = asked + 2·strength`, lowest wins → **the weakest facet is asked most often, strong ones still resurface**. Failing a facet re-drills *that* facet; mastered ones aren't re-tested to prop it up.
- Writing is asked on every card; `learn_writing` only switches the hint (✍️ handwrite strokes vs ⌨️ type via pinyin keyboard).
- **Scaffolding**: interval < 14d → pinyin shown + audio auto-played; mature cards must be answered from characters alone. Answers are always spoken.
- Typed answers checked: pinyin with tones (**fuzzy toggle**: 2nd/3rd tone interchangeable) or exact hanzi.
- Legacy 3-schedule data was merged in-place; every word keeps its pre-merge state in `srs_legacy` for rollback.

## How scheduling works

Each word has **one** SRS state — `{due, intervalDays, ease, lapses}`, Anki's SM-2
style. When the card comes due, the facet picker in `shared/src/srs.ts` chooses which
of the three facets (meaning / reading / writing) to ask, based on per-facet
`facets: {strength, asked}` — weakest facet most often, stronger ones still revisited.
All tuning constants are in `shared/src/srs.ts` (`TUNING`). Grades:

| grade                 | trigger                                     | effect                                                  |
| --------------------- | ------------------------------------------- | ------------------------------------------------------- |
| `reviewed_forgot`     | classic review "Forgot"                     | lapse: interval reset, ease −0.2, re-shown this session |
| `reviewed_hard`       | classic review "Hard"                       | interval × 1.2, ease −0.15                              |
| `reviewed_okay`       | classic review "Okay"                       | interval × ease, due pushed out                         |
| `reviewed_easy`       | classic review "Easy"                       | interval × ease × 1.3 (min 4d), ease +0.15              |
| `conversation_used`   | you typed a dictionary word in conversation | small bump on reading+writing (once/word/day)           |
| `conversation_missed` | you tapped a gloss on a word the AI used    | meaning: interval halved, due now                       |

# chinese specific

The app is chinese specific.
Contrary to some language (like Spanish), pronounciation isn't obvious just from seeing a character, so practicing Reading is important and its own aspect.
There's the option "Fuzzy pinyin", this makes reading tests more lenient (the second and third tones are combined).