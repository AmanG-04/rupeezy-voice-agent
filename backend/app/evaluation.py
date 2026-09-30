"""Offline scoring of labeled classifier and retrieval outputs.

python -m app.evaluation --labels ../evaluation/cases.json --predictions results.json
No API calls. Missing predictions fail rather than inflate accuracy.
"""

import argparse
import json
from pathlib import Path


def evaluate(cases: list[dict], predictions: dict) -> dict:
    labels = ["hot", "warm", "cold"]
    matrix = {actual: {predicted: 0 for predicted in labels + ["missing"]} for actual in labels}
    languages = {}
    reciprocal_ranks = []
    recall = []
    opt_out_correct = 0
    for case in cases:
        predicted = predictions.get(case["id"], {})
        bucket = predicted.get("bucket", "missing")
        if bucket not in labels:
            bucket = "missing"
        matrix[case["bucket"]][bucket] += 1
        group = languages.setdefault(case["language"], {"correct": 0, "total": 0})
        group["total"] += 1
        group["correct"] += bucket == case["bucket"]
        opt_out_correct += predicted.get("opt_out") == case["opt_out"]
        expected = case.get("sections", [])
        if expected:
            retrieved = predicted.get("sections", [])[:3]
            rank = next((i + 1 for i, section in enumerate(retrieved) if section in expected), None)
            reciprocal_ranks.append(1 / rank if rank else 0)
            recall.append(int(rank is not None))
    scores = {}
    for label in labels:
        tp = matrix[label][label]
        fp = sum(matrix[other][label] for other in labels if other != label)
        fn = sum(matrix[label][other] for other in labels + ["missing"] if other != label)
        precision = tp / (tp + fp) if tp + fp else 0
        recall_value = tp / (tp + fn) if tp + fn else 0
        scores[label] = {"precision": precision, "recall": recall_value,
                         "f1": 2 * precision * recall_value / (precision + recall_value) if precision + recall_value else 0}
    return {"cases": len(cases), "prediction_count": sum(case["id"] in predictions for case in cases),
            "macro_f1": sum(s["f1"] for s in scores.values()) / 3,
            "per_bucket": scores, "confusion_matrix": matrix, "by_language": languages,
            "opt_out_accuracy": opt_out_correct / len(cases) if cases else 0,
            "retrieval_recall_at_3": sum(recall) / len(recall) if recall else None,
            "retrieval_mrr_at_3": sum(reciprocal_ranks) / len(reciprocal_ranks) if reciprocal_ranks else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--predictions", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(evaluate(json.loads(args.labels.read_text(encoding="utf-8")),
                              json.loads(args.predictions.read_text(encoding="utf-8"))), indent=2))


if __name__ == "__main__":
    main()
