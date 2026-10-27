"""Behavioral safeguards for an existing-detail-only clarity pass.

CLARITY_TEST_BASELINE=1 exercises the previous conservative implementation,
proving that the soft-edge test detects the reported ineffective correction.
"""
import math
import os
import unittest
import numpy as np
if os.environ.get('CLARITY_TEST_BASELINE'):
    from fidelity_luma import enhance_luma
else:
    from clarity_v2_luma import enhance_luma


class ClarityConstraints(unittest.TestCase):
    def test_broad_soft_edge_has_visibly_greater_separation(self):
        # A source edge enlarged to 4K: broad shoulders, no invented texture.
        row=np.array([round(80+140*(1+math.erf((x-32)/5.657))/2) for x in range(65)],np.uint8)
        source=np.tile(row,(60,1));result=enhance_luma(source,4)
        before=int(source[20,36])-int(source[20,28])
        after=int(result[20,36])-int(result[20,28])
        self.assertGreaterEqual(after-before,8,'Broad existing edges need useful contrast recovery, not a one-code micro-change')

    def test_flat_fields_and_hard_step_are_bit_exact(self):
        for value in [0,16,80,128,235,255]:
            source=np.full((48,64),value,np.uint8)
            np.testing.assert_array_equal(enhance_luma(source,4),source)
        source=np.tile(np.array([40]*32+[200]*32,np.uint8),(48,1))
        np.testing.assert_array_equal(enhance_luma(source,4),source)

    def test_no_temporal_effect_changes_in_protected_sections(self):
        source=np.random.default_rng(41).integers(0,256,(48,64),dtype=np.uint8)
        for seconds in [0,.5,1,6,7,7.99]:
            np.testing.assert_array_equal(enhance_luma(source,seconds),source)
        np.testing.assert_array_equal(enhance_luma(source,4)[40:],source[40:])

    def test_change_is_bounded_and_source_not_modified(self):
        source=np.random.default_rng(42).integers(0,256,(48,64),dtype=np.uint8)
        saved=source.copy();result=enhance_luma(source,4)
        self.assertEqual(result.shape,source.shape);self.assertEqual(result.dtype,np.uint8)
        self.assertLessEqual(int(np.abs(result.astype(int)-source.astype(int)).max()),10)
        np.testing.assert_array_equal(source,saved)

    def test_no_new_extrema_or_clipped_samples(self):
        source=np.random.default_rng(43).integers(0,256,(48,64),dtype=np.uint8)
        result=enhance_luma(source,4)
        self.assertFalse(np.any((source>0)&(result==0)))
        self.assertFalse(np.any((source<255)&(result==255)))
        for y in range(3,38):
            for x in range(3,61):
                local=source[y-2:y+3,x-2:x+3]
                self.assertGreaterEqual(int(result[y,x]),int(local.min()))
                self.assertLessEqual(int(result[y,x]),int(local.max()))


if __name__=='__main__':unittest.main(verbosity=2)
