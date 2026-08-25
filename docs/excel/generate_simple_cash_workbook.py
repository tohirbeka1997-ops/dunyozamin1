#!/usr/bin/env python3
"""
Generate a minimal daily cash + IOU tracking workbook for shop owners.
Sheets: Parametrlar, Xarajatlar, Tovarga pul, Kunlik kassa, Oldi-berdi,
        Hisob balans, Oylik xulosa.

Excel 2016/2019 compatible: INDEX/MATCH, SUMIF/SUMIFS, IF — no XLOOKUP/FILTER/LAMBDA.
"""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.page import PageMargins
from openpyxl.worksheet.table import Table, TableStyleInfo

OUT = Path(__file__).resolve().parent / "Kunlik_Kassa_Oldi_Berdi.xlsx"
OUT_FALLBACK = OUT.parent / "Kunlik_Kassa_Oldi_Berdi_generated.xlsx"
OUT_ALT = OUT.parent / "Kunlik_Kassa_Oldi_Berdi_regenerated.xlsx"
OUT_FIXED = OUT.parent / "Kunlik_Kassa_Oldi_Berdi_fixed.xlsx"
OUT_UI = OUT.parent / "Kunlik_Kassa_Oldi_Berdi_ui.xlsx"

# Hyphenated sheet name MUST be single-quoted in refs, else Excel parses "Oldi - berdi" → #NAME?
OLDI_BERDI_SHEET = "Oldi-berdi"
OLDI_BERDI_REF = f"'{OLDI_BERDI_SHEET}'"

# --- Visual system (shop cash book: dark teal, warm yellow, sage — not purple) ---
NAVY = "1B3A4B"
TEAL_SOFT = "E8F0F4"
YELLOW = "FFF3CD"
YELLOW_KOD = "FCE7A8"
SAGE = "D8E8D8"
SAGE_DEEP = "C5DCC5"
SAMPLE_TAG = "F5F5F0"
MUTED = "6B7C85"
LINE = "C5CED4"
WHITE = "FFFFFF"

HEADER_FILL = PatternFill("solid", fgColor=NAVY)
HEADER_FONT = Font(name="Calibri", bold=True, color=WHITE, size=11)
TITLE_FONT = Font(name="Calibri", bold=True, size=16, color=NAVY)
SECTION_FONT = Font(name="Calibri", bold=True, size=12, color=NAVY)
SUBTITLE_FONT = Font(name="Calibri", size=10, color=MUTED, italic=True)
BODY_FONT = Font(name="Calibri", size=11, color="1A1A1A")
KPI_LABEL_FONT = Font(name="Calibri", bold=True, size=11, color=NAVY)
SAMPLE_FONT = Font(name="Calibri", size=9, color=MUTED, italic=True)

INPUT_FILL = PatternFill("solid", fgColor=YELLOW)
KOD_FILL = PatternFill("solid", fgColor=YELLOW_KOD)
FORMULA_FILL = PatternFill("solid", fgColor=SAGE)
KPI_FILL = PatternFill("solid", fgColor=SAGE_DEEP)
SECTION_FILL = PatternFill("solid", fgColor=TEAL_SOFT)
SAMPLE_FILL = PatternFill("solid", fgColor=SAMPLE_TAG)
TITLE_BAR = PatternFill("solid", fgColor=NAVY)

THIN = Border(
    left=Side(style="thin", color=LINE),
    right=Side(style="thin", color=LINE),
    top=Side(style="thin", color=LINE),
    bottom=Side(style="thin", color=LINE),
)
MONEY_FMT = '#,##0'
DATE_FMT = "DD.MM.YYYY"

DATA_START = 5
DATA_END = 104

# Parametrlar layout
PEOPLE_HDR = 12
PEOPLE_START = 13
PEOPLE_END = 22
XAR_HDR = 26
XAR_START = 27
XAR_END = 36
SUP_HDR = 40
SUP_START = 41
SUP_END = 50

PEOPLE_KOD_REF = f"Parametrlar!$A${PEOPLE_START}:$A${PEOPLE_END}"
PEOPLE_ISM_REF = f"Parametrlar!$B${PEOPLE_START}:$B${PEOPLE_END}"
XAR_KOD_REF = f"Parametrlar!$A${XAR_START}:$A${XAR_END}"
XAR_NOMI_REF = f"Parametrlar!$B${XAR_START}:$B${XAR_END}"
SUP_KOD_REF = f"Parametrlar!$A${SUP_START}:$A${SUP_END}"
SUP_ISM_REF = f"Parametrlar!$B${SUP_START}:$B${SUP_END}"

# Filled by write_oldi_berdi for dashboard debt formulas (quoted sheet refs).
_DEBT_RECV_CELL = f"{OLDI_BERDI_REF}!$C$114"
_DEBT_PAY_CELL = f"{OLDI_BERDI_REF}!$C$115"


