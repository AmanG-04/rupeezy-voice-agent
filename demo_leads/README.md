# Demo lead CSVs

Three pre-built lead lists for testing the batch-upload + dial-next pipeline. All names and phone numbers are fictitious. None overlap with the template CSV the dashboard ships, so you can upload these on top of a fresh prod environment without duplicate-skip noise.

## How to use

1. Open the dashboard: `/dashboard`
2. Click **Upload leads** (top-right).
3. Click **Choose file** and pick one of the CSVs below.
4. Click **Process queue** — each lead runs through the real conversation engine (Gemini + RAG + classifier) one at a time. The funnel populates live as each call ends.

You can also run them via the landing page's **"Run live demo"** button (which uses the smaller built-in seed of 4 leads).

## What's in each file

| File | Leads | What it demonstrates |
| --- | --- | --- |
| [`01_basic_4_personas.csv`](01_basic_4_personas.csv) | 4 | One of each bucket — HOT advisor, WARM Hindi MFD, COLD busy influencer, DND hostile. Fastest end-to-end demo. |
| [`02_regional_showcase.csv`](02_regional_showcase.csv) | 8 | Mix of language preferences (English, Hindi, Hinglish, Other) skewed toward regional names — proves the language-pref column flows into the prompt and the WhatsApp template. |
| [`03_stress_test_12.csv`](03_stress_test_12.csv) | 12 | Larger queue with all 4 scenarios distributed across language types. Useful for showing the funnel populating with realistic Hot/Warm/Cold/DND ratios after several minutes of processing. |

## Scenario keys

The dialer reads the `scenario` column and runs a different scripted user-side conversation for each. All 4 keys produce real conversations through the LLM — the scenario only changes what the simulated lead says, not the agent's behaviour.

| Key | Resulting bucket | What the simulated lead does |
| --- | --- | --- |
| `hot_advisor` | HOT | Engaged advisor with ~15 clients; explicit "send me the signup link" |
| `warm_mfd` | WARM | Hindi-speaking MFD; asks for a comparison sheet on WhatsApp before deciding |
| `cold_busy` | COLD | Influencer who defers without a specific time |
| `dnd_hostile` | DND | "Remove my number" — triggers the internal-DND path, no WhatsApp sent |

## CSV column reference

| Column | Required | Notes |
| --- | --- | --- |
| `name` | Yes | Free-form. Used in WhatsApp templates and handoff display. |
| `phone` | Yes | Any format with digits + optional leading `+`. Deduped across uploads. |
| `language_pref` | No | One of `english`, `hindi`, `hinglish`, `other`. Defaults to `english`. |
| `source` | No | Free-form. Stored for analytics; not currently surfaced. |
| `scenario` | No | One of the 4 keys above. Defaults to `hot_advisor` if missing or unrecognised. |

## Cost note

Each lead = one real conversation = roughly 2 LLM turns + 1 classifier call + 1 embedding lookup (cached after first run). On Gemini's free tier, all three CSVs combined are well under daily quota.
