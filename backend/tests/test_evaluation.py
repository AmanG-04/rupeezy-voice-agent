from app.evaluation import evaluate


def test_missing_predictions_count_as_errors():
    cases = [{"id": "one", "bucket": "hot", "language": "english", "opt_out": False}]
    report = evaluate(cases, {})
    assert report["macro_f1"] == 0
    assert report["confusion_matrix"]["hot"]["missing"] == 1
    assert report["opt_out_accuracy"] == 0


def test_retrieval_rank_and_macro_f1():
    cases = [{"id": label, "bucket": label, "language": "english", "opt_out": False,
              "sections": ["4.1"]} for label in ("hot", "warm", "cold")]
    predictions = {label: {"bucket": label, "opt_out": False, "sections": ["3", "4.1"]}
                   for label in ("hot", "warm", "cold")}
    report = evaluate(cases, predictions)
    assert report["macro_f1"] == 1
    assert report["retrieval_mrr_at_3"] == 0.5
    assert report["retrieval_recall_at_3"] == 1