def kod_lookup_formula(kod_cell: str, kod_range: str, name_range: str) -> str:
    """Kod → ism (Excel 2016+: INDEX/MATCH only)."""
    return (
        f'=IF({kod_cell}="","",'
        f'IFERROR(INDEX({name_range},MATCH({kod_cell},{kod_range},0)),"?"))'
    )


def month_date_criteria() -> tuple[str, str]:
    """SUMIFS month bounds — DATE() must sit outside the quoted operator."""
    return (
        '">="&DATE(ReportYear,ReportMonth,1)',
        '"<"&DATE(ReportYear,ReportMonth+1,1)',
    )


def style_header(ws, row: int, cols: int):
    for c in range(1, cols + 1):
        cell = ws.cell(row, c)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(wrap_text=True, horizontal="center", vertical="center")
        cell.border = THIN
    ws.row_dimensions[row].height = 32


def set_title_block(ws, title: str, subtitle: str, merge_cols: str = "A1:F1"):
    ws.merge_cells(merge_cols)
    ws["A1"] = title
    ws["A1"].font = Font(name="Calibri", bold=True, size=16, color=WHITE)
    ws["A1"].fill = TITLE_BAR
    ws["A1"].alignment = Alignment(vertical="center", horizontal="left", indent=1)
    ws.row_dimensions[1].height = 28
    # subtitle under title bar
    sub_merge = merge_cols.replace("1", "2")
    ws.merge_cells(sub_merge)
    ws["A2"] = subtitle
    ws["A2"].font = SUBTITLE_FONT
    ws["A2"].alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[2].height = 36


def sheet_chrome(ws, freeze: str | None = "A5"):
    ws.sheet_view.showGridLines = False
    ws.sheet_view.zoomScale = 100
    ws.page_margins = PageMargins(left=0.5, right=0.5, top=0.6, bottom=0.6)
    ws.print_title_rows = "4:4"
    if freeze:
        ws.freeze_panes = freeze


def set_widths(ws, widths: dict[str, float]):
    for letter, w in widths.items():
        ws.column_dimensions[letter].width = w


def add_table(ws, name: str, ref: str):
    tab = Table(displayName=name, ref=ref)
    tab.tableStyleInfo = TableStyleInfo(
        name="TableStyleMedium2",
        showFirstColumn=False,
        showLastColumn=False,
        showRowStripes=True,
    )
    ws.add_table(tab)


def mark_entry_row(ws, row: int, cols: int, formula_cols: set[int], kod_cols: set[int] | None = None):
    kod_cols = kod_cols or set()
    for c in range(1, cols + 1):
        cell = ws.cell(row, c)
        cell.border = THIN
        cell.font = BODY_FONT
        if c in formula_cols:
            cell.fill = FORMULA_FILL
        elif c in kod_cols:
            cell.fill = KOD_FILL
            cell.alignment = Alignment(horizontal="center")
        else:
            cell.fill = INPUT_FILL


def tag_sample(ws, row: int, col: int, text: str = "Namuna"):
    cell = ws.cell(row, col, text)
    cell.font = SAMPLE_FONT
    cell.fill = SAMPLE_FILL
    cell.border = THIN
    cell.alignment = Alignment(horizontal="center")


def auto_date_formula(trigger_parts: list[str]) -> str:
    cond = ",".join(trigger_parts)
    return f'=IF(OR({cond}),TODAY(),"")'


