"""Deterministic project JTD calculator based on discoveries 001-010.

Inputs are normalized snapshots, NOT raw Vantagepoint rows. Adapters own the
posted-ledger filtering, signs, WBS aggregation, billing classification, and
period selection. All arithmetic uses Decimal; no binary floating point.
"""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

CENT = Decimal('0.01')
HUNDRED = Decimal('100')


def dec(value: Any, field: str = 'value') -> Decimal:
    if isinstance(value, bool) or isinstance(value, float):
        raise ValueError(f'{field}: supply a decimal string or integer, never float/bool')
    if value is None:
        raise ValueError(f'{field}: value is required')
    try:
        result = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError(f'{field}: invalid decimal value') from exc
    if not result.is_finite():
        raise ValueError(f'{field}: non-finite decimal')
    return result


def money(value: Decimal) -> str:
    return str(value.quantize(CENT, rounding=ROUND_HALF_UP))


def percentage(numerator: Decimal, denominator: Decimal) -> str | None:
    return None if denominator == 0 else money(numerator / denominator * HUNDRED)


def _money_field(data: dict, field: str, default: str | None = None) -> Decimal | None:
    value = data.get(field, default)
    return None if value is None else dec(value, field)


def _amount(value: Decimal | None) -> str | None:
    return None if value is None else money(value)


