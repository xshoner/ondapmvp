"""답례큐 결과보고서 조립: docs/report/{gpt,claude}/*.md + images → HWPX.

hwpx 스킬의 geomto.py(장 배너형 보고서)를 쓰되, 결과보고서에 맞게 두 가지만 바꾼다.
  - 표지: 결재란 대신 사업명·기간·발주처·수행사 표, 다음 쪽에 목차
  - 그림: 쪽 높이를 넘지 않게 크기 제한, 그림 아래 번호·설명

사용: PYTHONUTF8=1 python docs/report/build/build_report.py <hwpx 스킬 폴더> <출력.hwpx>
"""
import math
import re
import sys
from pathlib import Path

SKILL = Path(sys.argv[1])
OUT = Path(sys.argv[2])
sys.path.insert(0, str(SKILL / "scripts"))
import geomto  # noqa: E402
from PIL import Image  # noqa: E402

REPORT = Path(__file__).resolve().parent.parent
IMG_SRC = REPORT / "images"
IMG_OUT = Path(__file__).resolve().parent / "img"
IMG_OUT.mkdir(exist_ok=True)

META = {
    "사업명": "답례큐 격식지수 등 상품추천엔진 및 관리자 총괄 시스템 구축",
    "기간": "2026. 10. 20. ~ 2026. 11. 30.",
    "발주처": "포춘크래프트",
    "수행사": "NALLIJAKU",
    "제출일": "2026. 11. 30.",
}

CAPTIONS = {}
for line in (REPORT / "REPORT-SPEC.md").read_text(encoding="utf-8").splitlines():
    m = re.match(r"\| (G-\d+) \| (.+?) \|", line)
    if m:
        CAPTIONS[m.group(1)] = m.group(2)

# (파일, 장 제목) — 순서가 곧 장 번호
CHAPTERS = [
    ("gpt/01-overview.md", "추진 개요"),
    ("claude/02-system.md", "시스템 구성"),
    ("claude/03-work.md", "세부 작업 내역"),
    ("claude/04-history.md", "개발·배포 이력"),
    ("gpt/05-features.md", "주요 기능 소개 및 사용법"),
    ("claude/06-quality.md", "품질 검증 및 운영 점검"),
    ("claude/07-operations.md", "운영 안내"),
    ("gpt/08-next.md", "향후 과제 및 제언"),
    ("gpt/09-glossary.md", "부록 A. 용어 풀이"),
    ("claude/10-appendix.md", "부록 B. 화면·주소 목록"),
]