def write_params(wb: Workbook):
    ws = wb.create_sheet("Parametrlar", 0)
    set_title_block(
        ws,
        "Parametrlar",
        "Sariq — qo'lda yozing. Yashil — avtomatik. Qisqa KOD (SH, SV…) → to'liq ism boshqa varag'larda chiqadi.",
        "A1:C1",
    )
    sheet_chrome(ws, "A5")

    for i, h in enumerate(["Parametr", "Qiymat", "Izoh"], 1):
        ws.cell(4, i, h)
    style_header(ws, 4, 3)

    rows = [
        ("Do'kon nomi", "Namuna Do'kon", "Sarlavhalar uchun"),
        ("Boshlang'ich kassa (so'm)", 500000, "Oy boshidagi kassa qoldiq"),
        ("Hisobot oyi", 8, "1–12 (Oylik xulosa)"),
        ("Hisobot yili", 2026, "Masalan: 2026"),
    ]
    for r, (label, val, note) in enumerate(rows, 5):
        ws.cell(r, 1, label).font = BODY_FONT
        ws.cell(r, 1).border = THIN
        ws.cell(r, 1).fill = SECTION_FILL
        c = ws.cell(r, 2, val)
        c.fill = INPUT_FILL
        c.border = THIN
        c.font = BODY_FONT
        if r == 6:
            c.number_format = MONEY_FMT
        ws.cell(r, 3, note).font = SUBTITLE_FONT
        ws.cell(r, 3).border = THIN

    # --- Odamlar ---
    ws.cell(11, 1, "1. Odamlar (oldi-berdi kodlari)").font = SECTION_FONT
    for i, h in enumerate(["Kod", "Ism", "Izoh"], 1):
        ws.cell(PEOPLE_HDR, i, h)
    style_header(ws, PEOPLE_HDR, 3)
    people = [
        ("SH", "sharobidin aka", "Do'st / hamkor"),
        ("JA", "jasur aka", "Yetkazuvchi"),
        ("SI", "siroch aka", "Qo'shni"),
    ]
    for r in range(PEOPLE_START, PEOPLE_END + 1):
        for c in range(1, 4):
            ws.cell(r, c).fill = INPUT_FILL
            ws.cell(r, c).border = THIN
            ws.cell(r, c).font = BODY_FONT
        ws.cell(r, 1).fill = KOD_FILL
        ws.cell(r, 1).alignment = Alignment(horizontal="center")
    for r, (kod, ism, izoh) in enumerate(people, PEOPLE_START):
        ws.cell(r, 1, kod)
        ws.cell(r, 2, ism)
        ws.cell(r, 3, izoh)
    add_table(ws, "tblOdamlar", f"A{PEOPLE_HDR}:C{PEOPLE_END}")

    # --- Xarajat turlari ---
    ws.cell(25, 1, "2. Xarajat turlari").font = SECTION_FONT
    for i, h in enumerate(["Kod", "Nomi"], 1):
        ws.cell(XAR_HDR, i, h)
    style_header(ws, XAR_HDR, 2)
    xarajat_turlari = [
        ("SV", "svet"),
        ("AB", "abet"),
        ("IJ", "ijara"),
        ("MS", "maosh"),
        ("TR", "transport"),
        ("BOSHQA", "boshqa"),
    ]
    for r in range(XAR_START, XAR_END + 1):
        for c in range(1, 3):
            ws.cell(r, c).fill = INPUT_FILL
            ws.cell(r, c).border = THIN
            ws.cell(r, c).font = BODY_FONT
        ws.cell(r, 1).fill = KOD_FILL
        ws.cell(r, 1).alignment = Alignment(horizontal="center")
    for r, (kod, nomi) in enumerate(xarajat_turlari, XAR_START):
        ws.cell(r, 1, kod)
        ws.cell(r, 2, nomi)
    add_table(ws, "tblXarajatTurlari", f"A{XAR_HDR}:B{XAR_END}")

    # --- Yetkazuvchilar ---
    ws.cell(39, 1, "3. Yetkazuvchilar / tovar manba").font = SECTION_FONT
    for i, h in enumerate(["Kod", "Ism"], 1):
        ws.cell(SUP_HDR, i, h)
    style_header(ws, SUP_HDR, 2)
    suppliers = [
        ("JA", "jasur aka"),
        ("SH", "sharobidin aka"),
        ("BAZAR", "bazar"),
        ("OPT", "optom yetkazuvchi"),
    ]
    for r in range(SUP_START, SUP_END + 1):
        for c in range(1, 3):
            ws.cell(r, c).fill = INPUT_FILL
            ws.cell(r, c).border = THIN
            ws.cell(r, c).font = BODY_FONT
        ws.cell(r, 1).fill = KOD_FILL
        ws.cell(r, 1).alignment = Alignment(horizontal="center")
    for r, (kod, ism) in enumerate(suppliers, SUP_START):
        ws.cell(r, 1, kod)
        ws.cell(r, 2, ism)
    add_table(ws, "tblYetkazuvchilar", f"A{SUP_HDR}:B{SUP_END}")

    ws.cell(52, 1, "Namuna hisob (avgust 2026)").font = SECTION_FONT
    ws.cell(
        53,
        1,
        "Boshlang'ich 500 000 + kirdi 3 680 000 − chiqim 1 295 000 = oy oxiri kassa 2 885 000. "
        "Bizga qarz: SH 200 000 + SI 50 000 = 250 000. Bizdan qarz: JA 150 000. "
        "Eski faylda 750 000 — 3-avgust kunlik chiqim/farq yoki 500k+250k qarz; bu kassa qoldiq emas.",
    ).font = SUBTITLE_FONT
    ws.merge_cells("A53:C55")
    ws["A53"].alignment = Alignment(wrap_text=True, vertical="top")

    wb.defined_names.add(DefinedName(name="StoreName", attr_text="Parametrlar!$B$5"))
    wb.defined_names.add(DefinedName(name="StartCash", attr_text="Parametrlar!$B$6"))
    wb.defined_names.add(DefinedName(name="ReportMonth", attr_text="Parametrlar!$B$7"))
    wb.defined_names.add(DefinedName(name="ReportYear", attr_text="Parametrlar!$B$8"))
    wb.defined_names.add(DefinedName(name="OdamlarKod", attr_text=PEOPLE_KOD_REF))
    wb.defined_names.add(DefinedName(name="OdamlarIsm", attr_text=PEOPLE_ISM_REF))
    wb.defined_names.add(DefinedName(name="XarajatKod", attr_text=XAR_KOD_REF))
    wb.defined_names.add(DefinedName(name="XarajatNomi", attr_text=XAR_NOMI_REF))
    wb.defined_names.add(DefinedName(name="YetkazuvchiKod", attr_text=SUP_KOD_REF))
    wb.defined_names.add(DefinedName(name="YetkazuvchiIsm", attr_text=SUP_ISM_REF))

    set_widths(ws, {"A": 30, "B": 22, "C": 44})