def calculate_project(project: dict) -> dict:
    """Calculate an independently testable project JTD snapshot.

    Required: project_number, as_of_period, recognized_revenue, posted_labor,
    project_expenses, overhead_rate_pct. posted_labor must be a normalized
    LD-based amount, recognized_revenue a normalized LedgerAR IN-based amount,
    expenses a normalized combined expense-ledgers figure. For unposted labor,
    pass tkDetail's complete JTD amount as `labor_including_unposted` and set
    `include_unposted_labor` true. Never add tkDetail to LD.

    Fee components can all be omitted (unknown). Zero across all populated
    components is treated as unavailable for contract-utilization purposes.

    Billing detail accepts ONLY previously classified invoice-level buckets
    from an external adapter; classification is NOT inferred from Section.
    Unknown/unmapped sections must remain explicit. `jtd_total_billed` is an
    optional independently reconciled aggregate; if absent the sum of all
    invoice-level entries is used only when there are no unmapped entries.
    """
    number = project.get('project_number')
    if not isinstance(number, str) or not number.strip():
        raise ValueError('project_number: nonempty string required')
    period = project.get('as_of_period')
    if not isinstance(period, str) or len(period) != 6 or not period.isdigit() or not 1 <= int(period[4:]) <= 12:
        raise ValueError('as_of_period: expected YYYYMM')
    flags: list[str] = []
    revenue = dec(project.get('recognized_revenue'), 'recognized_revenue')
    labor_posted = dec(project.get('posted_labor'), 'posted_labor')
    expenses = dec(project.get('project_expenses'), 'project_expenses')
    overhead_pct = _money_field(project, 'overhead_rate_pct')
    if overhead_pct is not None and overhead_pct < 0:
        raise ValueError('overhead_rate_pct cannot be negative')
    if project.get('include_unposted_labor', False):
        labor = dec(project.get('labor_including_unposted'), 'labor_including_unposted')
        labor_basis = 'tkDetail_complete_JTD_including_unposted'
    else:
        labor = labor_posted
        labor_basis = 'LD_posted_JTD'
    override = _money_field(project, 'estimated_overhead_override')
    if override is not None:
        overhead = override
        overhead_basis = 'provided_report_reference_not_calculated'
        flags.append('OVERHEAD_REPORT_OVERRIDE_USED')
    elif overhead_pct is not None:
        overhead = labor * overhead_pct / HUNDRED
        overhead_basis = 'labor_times_explicit_project_rate'
    else:
        raise ValueError('overhead_rate_pct required unless estimated_overhead_override is provided')
    spent = labor + overhead + expenses
    profit = revenue - spent

    components = project.get('fee_components', {})
    if components is None:
        components = {}
    if not isinstance(components, dict):
        raise ValueError('fee_components must be an object')
    fee_keys = ('fee', 'consult_fee', 'reimb_allow')
    fee_values = [_money_field(components, k) for k in fee_keys]
    fee = None if all(v is None for v in fee_values) else sum((v or Decimal(0) for v in fee_values), Decimal(0))
    if fee is None or fee == 0:
        fee = None
        flags.append('PROJECT_FEE_UNAVAILABLE')
    elif fee < 0:
        flags.append('NEGATIVE_RECORDED_PROJECT_FEE')

    billing = project.get('billing_entries', [])
    if not isinstance(billing, list):
        raise ValueError('billing_entries must be an array')
    categories = {'fee': Decimal(0), 'reimb': Decimal(0), 'consultant': Decimal(0), 'other': Decimal(0)}
    unmapped = Decimal(0)
    for index, entry in enumerate(billing):
        if not isinstance(entry, dict):
            raise ValueError(f'billing_entries[{index}] must be an object')
        if entry.get('array_type') != 'I':
            raise ValueError(f'billing_entries[{index}]: array_type must equal I; do not mix phase allocations')
        amount = dec(entry.get('amount'), f'billing_entries[{index}].amount')
        category = entry.get('category')
        if category in categories:
            categories[category] += amount
        elif category == 'unmapped':
            unmapped += amount
        else:
            raise ValueError(f'billing_entries[{index}]: invalid classification {category!r}')
    if any(e.get('category') == 'unmapped' for e in billing):
        flags.append('BILLING_CLASSIFICATION_INCOMPLETE')
    billed_from_entries = sum(categories.values(), Decimal(0)) + unmapped if billing else None
    explicitly_billed = _money_field(project, 'jtd_total_billed')
    if explicitly_billed is not None and billed_from_entries is not None and explicitly_billed != billed_from_entries:
        flags.append('BILLING_RECONCILIATION_MISMATCH')
    if explicitly_billed is not None:
        billed = explicitly_billed
        billed_basis = 'provided_reconciled_invoice_total'
    elif billed_from_entries is not None and 'BILLING_CLASSIFICATION_INCOMPLETE' not in flags:
        billed = billed_from_entries
        billed_basis = 'classified_invoice_level_entries'
    else:
        billed = None
        billed_basis = 'unavailable'
    if billed is None:
        flags.append('JTD_BILLED_UNAVAILABLE')
    if billed is not None and revenue != billed:
        flags.append('RECOGNIZED_REVENUE_DIFFERS_FROM_BILLING')

    remaining = fee - billed if fee is not None and billed is not None else None
    if remaining is not None and remaining < 0:
        flags.append('BILLING_EXCEEDS_RECORDED_PROJECT_FEE')
    if fee is not None and billed is not None and fee < 0:
        flags.append('FEE_UTILIZATION_NOT_MEANINGFUL')
    utilization = percentage(billed, fee) if fee is not None and fee > 0 and billed is not None else None
    margin = percentage(profit, revenue)
    if revenue == 0:
        flags.append('PROFIT_MARGIN_UNDEFINED_ZERO_REVENUE')

    return {
        'project_number': number, 'project_name': project.get('project_name'),
        'as_of_period': period, 'include_unposted_labor': bool(project.get('include_unposted_labor', False)),
        'labor_basis': labor_basis, 'overhead_rate_source': project.get('overhead_rate_source', 'explicit_input_unverified'),
        'jtd': {
            'recognized_revenue': money(revenue), 'labor_cost': money(labor),
            'estimated_overhead': money(overhead), 'project_expenses': money(expenses),
            'total_spent': money(spent), 'profit': money(profit), 'profit_margin_pct': margin,
            'overhead_rate_pct': _amount(overhead_pct), 'overhead_basis': overhead_basis,
            'recorded_project_fee': _amount(fee),
            'jtd_total_billed': _amount(billed), 'jtd_billed_basis': billed_basis,
            'remaining_recorded_fee': _amount(remaining), 'fee_utilization_pct': utilization,
            'billing_breakdown': {**{k: money(v) for k, v in categories.items()}, 'unmapped': money(unmapped)},
            'billing_entries_total': _amount(billed_from_entries),
        },
        'flags': flags,
        'definitions_version': 'discovery-010-v1',
    }


def calculate_portfolio(projects: list[dict]) -> dict:
    """Calculate individual projects; no unsupported portfolio contract aggregates."""
    outputs = [calculate_project(p) for p in projects]
    seen = set()
    for output in outputs:
        identity = (output['project_number'], output['as_of_period'], output['include_unposted_labor'])
        if identity in seen:
            raise ValueError(f'duplicate project snapshot: {identity!r}')
        seen.add(identity)
    totals = {k: sum((dec(p['jtd'][k]) for p in outputs), Decimal(0)) for k in
              ('recognized_revenue', 'labor_cost', 'estimated_overhead', 'project_expenses', 'total_spent', 'profit')}
    if len({(p['as_of_period'], p['include_unposted_labor']) for p in outputs}) > 1:
        raise ValueError('portfolio aggregation requires a common as-of period and labor inclusion basis')
    return {'projects': outputs, 'aggregate_jtd': {k: money(v) for k, v in totals.items()},
            'aggregate_profit_margin_pct': percentage(totals['profit'], totals['recognized_revenue']),
            'project_count': len(outputs)}
