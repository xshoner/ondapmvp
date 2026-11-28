#!/bin/sh
# 사용: sh docs/report/build/make.sh <hwpx 스킬 폴더>   → docs/report/out/답례큐_결과보고서.hwpx
set -e
SK="$1"; F="docs/report/out/답례큐_결과보고서.hwpx"
export PYTHONUTF8=1
mkdir -p docs/report/out
python docs/report/build/build_report.py "$SK" "$F"
python "$SK/scripts/fix_namespaces.py" "$F" >/dev/null
python "$SK/scripts/finalize_hwpx.py" "$F" --strip-linesegarray --layout >/dev/null || true
python "$SK/scripts/validate.py" "$F" --layout | head -2
python "$SK/scripts/fill_hwpx.py" check "$F" --strict >/dev/null && echo "strict check OK"