def write_xarajatlar(wb: Workbook):
    ws = wb.create_sheet("Xarajatlar")
    # Input-first: Kod, Summa, Izoh | auto: Sana, Tur | tag
    set_title_block(
        ws,
        "Xarajatlar",
        "Faqat Kod + Summa yozing (masalan SV va 45000). Sana va tur nomi avtomatik.",
        "A1:F1",
    )
    sheet_chrome(ws)

    headers = ["Kod", "Summa", "Izoh", "Sana", "Tur", "Belgi"]
    for i, h in enumerate(headers, 1):
        ws.cell(4, i, h)
    style_header(ws, 4, len(headers))

    formula_cols = {4, 5}
    kod_cols = {1}
    base = date(2026, 8, 1)
    sample = [
        ("SV", 45000, "Elektr to'lovi", base),
        ("AB", 35000, "Tushlik", base),
        ("IJ", 500000, "Ijara", base + timedelta(days=1)),
    ]

    for r, (kod, summa, izoh, sana) in enumerate(sample, DATA_START):
        ws.cell(r, 1, kod)
        ws.cell(r, 2, summa).number_format = MONEY_FMT
        ws.cell(r, 3, izoh)
        ws.cell(r, 4, sana).number_format = DATE_FMT
        ws.cell(r, 5, kod_lookup_formula(f"A{r}", "XarajatKod", "XarajatNomi"))
        mark_entry_row(ws, r, len(headers), formula_cols, kod_cols)
        tag_sample(ws, r, 6)

    for r in range(DATA_START + len(sample), DATA_END + 1):
        ws.cell(r, 4, auto_date_formula([f'A{r}<>""', f"B{r}>0"])).number_format = DATE_FMT
        ws.cell(r, 5, kod_lookup_formula(f"A{r}", "XarajatKod", "XarajatNomi"))
        mark_entry_row(ws, r, len(headers), formula_cols, kod_cols)
        ws.cell(r, 2).number_format = MONEY_FMT

    add_table(ws, "tblXarajatlar", f"A4:F{DATA_END}")
    set_widths(ws, {"A": 10, "B": 14, "C": 22, "D": 12, "E": 14, "F": 10})


def write_tovarga_pul(wb: Workbook):
    ws = wb.create_sheet("Tovarga pul")
    set_title_block(
        ws,
        "Tovarga pul",
        "Yetkazuvchi Kod + Summa (masalan JA va 450000). Sana va ism avtomatik.",
        "A1:F1",
    )
    sheet_chrome(ws)

    headers = ["Kod", "Summa", "Izoh", "Sana", "Yetkazuvchi", "Belgi"]
    for i, h in enumerate(headers, 1):
        ws.cell(4, i, h)
    style_header(ws, 4, len(headers))

    formula_cols = {4, 5}
    kod_cols = {1}
    base = date(2026, 8, 1)
    sample = [
        ("JA", 450000, "Kartoshka, piyoz", base),
        ("BAZAR", 200000, "Sabzavot", base + timedelta(days=2)),
    ]

    for r, (kod, summa, izoh, sana) in enumerate(sample, DATA_START):
        ws.cell(r, 1, kod)
        ws.cell(r, 2, summa).number_format = MONEY_FMT
        ws.cell(r, 3, izoh)
        ws.cell(r, 4, sana).number_format = DATE_FMT
        ws.cell(r, 5, kod_lookup_formula(f"A{r}", "YetkazuvchiKod", "YetkazuvchiIsm"))
        mark_entry_row(ws, r, len(headers), formula_cols, kod_cols)
        tag_sample(ws, r, 6)

    for r in range(DATA_START + len(sample), DATA_END + 1):
        ws.cell(r, 4, auto_date_formula([f'A{r}<>""', f"B{r}>0"])).number_format = DATE_FMT
        ws.cell(r, 5, kod_lookup_formula(f"A{r}", "YetkazuvchiKod", "YetkazuvchiIsm"))
        mark_entry_row(ws, r, len(headers), formula_cols, kod_cols)
        ws.cell(r, 2).number_format = MONEY_FMT

    add_table(ws, "tblTovargaPul", f"A4:F{DATA_END}")
    set_widths(ws, {"A": 10, "B": 14, "C": 22, "D": 12, "E": 18, "F": 10})


