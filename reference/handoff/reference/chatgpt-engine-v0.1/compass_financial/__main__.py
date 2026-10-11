"""Usage: python -m compass_financial examples/wsu_camp.json"""
import json
import sys
from pathlib import Path
from .engine import calculate_project


def main() -> int:
    if len(sys.argv) != 2:
        print('Usage: python -m compass_financial SNAPSHOT.json', file=sys.stderr)
        return 2
    try:
        payload = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
        result = calculate_project(payload)
        print(json.dumps(result, indent=2))
    except (ValueError, OSError) as exc:
        print(f'Error: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