# ── 그림: 휴대폰 긴 화면은 세로 띠로 잘라 나란히 놓는다 ───────────────────
def prepare_image(gid: str) -> Path:
    src = IMG_SRC / f"{gid}.png"
    out = IMG_OUT / f"{gid}.png"
    im = Image.open(src).convert("RGB")
    w, h = im.size
    n = min(3, math.ceil(h / (w * 2.2)))
    if n > 1:
        step = math.ceil(h / n)
        gap = 24
        sheet = Image.new("RGB", (w * n + gap * (n - 1), step), (255, 255, 255))
        for i in range(n):
            part = im.crop((0, i * step, w, min(h, (i + 1) * step)))
            sheet.paste(part, (i * (w + gap), 0))
        im = sheet
    w, h = im.size
    if h / w > MAX_RATIO:
        nw = math.ceil(h / MAX_RATIO)
        pad = Image.new("RGB", (nw, h), (255, 255, 255))
        pad.paste(im, ((nw - w) // 2, 0))
        im = pad
    im.save(out, optimize=True)
    return out


# 그림 크기: geomto 는 폭을 본문 폭에 맞추고 높이는 비율대로 둔다.
# 세로로 긴 그림은 양옆에 흰 여백을 붙여 높이가 쪽 안(약 150mm)에 들게 한다 (해상도는 그대로)
MAX_RATIO = 42500 / 48190



# ── 그림 크기 보정: 스킬의 pic()은 원본 크기·자르기 영역에도 표시 크기를 넣어
#    줄인 그림이 왼쪽 위만 보인다. 원본(px×75)을 기록해 원본 크기·자르기·배율을 바로잡는다
_last_px = {}
_orig_image_px = geomto.image_px


def image_px(p):
    r = _orig_image_px(p)
    _last_px["v"] = r
    return r


geomto.image_px = image_px
_orig_pic = geomto.pic


def pic(item_id, w, h, halign="LEFT"):
    x = _orig_pic(item_id, w, h, halign)
    pw, ph = _last_px["v"]
    ow, oh = pw * 75, ph * 75
    x = x.replace(f'<hp:imgClip left="0" right="{w}" top="0" bottom="{h}"/>', f'<hp:imgClip left="0" right="{ow}" top="0" bottom="{oh}"/>')
    x = x.replace(f'<hp:imgDim dimwidth="{w}" dimheight="{h}"/>', f'<hp:imgDim dimwidth="{ow}" dimheight="{oh}"/>')
    return x


geomto.pic = pic

# ── 표 칸 너비: 짧은 칸(날짜·상태 등)은 줄바꿈 없이 제 너비, 남는 폭을 긴 칸끼리 나눈다 ──
import yoyak  # noqa: E402


# 표 머리행 → 칸 비율 (글자 폭 추정 대신 표마다 정한다)
COL_RATIOS = {
    ("구분", "내용"): (22, 78),
    ("검증", "방법", "확인하는 것"): (14, 30, 56),
    ("구분", "구성 요소", "하는 일"): (14, 44, 42),
    ("날짜", "주요 배포 내용", "대표 기록"): (17, 63, 20),
    ("데이터", "내용"): (22, 78),
    ("때", "할 일", "화면"): (17, 63, 20),
    ("상황", "조치"): (30, 70),
    ("서비스", "용도", "비고"): (16, 38, 46),
    ("시점", "검증", "결과"): (17, 20, 63),
    ("위치", "하는 일", "관련 기능"): (16, 66, 18),
    ("작업", "내용", "상태"): (19, 60, 21),
    ("항목", "값", "비고"): (26, 20, 54),
    ("항목", "내용"): (20, 80),
    ("화면", "주소", "관련 기능"): (30, 52, 18),
}


def content_table(rows):
    Y = yoyak
    n_cols = max(len(r) for r in rows)
    rows = [r + [""] * (n_cols - len(r)) for r in rows]
    ch = 1300
    strip = lambda t: re.sub(r"[*+!_=]{2}", "", t)
    key = tuple(strip(c) for c in rows[0])
    ratios = COL_RATIOS.get(key)
    if ratios:
        widths = [round(geomto.BODY_W * r / sum(ratios)) for r in ratios]
    else:
        need = [max(Y.text_width(strip(r[c]), ch) + Y.CELL_M[0] + Y.CELL_M[1] for r in rows) for c in range(n_cols)]
        need = [max(x, 3000) for x in need]
        widths = [round(x * geomto.BODY_W / sum(need)) for x in need]
    widths[-1] += geomto.BODY_W - sum(widths)
    line_adv = round(ch * 1.1)
    trs, total_h = [], 0
    for ri, r in enumerate(rows):
        n_lines = max(max(1, -(-Y.text_width(strip(r[c]), ch) // max(1, widths[c] - Y.CELL_M[0] - Y.CELL_M[1])))
                      for c in range(n_cols))
        h = Y.CELL_M[2] + Y.CELL_M[3] + line_adv * n_lines + 400
        bf = Y.BF_TBL_HEAD if ri == 0 else Y.BF_TBL
        cp = Y.CP_TBL_B if ri == 0 else Y.CP_TBL
        tcs = [Y.cell(c, ri, widths[c], h, bf, [Y.para(Y.PP_CELL, Y.runs(r[c], cp, table=True))]) for c in range(n_cols)]
        trs.append(f'<hp:tr>{"".join(tcs)}</hp:tr>')
        total_h += h
    tbl = Y.table(trs, len(rows), n_cols, geomto.BODY_W, total_h, Y.BF_TBL)
    return Y.para(Y.PP_PLAIN, f'<hp:run charPrIDRef="{Y.CP_BODY}">{tbl}</hp:run>')


geomto.content_table = content_table

# 소제목(□·▣) 문단(paraPr 53)은 다음 문단과 같은 쪽에 — 표 앞에서 제목만 쪽 끝에 남지 않게
_orig_patched_header = yoyak.patched_header


def patched_header(*a, **k):
    h = _orig_patched_header(*a, **k)
    m = re.search(r'<hh:paraPr id="53".*?</hh:paraPr>', h, re.S)
    if m:
        h = h.replace(m.group(0), m.group(0).replace('keepWithNext="0"', 'keepWithNext="1"'))
    return h


yoyak.patched_header = patched_header


# ── 표지 + 목차 ──────────────────────────────────────────────────────────
def cover_page(meta, title, subtitle, lead):
    P = [geomto.spacer()] * 5
    P.append(geomto.title_box(title, subtitle, title_cp=geomto.CP_COVER_TITLE, sub_cp=geomto.CP_COVER_SUB))
    P += [geomto.spacer()] * 4
    rows = [["구분", "내용"], ["사업명", META["사업명"]], ["사업 기간", META["기간"]],
            ["발주처", META["발주처"]], ["수행사", META["수행사"]], ["제출일", META["제출일"]]]
    P.append(geomto.content_table(rows))
    P += [geomto.spacer()] * 8
    P.append(geomto.text_para(geomto.PP_ORG, geomto.CP_ORG_BIG, META["수행사"]))
    P.append(geomto.page_break())
    # 목차
    P.append(geomto.text_para(geomto.PP_TITLE, geomto.CP_ORG_SMALL, "목  차"))
    P += [geomto.spacer()] * 2
    P.append(geomto.text_para(geomto.PP_ITEM, geomto.CP_BODY, "  요약"))
    for i, (_, name) in enumerate(CHAPTERS, 1):
        P.append(geomto.text_para(geomto.PP_ITEM, geomto.CP_BODY, f"  {geomto.ROMAN[i - 1]}. {name}"))
    P.append(geomto.page_break())
    return P


geomto.cover_page = cover_page


# ── 원고 변환: 각 장 md → geomto 문법 ────────────────────────────────────
def clean(s: str) -> str:
    s = re.sub(r"\[(?:S|F)-[^\]]+\]\s*", "", s)  # 절 ID
    return s.replace("`", "")


def convert_chapter(path: Path, name: str, used: set) -> list[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    heads = [len(m.group(1)) for l in lines if (m := re.match(r"^(#+)\s", l))]
    top = min(heads) if heads else 1
    out = [f"## {name}"]
    prev = ""
    for raw in lines:
        l = raw.rstrip()
        m = re.match(r"^(#+)\s+(.*)", l)
        if m:
            depth = len(m.group(1)) - top
            if depth <= 0:
                continue  # 장 제목은 위에서 넣음
            text = clean(m.group(2))
            text = re.sub(r"^\d+\.\d+\s+", "", text)  # "5.1 고객 기능" → "고객 기능"
            out.append(f"**{'□' if depth == 1 else '▣'} {text}**")
            prev = "head"
            continue
        if not l.strip():
            out.append("")
            continue
        figs = re.findall(r"\[그림 (G-\d+)\]", l)
        rest = re.sub(r"\[그림 G-\d+\]", "", l).strip()
        if figs and rest in ("", "○ 화면:"):
            for g in figs:
                img = prepare_image(g)
                used.add(g)
                out.append(f"![{g}]({img.as_posix()})")
                out.append(f"@@CAPTION <그림 {g}> {CAPTIONS.get(g, '')}")
                out.append("@@SPACER")
            continue
        l = clean(l)
        if l.startswith("○ "):
            out.append("- " + l[2:])
            prev = "item"
        elif re.match(r"^- ", l):
            out.append("  - " + l[2:])
            prev = "sub"
        elif re.match(r"^  - ", l):
            out.append("  - " + l[4:])
        elif re.match(r"^\d+\.\s", l):
            out.append("    - " + l)
        else:
            out.append(l)
    return out


def build_markdown() -> str:
    used: set = set()
    summary = (REPORT / "gpt/00-summary.md").read_text(encoding="utf-8").splitlines()
    lead = [clean(l).replace("○ ", "❍ ", 1) for l in summary if l.startswith("○ ")]
    md = ["---", "표지: true", "줄간격: 160", "부제: - 격식지수 등 상품추천엔진 및 관리자 총괄 시스템 -", "---",
          "# 답례큐 시스템 구축 결과보고서"]
    md += ["> **[요약]**"] + [f"> {x}" for x in lead]
    md.append("")
    for i, (f, name) in enumerate(CHAPTERS):
        md.append("---")
        md += convert_chapter(REPORT / f, name, used)
        md.append("")
    missing = [g for g in CAPTIONS if g not in used]
    if missing:
        print("본문에 쓰이지 않은 그림:", missing)
    return "\n".join(md)


# 그림 설명 문단: geomto 파서에는 없는 줄이라 para 로 들어온 것을 가운데 작은 글씨로 바꾼다
_orig_text_para = geomto.text_para


def text_para(pp, cp, text):
    if text == "@@SPACER":
        return _orig_text_para(pp, cp, "")
    if text.startswith("@@CAPTION "):
        return _orig_text_para("54", "40", text[len("@@CAPTION "):])
    return _orig_text_para(pp, cp, text)


geomto.text_para = text_para

if __name__ == "__main__":
    md_text = build_markdown()
    md_path = Path(__file__).resolve().parent / "report.md"
    md_path.write_text(md_text, encoding="utf-8")
    geomto.generate(md_path, OUT)
    print("built", OUT)