def write_kunlik_kassa(wb: Workbook):
    ws = wb.create_sheet("Kunlik kassa")
    set_title_block(
        ws,
        "Kunlik kassa",
        "Har kuni: Kirdi va Boshqa chiqim. Xarajat/tovar — batafsil varag'lardan avtomatik.",
        "A1:I1",
    )
    sheet_chrome(ws)

    headers = [
        "Sana",
        "Kirdi",
        "Boshqa_chiqim",
        "Xarajat",
        "Tavarga_pul",
        "Jami_chiqim",
        "Kunlik_farq",
        "Kassa_qoldiq",
        "Belgi",
    ]
    for i, h in enumerate(headers, 1):
        ws.cell(4, i, h)
    style_header(ws, 4, len(headers))

    # Sana sample = input value; empty rows = auto formula. Xarajat/tovar/jami/farq/qoldiq = formula
    formula_cols = {4, 5, 6, 7, 8}
    base = date(2026, 8, 1)
    sample = [
        (base, 1200000, 20000),
        (base + timedelta(days=1), 980000, 15000),
        (base + timedelta(days=2), 1500000, 30000),
    ]

    for r, (sana, kirdi, boshqa) in enumerate(sample, DATA_START):
        ws.cell(r, 1, sana).number_format = DATE_FMT
        ws.cell(r, 2, kirdi).number_format = MONEY_FMT
        ws.cell(r, 3, boshqa).number_format = MONEY_FMT
        ws.cell(
            r, 4, f'=IF(A{r}="","",SUMIFS(tblXarajatlar[Summa],tblXarajatlar[Sana],A{r}))'
        ).number_format = MONEY_FMT
        ws.cell(
            r, 5, f'=IF(A{r}="","",SUMIFS(tblTovargaPul[Summa],tblTovargaPul[Sana],A{r}))'
        ).number_format = MONEY_FMT
        ws.cell(r, 6, f"=SUM(C{r}:E{r})").number_format = MONEY_FMT
        ws.cell(r, 7, f"=B{r}-F{r}").number_format = MONEY_FMT
        if r == DATA_START:
            ws.cell(r, 8, f"=StartCash+G{r}").number_format = MONEY_FMT
        else:
            ws.cell(r, 8, f"=H{r - 1}+G{r}").number_format = MONEY_FMT
        mark_entry_row(ws, r, len(headers), formula_cols)
        # sample sana stays yellow (manual), keep A as input for samples
        ws.cell(r, 1).fill = INPUT_FILL
        tag_sample(ws, r, 9)

    for r in range(DATA_START + len(sample), DATA_END + 1):
        ws.cell(r, 1, auto_date_formula([f"B{r}>0", f"C{r}>0"])).number_format = DATE_FMT
        ws.cell(
            r, 4, f'=IF(A{r}="","",SUMIFS(tblXarajatlar[Summa],tblXarajatlar[Sana],A{r}))'
        ).number_format = MONEY_FMT
        ws.cell(
            r, 5, f'=IF(A{r}="","",SUMIFS(tblTovargaPul[Summa],tblTovargaPul[Sana],A{r}))'
        ).number_format = MONEY_FMT
        ws.cell(r, 6, f'=IF(A{r}="","",SUM(C{r}:E{r}))').number_format = MONEY_FMT
        ws.cell(r, 7, f'=IF(A{r}="","",B{r}-F{r})').number_format = MONEY_FMT
        prev = r - 1
        ws.cell(
            r, 8, f'=IF(A{r}="","",IF(H{prev}="",StartCash+G{r},H{prev}+G{r}))'
        ).number_format = MONEY_FMT
        mark_entry_row(ws, r, len(headers), formula_cols | {1})
        for c in (2, 3):
            ws.cell(r, c).number_format = MONEY_FMT

    add_table(ws, "tblKunlikKassa", f"A4:I{DATA_END}")
    set_widths(
        ws,
        {
            "A": 12,
            "B": 14,
            "C": 14,
            "D": 12,
            "E": 13,
            "F": 13,
            "G": 13,
            "H": 14,
            "I": 10,
        },
    )


