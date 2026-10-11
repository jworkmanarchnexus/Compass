import json
import unittest
from copy import deepcopy
from pathlib import Path

from compass_financial.engine import calculate_project, calculate_portfolio

ROOT = Path(__file__).resolve().parents[1]


def example(filename):
    return json.loads((ROOT / 'examples' / filename).read_text(encoding='utf-8'))


class FinancialEngineTests(unittest.TestCase):
    def test_wsu_unposted_reconciles_exact(self):
        r = calculate_project(example('wsu_camp.json'))['jtd']
        self.assertEqual(r['recorded_project_fee'], '570286.00')
        self.assertEqual(r['labor_cost'], '71287.91')
        self.assertEqual(r['estimated_overhead'], '142575.82')
        self.assertEqual(r['total_spent'], '455035.66')
        self.assertEqual(r['profit'], '56158.19')
        self.assertEqual(r['profit_margin_pct'], '10.99')
        self.assertEqual(r['remaining_recorded_fee'], '59092.15')

    def test_wsu_posted_and_unposted_do_not_stack(self):
        p = example('wsu_camp.json')
        p['include_unposted_labor'] = False
        r = calculate_project(p)['jtd']
        self.assertEqual(r['labor_cost'], '70923.51')
        self.assertEqual(r['estimated_overhead'], '141847.02')
        self.assertEqual(r['total_spent'], '453942.46')

    def test_stockton_fee_billing_and_report_reference(self):
        result = calculate_project(example('stockton_library.json'))
        r = result['jtd']
        self.assertEqual(r['recorded_project_fee'], '2611647.50')
        self.assertEqual(r['billing_breakdown']['fee'], '2125182.10')
        self.assertEqual(r['billing_breakdown']['reimb'], '155526.91')
        self.assertEqual(r['jtd_total_billed'], '2280709.01')
        self.assertEqual(r['remaining_recorded_fee'], '330938.49')
        self.assertEqual(r['total_spent'], '2373701.41')
        self.assertEqual(r['profit'], '-92992.40')
        self.assertEqual(r['profit_margin_pct'], '-4.08')
        self.assertIn('OVERHEAD_REPORT_OVERRIDE_USED', result['flags'])

    def test_epic_adjustment_and_fee(self):
        r = calculate_project(example('epic_fee_billing.json'))['jtd']
        self.assertEqual(r['recorded_project_fee'], '3374968.00')
        self.assertEqual(r['billing_breakdown']['fee'], '2238658.28')
        self.assertEqual(r['billing_breakdown']['reimb'], '942197.76')
        self.assertEqual(r['jtd_total_billed'], '3180856.04')
        self.assertEqual(r['remaining_recorded_fee'], '194111.96')
        self.assertEqual(r['total_spent'], '2973002.02')
        self.assertEqual(r['profit'], '207854.02')

    def test_fee_unavailable_is_not_negative_balance(self):
        p = example('wsu_camp.json'); p['fee_components'] = {'fee': '0', 'consult_fee': '0', 'reimb_allow': '0'}
        result = calculate_project(p)
        self.assertIsNone(result['jtd']['recorded_project_fee'])
        self.assertIsNone(result['jtd']['remaining_recorded_fee'])
        self.assertIsNone(result['jtd']['fee_utilization_pct'])
        self.assertIn('PROJECT_FEE_UNAVAILABLE', result['flags'])

    def test_unmapped_entries_not_guessed(self):
        p = example('wsu_camp.json'); p.pop('jtd_total_billed')
        p['billing_entries'].append({'array_type': 'I', 'section': 'A', 'subsection': '', 'category': 'unmapped', 'amount': '-100'})
        r = calculate_project(p)
        self.assertIsNone(r['jtd']['jtd_total_billed'])
        self.assertIn('BILLING_CLASSIFICATION_INCOMPLETE', r['flags'])

    def test_explicit_total_retained_but_mismatch_flagged(self):
        p = example('wsu_camp.json'); p['jtd_total_billed'] = '511194.85'
        r = calculate_project(p)
        self.assertIn('BILLING_RECONCILIATION_MISMATCH', r['flags'])
        self.assertIn('RECOGNIZED_REVENUE_DIFFERS_FROM_BILLING', r['flags'])

    def test_no_binary_floats(self):
        p = example('wsu_camp.json'); p['recognized_revenue'] = 12.3
        with self.assertRaisesRegex(ValueError, 'never float'):
            calculate_project(p)

    def test_phase_allocations_rejected(self):
        p = example('wsu_camp.json'); p['billing_entries'][0]['array_type'] = 'P'
        with self.assertRaisesRegex(ValueError, 'must equal I'):
            calculate_project(p)

    def test_zero_revenue_margin_null(self):
        p = example('wsu_camp.json'); p['recognized_revenue'] = '0'; p.pop('jtd_total_billed'); p['billing_entries'] = []
        r = calculate_project(p)
        self.assertIsNone(r['jtd']['profit_margin_pct'])
        self.assertIn('PROFIT_MARGIN_UNDEFINED_ZERO_REVENUE', r['flags'])

    def test_portfolio_duplicate_and_mixed_basis_rejected(self):
        p = example('wsu_camp.json')
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            calculate_portfolio([p, deepcopy(p)])
        p2 = deepcopy(p); p2['project_number'] = 'DIFFERENT'; p2['include_unposted_labor'] = False
        with self.assertRaisesRegex(ValueError, 'common as-of'):
            calculate_portfolio([p, p2])

    def test_portfolio_revenue_weighted_margin(self):
        p = example('wsu_camp.json'); q = deepcopy(p); q['project_number'] = 'SECOND_PROJECT'
        r = calculate_portfolio([p, q])
        self.assertEqual(r['project_count'], 2)
        self.assertEqual(r['aggregate_jtd']['recognized_revenue'], '1022387.70')
        self.assertEqual(r['aggregate_jtd']['profit'], '112316.38')


if __name__ == '__main__':
    unittest.main()
