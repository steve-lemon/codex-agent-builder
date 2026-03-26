from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os

out_path = "output/pdf/app_summary_ko.pdf"
os.makedirs(os.path.dirname(out_path), exist_ok=True)

# Try to register a Korean-capable font available on macOS.
font_candidates = [
    ("AppleSDGothicNeo", "/System/Library/Fonts/AppleSDGothicNeo.ttc"),
    ("ArialUnicodeMS", "/Library/Fonts/Arial Unicode.ttf"),
    ("NanumGothic", "/Library/Fonts/NanumGothic.ttf"),
]
font_name = "Helvetica"
for name, path in font_candidates:
    if os.path.exists(path):
        try:
            pdfmetrics.registerFont(TTFont(name, path))
            font_name = name
            break
        except Exception:
            pass

c = canvas.Canvas(out_path, pagesize=A4)
width, height = A4

left = 18 * mm
right = width - 18 * mm
y = height - 18 * mm
line_gap = 5.2 * mm


def draw_title(text):
    global y
    c.setFont(font_name, 18)
    c.drawString(left, y, text)
    y -= 8 * mm


def draw_heading(text):
    global y
    c.setFont(font_name, 12)
    c.drawString(left, y, text)
    y -= 5 * mm


def draw_lines(lines, bullet=False):
    global y
    c.setFont(font_name, 10)
    for line in lines:
        prefix = "- " if bullet else ""
        c.drawString(left + (3 * mm if bullet else 0), y, f"{prefix}{line}")
        y -= line_gap


def section(title, lines, bullet=False):
    global y
    draw_heading(title)
    draw_lines(lines, bullet=bullet)
    y -= 2 * mm


draw_title("앱 요약 (저장소 근거 기반)")

section("1) What it is", [
    "저장소에 앱 설명(README, docs, manifest)이 없어 앱 정체를 확인할 수 없습니다.",
    "Not found in repo.",
])

section("2) Who it's for", [
    "주 사용자/페르소나를 특정할 수 있는 근거 파일이 없습니다.",
    "Not found in repo.",
])

section("3) What it does (Key Features)", [
    "앱 기능 목록을 뒷받침할 코드/문서가 저장소에서 발견되지 않았습니다.",
    "Not found in repo.",
    "Not found in repo.",
    "Not found in repo.",
    "Not found in repo.",
    "Not found in repo.",
], bullet=True)

section("4) How it works (Architecture)", [
    "근거: /Users/dujung/Documents/Codex 디렉터리가 비어 있음(ls -la 결과 파일 없음).",
    "컴포넌트/서비스/데이터 흐름을 도출할 소스 코드가 없어 아키텍처를 특정할 수 없습니다.",
    "Not found in repo.",
])

section("5) How to run (Getting Started)", [
    "실행 절차(의존성, 실행 명령, 환경변수, 엔트리포인트) 정보가 저장소에 없습니다.",
    "Not found in repo.",
])

# Footer
c.setFont(font_name, 8)
c.drawRightString(right, 10 * mm, "Generated from repository evidence only")

c.save()
print(out_path)