def write_oldi_berdi(wb: Workbook):
    global _DEBT_RECV_CELL, _DEBT_PAY_CELL

    ws = wb.create_sheet(OLDI_BERDI_SHEET)
    set_title_block(
        ws,
        "Oldi-berdi",
        "Kod + Berdim/Oldim. Berdim = odam sizga qarzdor (+). Oldim = qarz qoplandi. Balans = Berdim − Oldim.",
        "A1:H1",
    )
    sheet_chrome(ws)

    headers = ["Kod", "Berdim", "Oldim", "Izoh", "Sana", "Odam", "Qator_balans", "Belgi"]
    for i, h in enumerate(headers, 1):
        ws.cell(4, i, h)
    style_header(ws, 4, len(headers))

    formula_cols = {5, 6, 7}
    kod_cols = {1}
    base = date(2026, 8, 1)
    sample = [
        ("SH", 200000, 0, "Qarz berdim", base),
        ("JA", 0, 150000, "Oldingi qarz qoplandi", base + timedelta(days=2)),
        ("SI", 50000, 0, "Vaqtincha", base + timedelta(days=3)),
    ]

    for r, (kod, berdim, oldim, izoh, sana) in enumerate(sample, DATA_START):
        ws.cell(r, 1, kod)
        ws.cell(r, 2, berdim).number_format = MONEY_FMT
        ws.cell(r, 3, oldim).number_format = MONEY_FMT
        ws.cell(r, 4, izoh)
        ws.cell(r, 5, sana).number_format = DATE_FMT
        ws.cell(r, 6, kod_lookup_formula(f"A{r}", "OdamlarKod", "OdamlarIsm"))
        ws.cell(r, 7, f"=B{r}-C{r}").number_format = MONEY_FMT
        mark_entry_row(ws, r, len(headers), formula_cols, kod_cols)
        tag_sample(ws, r, 8)

    for r in range(DATA_START + len(sample), DATA_END + 1):
        ws.cell(
            r, 5, auto_date_formula([f'A{r}<>""', f"B{r}>0", f"C{r}>0"])
        ).number_format = DATE_FMT
        ws.cell(r, 6, kod_lookup_formula(f"A{r}", "OdamlarKod", "OdamlarIsm"))
        ws.cell(
            r, 7, f'=IF(OR(A{r}="",AND(B{r}="",C{r}="")),"",B{r}-C{r})'
        ).number_format = MONEY_FMT
        mark_entry_row(ws, r, len(headers), formula_cols, kod_cols)
        for c in (2, 3):
            ws.cell(r, c).number_format = MONEY_FMT

    add_table(ws, "tblOldiBerdi", f"A4:H{DATA_END}")

    # Person balance summary
    summary_row = DATA_END + 3
    ws.cell(summary_row, 1, "Odamlar balansi").font = SECTION_FONT
    ws.merge_cells(f"A{summary_row}:D{summary_row}")
    for i, h in enumerate(["Kod", "Ism", "Balans", "Ma'nosi"], 1):
        ws.cell(summary_row + 1, i, h)
    style_header(ws, summary_row + 1, 4)

    people_codes = ["SH", "JA", "SI"]
    for i, kod in enumerate(people_codes):
        r = summary_row + 2 + i
        ws.cell(r, 1, kod)
        mark_entry_row(ws, r, 4, {2, 3, 4}, {1})
        ws.cell(r, 2, kod_lookup_formula(f"A{r}", "OdamlarKod", "OdamlarIsm"))
        ws.cell(
            r, 3, f"=SUMIFS(tblOldiBerdi[Qator_balans],tblOldiBerdi[Kod],A{r})"
        ).number_format = MONEY_FMT
        ws.cell(
            r,
            4,
            f'=IF(C{r}>0,"Bizga qarz (+"&TEXT(C{r},"#,##0")&")",'
            f'IF(C{r}<0,"Bizdan qarz ("&TEXT(C{r},"#,##0")&")","Hisob yo\'q"))',
        )

    total_r = summary_row + 2 + len(people_codes)
    ws.cell(total_r, 1, "JAMI (sof)").font = KPI_LABEL_FONT
    ws.cell(total_r, 1).fill = SECTION_FILL
    ws.cell(total_r, 1).border = THIN
    ws.cell(total_r, 3, f"=SUM(C{summary_row + 2}:C{total_r - 1})").number_format = MONEY_FMT
    ws.cell(total_r, 3).fill = KPI_FILL
    ws.cell(total_r, 3).border = THIN
    ws.cell(total_r, 3).font = KPI_LABEL_FONT

    recv_r = total_r + 2
    ws.cell(recv_r, 1, "Odamlardan qarz (bizga)").font = KPI_LABEL_FONT
    ws.cell(recv_r, 1).fill = SECTION_FILL
    ws.cell(recv_r, 1).border = THIN
    ws.cell(recv_r, 3, f"=SUMIF(C{summary_row + 2}:C{total_r - 1},\">0\")").number_format = MONEY_FMT
    ws.cell(recv_r, 3).fill = KPI_FILL
    ws.cell(recv_r, 3).border = THIN

    pay_r = recv_r + 1
    ws.cell(pay_r, 1, "Odamlarga qarz (bizdan)").font = KPI_LABEL_FONT
    ws.cell(pay_r, 1).fill = SECTION_FILL
    ws.cell(pay_r, 1).border = THIN
    ws.cell(pay_r, 3, f'=-SUMIF(C{summary_row + 2}:C{total_r - 1},"<0")').number_format = MONEY_FMT
    ws.cell(pay_r, 3).fill = KPI_FILL
    ws.cell(pay_r, 3).border = THIN

    _DEBT_RECV_CELL = f"{OLDI_BERDI_REF}!$C${recv_r}"
    _DEBT_PAY_CELL = f"{OLDI_BERDI_REF}!$C${pay_r}"

    wb.defined_names.add(DefinedName(name="PeopleReceivable", attr_text=_DEBT_RECV_CELL))
    wb.defined_names.add(DefinedName(name="PeoplePayable", attr_text=_DEBT_PAY_CELL))

    set_widths(
        ws,
        {"A": 10, "B": 12, "C": 12, "D": 22, "E": 12, "F": 18, "G": 13, "H": 10},
    )


