import unittest

import numpy as np

from hqsam2_worker import predict_best_mask, valid_candidate


class FakePredictor:
    def __init__(self):
        self.calls = 0

    def predict(self, **_kwargs):
        self.calls += 1
        masks = np.zeros((3, 10, 10), dtype=bool)
        masks[:, 3:7, 3:7] = True
        score = 0.41 if self.calls == 1 else 0.95
        return masks, np.asarray([score, score - 0.1, score - 0.2]), None


class HqSam2RetryTests(unittest.TestCase):
    def test_retries_a_low_score_with_positive_points(self):
        predictor = FakePredictor()
        mask, score, attempts = predict_best_mask(predictor, np.asarray([2, 2, 8, 8], dtype=np.float32))
        self.assertTrue(mask[5, 5])
        self.assertEqual(score, 0.95)
        self.assertEqual(attempts, 2)

    def test_rejects_a_mask_that_spreads_far_outside_the_box(self):
        mask = np.ones((20, 20), dtype=bool)
        self.assertFalse(valid_candidate(mask, np.asarray([8, 8, 12, 12], dtype=np.float32)))


if __name__ == "__main__":
    unittest.main()
