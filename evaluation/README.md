# Evaluation workbench

The initial 24 authored English/Hinglish cases cover qualification, explicit opt-outs, information requests, and six retrieval questions. These are a development set, not a validated benchmark. Review the labels and add a separate held-out set before reporting results on a resume.

Ordinary tests and the scoring command make no network requests. There are no fabricated baseline results.

Predictions are a JSON object keyed by case ID:

```json
{
  "en-signup": {"bucket": "hot", "opt_out": false, "sections": []}
}
```

From `backend/`:

```powershell
python -m app.evaluation --labels ../evaluation/cases.json --predictions ../evaluation/results.json
```

Missing predictions count as errors. The report includes macro-F1, a confusion matrix, per-language counts, opt-out accuracy, Recall@3, and MRR@3. Store predictions with the model ID, prompt revision, and date when comparing runs. Use human review for correctness and unsupported claims; classifier accuracy alone does not evaluate conversation quality.

Live provider tests are explicit opt-in: `pytest --live tests/test_agent.py tests/test_retrieval.py`. They consume API quota and may fail due to service limits. Obtain permission before running them.

For an isolated live English/Hinglish conversation and structured-classification smoke check, run `pytest --live tests/test_live_pipeline.py -s`. It verifies custom business facts, language switching, AI disclosure, and three qualification examples. It uses a temporary application database; the knowledge cache is reused. This is smoke coverage, not a benchmark.