def _kpi_row(ws, row: int, label: str, formula: str, note: str, highlight: bool = False):
    ws.cell(row, 1, label).font = KPI_LABEL_FONT if highlight else BODY_FONT
    ws.cell(row, 1).fill = KPI_FILL if highlight else SECTION_FILL
    ws.cell(row, 1).border = THIN
    ws.cell(row, 1).alignment = Alignment(vertical="center", indent=1)
    c = ws.cell(row, 2, formula)
    c.fill = KPI_FILL if highlight else FORMULA_FILL
    c.border = THIN
    c.number_format = MONEY_FMT
    c.font = Font(name="Calibri", bold=highlight, size=12 if highlight else 11, color=NAVY)
    c.alignment = Alignment(horizontal="right", vertical="center")
    n = ws.cell(row, 3, note)
    n.font = SUBTITLE_FONT
    n.border = THIN
    ws.row_dimensions[row].height = 22


def write_hisob_balans(wb: Workbook):
    ws = wb.create_sheet("Hisob balans")
    set_title_block(
        ws,
        "Hisob balans",
        "Jami kirim-chiqim va qarzlar. Barcha raqamlar boshqa varag'lardan avtomatik.",
        "A1:C1",
    )
    sheet_chrome(ws, "A5")

    for i, h in enumerate(["Ko'rsatkich", "Summa (so'm)", "Manba"], 1):
        ws.cell(4, i, h)
    style_header(ws, 4, 3)

    # Quoted sheet refs — avoids #NAME? from unquoted Oldi-berdi hyphen
    debt_recv = f"={_DEBT_RECV_CELL}"
    debt_pay = f"={_DEBT_PAY_CELL}"

    layout = [
        (5, "Boshlang'ich kassa", "=StartCash", "Parametrlar", False),
        (6, "Jami kirdi", "=SUM(tblKunlikKassa[Kirdi])", "Kunlik kassa", False),
        (7, "Jami xarajat", "=SUM(tblXarajatlar[Summa])", "Xarajatlar", False),
        (8, "Jami tavarga pul", "=SUM(tblTovargaPul[Summa])", "Tovarga pul", False),
        (9, "Jami boshqa chiqim", "=SUM(tblKunlikKassa[Boshqa_chiqim])", "Kunlik kassa", False),
        (10, "Jami chiqim", "=B7+B8+B9", "3 chiqim turi", False),
        (12, "Joriy kassa balans", "=B5+B6-B10", "Boshlang'ich + kirdi − chiqim", True),
        (13, "Oxirgi kun qoldiq", "=B12", "Joriy kassa bilan bir xil", False),
        (15, "Odamlardan qarz (bizga)", debt_recv, "SH 200k + SI 50k = 250k", False),
        (16, "Odamlarga qarz (bizdan)", debt_pay, "JA 150k", False),
        (17, "Umumiy moliyaviy holat", "=B12+B15-B16", "Kassa + bizga − bizdan", True),
    ]
    for row, label, formula, note, hi in layout:
        _kpi_row(ws, row, label, formula, note, hi)

    ws.row_dimensions[11].height = 8
    ws.row_dimensions[14].height = 8

    ws.cell(19, 1, "Namuna tekshiruv").font = SECTION_FONT
    ws.cell(
        20,
        1,
        "Kutilgan: kassa 2 885 000 | bizga 250 000 | bizdan 150 000 | umumiy 2 985 000. "
        "750 000 — bu kassa qoldiq emas (qarang Parametrlar eslatmasi).",
    ).font = SUBTITLE_FONT
    ws.merge_cells("A20:C21")
    ws["A20"].alignment = Alignment(wrap_text=True)

    set_widths(ws, {"A": 32, "B": 16, "C": 36})


def write_oylik_xulosa(wb: Workbook):
    ws = wb.create_sheet("Oylik xulosa")
    set_title_block(
        ws,
        "Oylik xulosa",
        "Parametrlardagi oy/yil bo'yicha SUMIFS. Sariq kodlar — filtrlash uchun.",
        "A1:C1",
    )
    sheet_chrome(ws, "A7")

    ws.cell(4, 1, "Tanlangan davr").font = KPI_LABEL_FONT
    ws.cell(4, 1).fill = SECTION_FILL
    ws.cell(4, 1).border = THIN
    ws.cell(4, 2, '=ReportMonth&"/"&ReportYear')
    ws.cell(4, 2).fill = FORMULA_FILL
    ws.cell(4, 2).border = THIN
    ws.cell(4, 2).font = Font(name="Calibri", bold=True, size=12, color=NAVY)

    date_from, date_to = month_date_criteria()
    debt_recv = f"={_DEBT_RECV_CELL}"
    debt_pay = f"={_DEBT_PAY_CELL}"

    for i, h in enumerate(["Ko'rsatkich", "Summa (so'm)"], 1):
        ws.cell(6, i, h)
    style_header(ws, 6, 2)

    items = [
        (7, "Jami kirdi", f"=SUMIFS(tblKunlikKassa[Kirdi],tblKunlikKassa[Sana],{date_from},tblKunlikKassa[Sana],{date_to})", False),
        (8, "Jami xarajat", f"=SUMIFS(tblXarajatlar[Summa],tblXarajatlar[Sana],{date_from},tblXarajatlar[Sana],{date_to})", False),
        (9, "Jami tavarga pul", f"=SUMIFS(tblTovargaPul[Summa],tblTovargaPul[Sana],{date_from},tblTovargaPul[Sana],{date_to})", False),
        (10, "Jami boshqa chiqim", f"=SUMIFS(tblKunlikKassa[Boshqa_chiqim],tblKunlikKassa[Sana],{date_from},tblKunlikKassa[Sana],{date_to})", False),
        (11, "Jami chiqim", "=B8+B9+B10", False),
        (12, "Foyda (kirdi − chiqim)", "=B7-B11", True),
        (14, "Oy oxiridagi kassa qoldiq", "=StartCash+B7-B11", True),
        (15, "Odamlardan qarz (bizga)", debt_recv, False),
        (16, "Odamlarga qarz (bizdan)", debt_pay, False),
    ]

    for row, label, formula, hi in items:
        ws.cell(row, 1, label).font = KPI_LABEL_FONT if hi else BODY_FONT
        ws.cell(row, 1).fill = KPI_FILL if hi else SECTION_FILL
        ws.cell(row, 1).border = THIN
        c = ws.cell(row, 2, formula)
        c.fill = KPI_FILL if hi else FORMULA_FILL
        c.number_format = MONEY_FMT
        c.border = THIN
        c.font = Font(name="Calibri", bold=hi, size=12 if hi else 11, color=NAVY)

    ws.cell(18, 1, "Xarajat turlari (oylik)").font = SECTION_FONT
    for i, h in enumerate(["Kod", "Tur", "Summa"], 1):
        ws.cell(19, i, h)
    style_header(ws, 19, 3)

    for i, kod in enumerate(["SV", "AB", "IJ", "MS", "TR", "BOSHQA"]):
        r = 20 + i
        ws.cell(r, 1, kod)
        mark_entry_row(ws, r, 3, {2, 3}, {1})
        ws.cell(r, 2, kod_lookup_formula(f"A{r}", "XarajatKod", "XarajatNomi"))
        ws.cell(
            r,
            3,
            f"=SUMIFS(tblXarajatlar[Summa],tblXarajatlar[Kod],A{r},"
            f"tblXarajatlar[Sana],{date_from},tblXarajatlar[Sana],{date_to})",
        ).number_format = MONEY_FMT

    ws.cell(28, 1, "Yetkazuvchilar (oylik)").font = SECTION_FONT
    for i, h in enumerate(["Kod", "Yetkazuvchi", "Summa"], 1):
        ws.cell(29, i, h)
    style_header(ws, 29, 3)

    for i, kod in enumerate(["JA", "SH", "BAZAR", "OPT"]):
        r = 30 + i
        ws.cell(r, 1, kod)
        mark_entry_row(ws, r, 3, {2, 3}, {1})
        ws.cell(r, 2, kod_lookup_formula(f"A{r}", "YetkazuvchiKod", "YetkazuvchiIsm"))
        ws.cell(
            r,
            3,
            f"=SUMIFS(tblTovargaPul[Summa],tblTovargaPul[Kod],A{r},"
            f"tblTovargaPul[Sana],{date_from},tblTovargaPul[Sana],{date_to})",
        ).number_format = MONEY_FMT

    ws.cell(36, 1, "Namuna (avgust 2026)").font = SECTION_FONT
    ws.cell(
        37,
        1,
        "Kirdi 3 680 000 | xarajat 580 000 | tovar 650 000 | boshqa 65 000 | "
        "chiqim 1 295 000 | foyda 2 385 000 | oy oxiri kassa 2 885 000 "
        "(= 500 000 + 3 680 000 − 1 295 000). "
        "Eski 750 000: 3-avgust chiqim=farq yoki 500k+250k qarz — kassa qoldiq emas.",
    ).font = SUBTITLE_FONT
    ws.merge_cells("A37:C39")
    ws["A37"].alignment = Alignment(wrap_text=True, vertical="top")

    set_widths(ws, {"A": 32, "B": 18, "C": 14})


def save_workbook(wb: Workbook) -> Path:
    for path in (OUT_UI, OUT_FIXED, OUT, OUT_FALLBACK, OUT_ALT):
        try:
            wb.save(path)
            print(f"Wrote {path}")
            return path
        except PermissionError:
            continue
    raise PermissionError(
        "Could not write workbook — close Excel copies and retry."
    )


def main():
    wb = Workbook()
    wb.remove(wb.active)
    write_params(wb)
    write_xarajatlar(wb)
    write_tovarga_pul(wb)
    write_kunlik_kassa(wb)
    write_oldi_berdi(wb)
    write_hisob_balans(wb)
    write_oylik_xulosa(wb)
    path = save_workbook(wb)
    print("Debt refs:", _DEBT_RECV_CELL, _DEBT_PAY_CELL)
    return path


if __name__ == "__main__":
    main()
