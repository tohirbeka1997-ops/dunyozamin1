#!/usr/bin/env python3
"""
Generate a professional POS / store buy-sell Excel workbook with working formulas.
Aligned with this project's reporting concepts (UZS, COGS, gross/net profit, aging, payments).
"""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from openpyxl import Workbook
from openpyxl.chart import BarChart, PieChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, NamedStyle, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableStyleInfo

OUT = Path(__file__).resolve().parent / "Dokon_Oldi_Berdi_Hisobotlar.xlsx"

# --- Styles ---
HEADER_FILL = PatternFill("solid", fgColor="1B4F72")
HEADER_FONT = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
TITLE_FONT = Font(name="Calibri", bold=True, size=16, color="1B4F72")
SUBTITLE_FONT = Font(name="Calibri", size=11, color="566573")
INPUT_FILL = PatternFill("solid", fgColor="FFF8E1")  # user enters
FORMULA_FILL = PatternFill("solid", fgColor="E8F5E9")  # formula-driven
SECTION_FILL = PatternFill("solid", fgColor="D6EAF8")
WARN_FILL = PatternFill("solid", fgColor="FDEDEC")
THIN = Border(
    left=Side(style="thin", color="BFC9CA"),
    right=Side(style="thin", color="BFC9CA"),
    top=Side(style="thin", color="BFC9CA"),
    bottom=Side(style="thin", color="BFC9CA"),
)
MONEY_FMT = '#,##0'
PCT_FMT = '0.0%'
QTY_FMT = '0.00'
DATE_FMT = 'YYYY-MM-DD'


def style_header(ws, row: int, cols: int):
    for c in range(1, cols + 1):
        cell = ws.cell(row, c)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(wrap_text=True, horizontal="center", vertical="center")
        cell.border = THIN
    ws.row_dimensions[row].height = 32


def autosize(ws, min_w=10, max_w=28):
    for col in ws.columns:
        letter = get_column_letter(col[0].column)
        length = 0
        for cell in col[:40]:
            if cell.value is not None:
                length = max(length, min(len(str(cell.value)), max_w))
        ws.column_dimensions[letter].width = max(min_w, length + 2)


def add_table(ws, name: str, ref: str):
    tab = Table(displayName=name, ref=ref)
    tab.tableStyleInfo = TableStyleInfo(
        name="TableStyleMedium2", showFirstColumn=False, showLastColumn=False, showRowStripes=True
    )
    ws.add_table(tab)


def mark_input_row(ws, row: int, cols: int, formula_cols: set[int] | None = None):
    formula_cols = formula_cols or set()
    for c in range(1, cols + 1):
        cell = ws.cell(row, c)
        cell.border = THIN
        cell.fill = FORMULA_FILL if c in formula_cols else INPUT_FILL


def write_readme(wb: Workbook):
    ws = wb.create_sheet("00_README", 0)
    ws["A1"] = "Do'kon Oldi-Berdi va Hisobotlar - Excel formulalar to'plami"
    ws["A1"].font = TITLE_FONT
    ws.merge_cells("A1:F1")
    ws["A2"] = (
        "POS loyihasi (unified sales, COGS, gross/net profit, aging, to'lov usullari) bilan moslashtirilgan."
    )
    ws["A2"].font = SUBTITLE_FONT
    ws.merge_cells("A2:F2")

    rows = [
        ("", ""),
        ("VALYUTA / ASSUMPTIONS", ""),
        ("Asosiy valyuta", "UZS (so'm). USD qatorlarida: UZS = miqdor × fx_rate (1 USD = N UZS)."),
        ("COGS (tannarx)", "Sotuvda muzlatilgan unit_cost; bo'sh bo'lsa mahsulot o'rtacha tannarxi (avg cost)."),
        ("Yalpi foyda", "Gross Profit = Sotuv tushumi - COGS"),
        ("Sof foyda", "Net Profit = Gross - Qaytarish tushumi + Qaytarish COGS - Xarajatlar - Komissiya"),
        ("Aging bucketlar", "0-7, 8-30, 31-60, 61+ kun (POS agingCalc bilan bir xil)"),
        ("Ombor tannarxi", "Moving average (o'rtacha): yangi xarid = (eski qiymat + kirim qiymati) / yangi qoldiq"),
        ("FIFO", "To'liq FIFO qatlamlari alohida hisob; bu kitobda o'rtacha tannarx (amaliy Excel)."),
        ("", ""),
        ("RANGLAR", ""),
        ("Sariq kataklar", "Siz kiritasiz (raw data)"),
        ("Yashil kataklar", "Formula - qo'lda o'zgartirmang"),
        ("", ""),
        ("QANDAY ISHLATISH", ""),
        ("1", "01_Mahsulotlar - mahsulot kodlari, nomlari, boshlang'ich qoldiq/tannarx"),
        ("2", "02_Harakatlar - kunlik oldi-berdi (kirim/chiqim) yoki 03/04 alohida sotuv/xarid"),
        ("3", "03_Sotuvlar, 04_Xaridlar, 05_Qaytarishlar, 06_Tolovlar - tranzaksiya jurnaliga yozing"),
        ("4", "07_Mijoz_Qarz, 08_Yetkazuvchi - ochiq qarzlar (AR/AP)"),
        ("5", "09_Xarajatlar - kunlik/oylik do'kon xarajatlari"),
        ("6", "Hisobot varaqlaridagi formulalar avtomatik hisoblaydi (Dashboard, Ombor, Kassa, Aging)"),
        ("7", "Parametrlar!B2:B3 - hisobot davri (From/To). Dashboard shu oralig'ga bog'langan."),
        ("", ""),
        ("VARAQLAR", ""),
        ("00_README", "Yo'riqnoma va taxminlar"),
        ("Parametrlar", "Davr, FX default, do'kon nomi"),
        ("01_Mahsulotlar", "Mahsulotlar katalogi + boshlang'ich ombor"),
        ("02_Harakatlar", "Kunlik oldi-berdi ledger (kirim/chiqim)"),
        ("03_Sotuvlar", "Sotuv qatorlari (tushum, chegirma, COGS, foyda)"),
        ("04_Xaridlar", "Kirim / xarid"),
        ("05_Qaytarishlar", "Mijoz qaytarishi"),
        ("06_Tolovlar", "Naqd / karta / kredit / Payme / Click ..."),
        ("07_Mijoz_Qarz", "Debitorlar (AR) + aging"),
        ("08_Yetkazuvchi", "Kreditorlar (AP) + aging"),
        ("09_Xarajatlar", "Operatsion xarajatlar"),
        ("Ombor_Qoldiq", "Mahsulot bo'yicha ochilish/kirim/chiqim/yopilish + qiymat"),
        ("Sotuv_Hisobot", "Kunlik/davr bo'yicha P&L (SUMIFS)"),
        ("Kassa", "Kunlik kassa: naqd/karta/kredit"),
        ("Aging_AR_AP", "Qarzlar yoshi bo'yicha jamlanma"),
        ("Dashboard", "Bosh panel - formulalar bilan KPI"),
        ("", ""),
        ("POS LOYIHA MOSLIGI", ""),
        ("Payment methods", "cash, card, transfer, uzcard, humo, click, payme, credit"),
        ("Credit", "credit_amount ≈ total - paid (qisman to'lov mumkin)"),
        ("Returns impact", "Qaytarish tushumni kamaytiradi, COGS qaytaradi (net profit formulasi)"),
    ]
    for i, (a, b) in enumerate(rows, start=4):
        ws.cell(i, 1, a).font = Font(bold=bool(a and not a[0].isdigit() and a == a.upper()))
        ws.cell(i, 2, b)
        if a in ("VALYUTA / ASSUMPTIONS", "RANGLAR", "QANDAY ISHLATISH", "VARAQLAR", "POS LOYIHA MOSLIGI"):
            ws.cell(i, 1).fill = SECTION_FILL
            ws.cell(i, 2).fill = SECTION_FILL

    # Legend samples
    ws["A40"] = "Namuna:"
    ws["B40"] = "Kirish maydoni"
    ws["B40"].fill = INPUT_FILL
    ws["C40"] = "Formula maydoni"
    ws["C40"].fill = FORMULA_FILL

    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 90
    for col in ("C", "D", "E", "F"):
        ws.column_dimensions[col].width = 16


def write_params(wb: Workbook):
    ws = wb.create_sheet("Parametrlar")
    ws["A1"] = "Hisobot parametrlari"
    ws["A1"].font = TITLE_FONT
    headers = ["Parametr", "Qiymat", "Izoh"]
    for i, h in enumerate(headers, 1):
        ws.cell(3, i, h)
    style_header(ws, 3, 3)

    data = [
        ("Do'kon nomi", "Namuna Do'kon", "Dashboard sarlavhasi"),
        ("Davr boshi", date(2026, 8, 1), "YYYY-MM-DD - Dashboard/SUMIFS filtri"),
        ("Davr oxiri", date(2026, 8, 23), "YYYY-MM-DD"),
        ("Default FX (UZS/USD)", 12500, "USD qatorlarida bo'sh fx bo'lsa"),
        ("Bugungi sana", date(2026, 8, 23), "Aging hisobi uchun"),
        ("Valyuta", "UZS", "Asosiy hisobot valyutasi"),
    ]
    for r, (p, v, n) in enumerate(data, 4):
        ws.cell(r, 1, p)
        cell = ws.cell(r, 2, v)
        cell.fill = INPUT_FILL
        cell.border = THIN
        if isinstance(v, date):
            cell.number_format = DATE_FMT
        elif isinstance(v, (int, float)) and r == 7:
            cell.number_format = MONEY_FMT
        ws.cell(r, 3, n)

    # Named ranges for period
    wb.defined_names.add(DefinedName(name="PeriodStart", attr_text="Parametrlar!$B$5"))
    wb.defined_names.add(DefinedName(name="PeriodEnd", attr_text="Parametrlar!$B$6"))
    wb.defined_names.add(DefinedName(name="AsOfDate", attr_text="Parametrlar!$B$8"))
    wb.defined_names.add(DefinedName(name="DefaultFX", attr_text="Parametrlar!$B$7"))
    wb.defined_names.add(DefinedName(name="StoreName", attr_text="Parametrlar!$B$4"))

    ws.column_dimensions["A"].width = 24
    ws.column_dimensions["B"].width = 22
    ws.column_dimensions["C"].width = 45


def write_products(wb: Workbook):
    ws = wb.create_sheet("01_Mahsulotlar")
    ws["A1"] = "Mahsulotlar katalogi (Products master)"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = "Sariq = kiriting. Yashil = formula. Kod unique bo'lsin."
    ws["A2"].font = SUBTITLE_FONT

    headers = [
        "Kod",
        "Nomi",
        "Kategoriya",
        "Birlik",
        "Boshlangich_qty",
        "Boshlangich_tannarx",
        "Boshlangich_qiymat",
        "Sotuv_narxi",
        "Minimal_qoldiq",
        "Faol",
    ]
    for i, h in enumerate(headers, 1):
        ws.cell(4, i, h)
    style_header(ws, 4, len(headers))

    sample = [
        ("PRD-001", "Un 1kg", "Oziq-ovqat", "dona", 100, 8000, None, 10000, 20, "Ha"),
        ("PRD-002", "Yog' 1L", "Oziq-ovqat", "dona", 50, 18000, None, 22000, 10, "Ha"),
        ("PRD-003", "Sovun", "Maishiy", "dona", 80, 3500, None, 5000, 15, "Ha"),
        ("PRD-004", "Choy 100g", "Ichimlik", "dona", 40, 12000, None, 15000, 8, "Ha"),
        ("PRD-005", "Shakar 1kg", "Oziq-ovqat", "dona", 60, 9000, None, 11000, 12, "Ha"),
    ]
    formula_cols = {7}
    for r, row in enumerate(sample, 5):
        for c, v in enumerate(row, 1):
            cell = ws.cell(r, c, v)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c in formula_cols else INPUT_FILL
            if c in (5, 9):
                cell.number_format = QTY_FMT
            if c in (6, 8):
                cell.number_format = MONEY_FMT
        # Opening stock value = qty * unit cost
        cell = ws.cell(r, 7, f"=E{r}*F{r}")
        cell.fill = FORMULA_FILL
        cell.number_format = MONEY_FMT
        cell.border = THIN

    # Extra empty rows for data entry
    for r in range(10, 25):
        for c in range(1, 11):
            cell = ws.cell(r, c, None)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c == 7 else INPUT_FILL
        ws.cell(r, 7, f"=IF(OR(E{r}=\"\",F{r}=\"\"),\"\",E{r}*F{r})")
        ws.cell(r, 7).fill = FORMULA_FILL
        ws.cell(r, 7).number_format = MONEY_FMT

    add_table(ws, "tblProducts", "A4:J24")
    autosize(ws)
    ws.freeze_panes = "A5"


def write_movements(wb: Workbook):
    """Daily buy/sell ledger with running stock via formulas referencing product + movements."""
    ws = wb.create_sheet("02_Harakatlar")
    ws["A1"] = "Oldi-berdi (kunlik harakatlar ledger)"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = (
        "Turi: KIRIM (xarid) yoki CHIQIM (sotuv). Miqdor_in / Miqdor_out - faqat biri to'ldiriladi. "
        "Summa, qoldiq va qiymat - formulalar."
    )
    ws["A2"].font = SUBTITLE_FONT

    headers = [
        "Sana",
        "Hujjat_N",
        "Mahsulot_kod",
        "Mahsulot_nomi",
        "Turi",
        "Miqdor_in",
        "Miqdor_out",
        "Birlik_tannarx",
        "Birlik_sotuv",
        "Summa_UZS",
        "Qoldiq_qty",  # note: full running balance better on Ombor; here per-row net for demo
        "Harakat_qiymati",
        "Izoh",
    ]
    for i, h in enumerate(headers, 1):
        ws.cell(4, i, h)
    style_header(ws, 4, len(headers))

    # Sample movements
    base = date(2026, 8, 1)
    sample = [
        (base, "XR-001", "PRD-001", "KIRIM", 50, 0, 8000, 10000, "Yetkazuvchi A"),
        (base, "ST-001", "PRD-001", "CHIQIM", 0, 12, 8000, 10000, "Roznichka"),
        (base + timedelta(days=1), "XR-002", "PRD-002", "KIRIM", 20, 0, 18000, 22000, "Yetkazuvchi B"),
        (base + timedelta(days=1), "ST-002", "PRD-002", "CHIQIM", 0, 5, 18000, 22000, ""),
        (base + timedelta(days=2), "ST-003", "PRD-003", "CHIQIM", 0, 10, 3500, 5000, "Aksiya"),
        (base + timedelta(days=3), "XR-003", "PRD-005", "KIRIM", 30, 0, 9000, 11000, ""),
        (base + timedelta(days=5), "ST-004", "PRD-001", "CHIQIM", 0, 8, 8000, 10000, ""),
        (base + timedelta(days=7), "ST-005", "PRD-004", "CHIQIM", 0, 6, 12000, 15000, ""),
        (base + timedelta(days=10), "XR-004", "PRD-003", "KIRIM", 40, 0, 3400, 5000, "Yangi partiya"),
        (base + timedelta(days=12), "ST-006", "PRD-005", "CHIQIM", 0, 15, 9000, 11000, ""),
    ]

    dv = DataValidation(type="list", formula1='"KIRIM,CHIQIM"', allow_blank=True)
    ws.add_data_validation(dv)
    dv.add("E5:E104")

    formula_cols = {4, 10, 11, 12}
    for r, (sana, hujjat, kod, turi, qin, qout, cost, price, izoh) in enumerate(sample, 5):
        ws.cell(r, 1, sana).number_format = DATE_FMT
        ws.cell(r, 2, hujjat)
        ws.cell(r, 3, kod)
        # Product name via XLOOKUP
        ws.cell(r, 4, f'=IF(C{r}="","",IFERROR(XLOOKUP(C{r},tblProducts[Kod],tblProducts[Nomi]),"-"))')
        ws.cell(r, 5, turi)
        ws.cell(r, 6, qin if qin else None)
        ws.cell(r, 7, qout if qout else None)
        ws.cell(r, 8, cost).number_format = MONEY_FMT
        ws.cell(r, 9, price).number_format = MONEY_FMT
        # Amount: IN uses cost, OUT uses sale price
        ws.cell(
            r,
            10,
            f'=IF(E{r}="KIRIM",IFERROR(F{r}*H{r},0),IF(E{r}="CHIQIM",IFERROR(G{r}*I{r},0),0))',
        )
        # Net qty movement signed
        ws.cell(r, 11, f'=IFERROR(N(F{r})-N(G{r}),0)')
        # Stock value impact: IN at cost, OUT at cost (COGS impact)
        ws.cell(
            r,
            12,
            f'=IF(E{r}="KIRIM",IFERROR(F{r}*H{r},0),IF(E{r}="CHIQIM",-IFERROR(G{r}*H{r},0),0))',
        )
        ws.cell(r, 13, izoh)
        for c in range(1, 14):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c in formula_cols else INPUT_FILL
            if c in (6, 7, 11):
                cell.number_format = QTY_FMT
            if c in (8, 9, 10, 12):
                cell.number_format = MONEY_FMT

    for r in range(15, 55):
        for c in range(1, 14):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c in formula_cols else INPUT_FILL
        ws.cell(r, 4, f'=IF(C{r}="","",IFERROR(XLOOKUP(C{r},tblProducts[Kod],tblProducts[Nomi]),"-"))')
        ws.cell(
            r,
            10,
            f'=IF(OR(C{r}="",E{r}=""),"",IF(E{r}="KIRIM",IFERROR(F{r}*H{r},0),IF(E{r}="CHIQIM",IFERROR(G{r}*I{r},0),0)))',
        )
        ws.cell(r, 11, f'=IF(C{r}="","",IFERROR(N(F{r})-N(G{r}),0))')
        ws.cell(
            r,
            12,
            f'=IF(C{r}="","",IF(E{r}="KIRIM",IFERROR(F{r}*H{r},0),IF(E{r}="CHIQIM",-IFERROR(G{r}*H{r},0),0)))',
        )
        for c in (6, 7, 11):
            ws.cell(r, c).number_format = QTY_FMT
        for c in (8, 9, 10, 12):
            ws.cell(r, c).number_format = MONEY_FMT
        ws.cell(r, 1).number_format = DATE_FMT

    add_table(ws, "tblMovements", "A4:M54")
    autosize(ws)
    ws.freeze_panes = "A5"

    # Totals row note
    ws["A56"] = "Davr jami (kirim summa / chiqim summa / net qiymat):"
    ws["A56"].font = Font(bold=True)
    ws["B56"] = '=SUMIFS(tblMovements[Summa_UZS],tblMovements[Turi],"KIRIM",tblMovements[Sana],">="&PeriodStart,tblMovements[Sana],"<="&PeriodEnd)'
    ws["C56"] = '=SUMIFS(tblMovements[Summa_UZS],tblMovements[Turi],"CHIQIM",tblMovements[Sana],">="&PeriodStart,tblMovements[Sana],"<="&PeriodEnd)'
    ws["D56"] = '=SUMIFS(tblMovements[Harakat_qiymati],tblMovements[Sana],">="&PeriodStart,tblMovements[Sana],"<="&PeriodEnd)'
    for col in ("B", "C", "D"):
        ws[f"{col}56"].number_format = MONEY_FMT
        ws[f"{col}56"].fill = FORMULA_FILL


def write_sales(wb: Workbook):
    ws = wb.create_sheet("03_Sotuvlar")
    ws["A1"] = "Sotuv hisoboti - qatorlar (Sales lines)"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = (
        "Brutto = qty×price; Chegirma alohida; Net = Brutto-Chegirma; COGS = qty×unit_cost; "
        "Gross profit = Net-COGS. USD bo'lsa UZS_eq = Net×FX."
    )
    ws["A2"].font = SUBTITLE_FONT

    headers = [
        "Sana",
        "Chek_N",
        "Mahsulot_kod",
        "Mahsulot_nomi",
        "Miqdor",
        "Birlik_narx",
        "Chegirma",
        "Brutto",
        "Net_tushum",
        "Birlik_tannarx",
        "COGS",
        "Gross_foyda",
        "Margin_%",
        "Valyuta",
        "FX_rate",
        "UZS_eq",
        "Kanal",
    ]
    for i, h in enumerate(headers, 1):
        ws.cell(4, i, h)
    style_header(ws, 4, len(headers))

    sample = [
        (date(2026, 8, 1), "S-1001", "PRD-001", 12, 10000, 0, 8000, "UZS", 1, "POS"),
        (date(2026, 8, 1), "S-1001", "PRD-003", 5, 5000, 1000, 3500, "UZS", 1, "POS"),
        (date(2026, 8, 2), "S-1002", "PRD-002", 5, 22000, 0, 18000, "UZS", 1, "POS"),
        (date(2026, 8, 5), "S-1003", "PRD-001", 8, 10000, 2000, 8000, "UZS", 1, "POS"),
        (date(2026, 8, 7), "S-1004", "PRD-004", 6, 15000, 0, 12000, "UZS", 1, "Web"),
        (date(2026, 8, 10), "S-1005", "PRD-005", 15, 11000, 5000, 9000, "UZS", 1, "POS"),
        (date(2026, 8, 12), "S-1006", "PRD-002", 3, 18, 0, 1.44, "USD", 12500, "POS"),  # USD sample
        (date(2026, 8, 15), "S-1007", "PRD-003", 20, 5000, 4000, 3500, "UZS", 1, "POS"),
        (date(2026, 8, 18), "S-1008", "PRD-001", 10, 10000, 0, 8000, "UZS", 1, "POS"),
        (date(2026, 8, 20), "S-1009", "PRD-005", 7, 11000, 0, 9000, "UZS", 1, "POS"),
    ]

    formula_cols = {4, 8, 9, 11, 12, 13, 16}
    for r, (sana, chek, kod, qty, price, disc, cost, cur, fx, kanal) in enumerate(sample, 5):
        ws.cell(r, 1, sana).number_format = DATE_FMT
        ws.cell(r, 2, chek)
        ws.cell(r, 3, kod)
        ws.cell(r, 4, f'=IF(C{r}="","",IFERROR(XLOOKUP(C{r},tblProducts[Kod],tblProducts[Nomi]),"-"))')
        ws.cell(r, 5, qty).number_format = QTY_FMT
        ws.cell(r, 6, price).number_format = MONEY_FMT
        ws.cell(r, 7, disc).number_format = MONEY_FMT
        ws.cell(r, 8, f"=E{r}*F{r}").number_format = MONEY_FMT  # Brutto
        ws.cell(r, 9, f"=H{r}-G{r}").number_format = MONEY_FMT  # Net
        # Unit cost: prefer entered, else product opening cost via XLOOKUP
        if cost is not None:
            ws.cell(r, 10, cost).number_format = MONEY_FMT
        else:
            ws.cell(
                r,
                10,
                f'=IFERROR(XLOOKUP(C{r},tblProducts[Kod],tblProducts[Boshlangich_tannarx]),0)',
            ).number_format = MONEY_FMT
        ws.cell(r, 11, f"=E{r}*J{r}").number_format = MONEY_FMT  # COGS
        ws.cell(r, 12, f"=I{r}-K{r}").number_format = MONEY_FMT  # GP
        ws.cell(r, 13, f'=IFERROR(L{r}/I{r},0)').number_format = PCT_FMT
        ws.cell(r, 14, cur)
        ws.cell(r, 15, fx)
        # UZS equivalent
        ws.cell(
            r,
            16,
            f'=IF(N{r}="USD",I{r}*IF(O{r}="",DefaultFX,O{r}),I{r})',
        ).number_format = MONEY_FMT
        ws.cell(r, 17, kanal)
        for c in range(1, 18):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c in formula_cols else INPUT_FILL

    for r in range(15, 45):
        for c in range(1, 18):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c in formula_cols else INPUT_FILL
        ws.cell(r, 4, f'=IF(C{r}="","",IFERROR(XLOOKUP(C{r},tblProducts[Kod],tblProducts[Nomi]),"-"))')
        ws.cell(r, 8, f'=IF(E{r}="","",E{r}*F{r})')
        ws.cell(r, 9, f'=IF(E{r}="","",H{r}-G{r})')
        # Unit cost: user can type, or leave blank → XLOOKUP product opening cost
        ws.cell(
            r,
            10,
            f'=IF(C{r}="","",IFERROR(XLOOKUP(C{r},tblProducts[Kod],tblProducts[Boshlangich_tannarx]),0))',
        )
        ws.cell(r, 11, f'=IF(E{r}="","",E{r}*J{r})')
        ws.cell(r, 12, f'=IF(E{r}="","",I{r}-K{r})')
        ws.cell(r, 13, f'=IF(OR(E{r}="",I{r}=0),"",IFERROR(L{r}/I{r},0))')
        ws.cell(r, 16, f'=IF(E{r}="","",IF(N{r}="USD",I{r}*IF(O{r}="",DefaultFX,O{r}),I{r}))')
        for c in (5,):
            ws.cell(r, c).number_format = QTY_FMT
        for c in (6, 7, 8, 9, 10, 11, 12, 16):
            ws.cell(r, c).number_format = MONEY_FMT
        ws.cell(r, 13).number_format = PCT_FMT
        ws.cell(r, 1).number_format = DATE_FMT
        for c in formula_cols | {10}:
            ws.cell(r, c).fill = FORMULA_FILL
        # Allow override of unit cost: mark J as input-capable (overwrite formula if needed)
        ws.cell(r, 10).fill = INPUT_FILL

    # J column for empty: leave input; add comment row
    ws["A46"] = (
        "Bo'sh qatorlarda Birlik_tannarx (J) ni kiriting yoki: "
        '=XLOOKUP(C5,tblProducts[Kod],tblProducts[Boshlangich_tannarx])'
    )
    ws["A46"].font = SUBTITLE_FONT

    add_table(ws, "tblSales", "A4:Q44")
    autosize(ws)
    ws.freeze_panes = "A5"

    dv_cur = DataValidation(type="list", formula1='"UZS,USD"', allow_blank=True)
    ws.add_data_validation(dv_cur)
    dv_cur.add("N5:N44")


def write_purchases(wb: Workbook):
    ws = wb.create_sheet("04_Xaridlar")
    ws["A1"] = "Kirim / Xarid (Purchases)"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = "Summa = Miqdor × Birlik_tannarx. Yetkazuvchi qarziga bog'lash mumkin (08_Yetkazuvchi)."
    ws["A2"].font = SUBTITLE_FONT

    headers = [
        "Sana",
        "Xarid_N",
        "Yetkazuvchi",
        "Mahsulot_kod",
        "Mahsulot_nomi",
        "Miqdor",
        "Birlik_tannarx",
        "Summa_UZS",
        "Tolangan",
        "Qarz",
        "Izoh",
    ]
    for i, h in enumerate(headers, 1):
        ws.cell(4, i, h)
    style_header(ws, 4, len(headers))

    formula_cols = {5, 8, 10}
    sample = [
        (date(2026, 8, 1), "PO-01", "Yetkazuvchi A", "PRD-001", 50, 8000, "Partiya 1"),
        (date(2026, 8, 2), "PO-02", "Yetkazuvchi B", "PRD-002", 20, 18000, ""),
        (date(2026, 8, 3), "PO-03", "Yetkazuvchi A", "PRD-005", 30, 9000, ""),
        (date(2026, 8, 10), "PO-04", "Yetkazuvchi C", "PRD-003", 40, 3400, "Chegirma"),
        (date(2026, 8, 15), "PO-05", "Yetkazuvchi B", "PRD-004", 25, 12000, ""),
    ]
    paid_vals = [400000, 160000, 0, 136000, 100000]

    for r, ((sana, xn, yet, kod, qty, cost, izoh), paid) in enumerate(
        zip(sample, paid_vals), 5
    ):
        ws.cell(r, 1, sana).number_format = DATE_FMT
        ws.cell(r, 2, xn)
        ws.cell(r, 3, yet)
        ws.cell(r, 4, kod)
        ws.cell(r, 5, f'=IF(D{r}="","",IFERROR(XLOOKUP(D{r},tblProducts[Kod],tblProducts[Nomi]),"-"))')
        ws.cell(r, 6, qty).number_format = QTY_FMT
        ws.cell(r, 7, cost).number_format = MONEY_FMT
        ws.cell(r, 8, f"=F{r}*G{r}").number_format = MONEY_FMT
        ws.cell(r, 9, paid).number_format = MONEY_FMT
        ws.cell(r, 10, f"=H{r}-I{r}").number_format = MONEY_FMT
        ws.cell(r, 11, izoh)
        for c in range(1, 12):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c in formula_cols else INPUT_FILL

    for r in range(10, 40):
        for c in range(1, 12):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c in formula_cols else INPUT_FILL
        ws.cell(r, 5, f'=IF(D{r}="","",IFERROR(XLOOKUP(D{r},tblProducts[Kod],tblProducts[Nomi]),"-"))')
        ws.cell(r, 8, f'=IF(F{r}="","",F{r}*G{r})')
        ws.cell(r, 10, f'=IF(F{r}="","",H{r}-I{r})')
        ws.cell(r, 1).number_format = DATE_FMT
        ws.cell(r, 6).number_format = QTY_FMT
        for c in (7, 8, 9, 10):
            ws.cell(r, c).number_format = MONEY_FMT

    add_table(ws, "tblPurchases", "A4:K39")
    autosize(ws)
    ws.freeze_panes = "A5"


def write_returns(wb: Workbook):
    ws = wb.create_sheet("05_Qaytarishlar")
    ws["A1"] = "Qaytarishlar (Returns) - sof foydaga ta'sir"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = "Net Profit: Gross - Returns_Revenue + Returns_COGS - Expenses - Commission (POS formula)."
    ws["A2"].font = SUBTITLE_FONT

    headers = [
        "Sana",
        "Qaytarish_N",
        "Asl_chek",
        "Mahsulot_kod",
        "Mahsulot_nomi",
        "Miqdor",
        "Qaytarilgan_summa",
        "Birlik_tannarx",
        "Returns_COGS",
        "Foyda_ta'siri",
        "Izoh",
    ]
    # Profit impact = -returns_revenue + returns_cogs  (reduces net by revenue, adds back COGS)
    for i, h in enumerate(headers, 1):
        ws.cell(4, i, h)
    style_header(ws, 4, len(headers))

    sample = [
        (date(2026, 8, 8), "R-01", "S-1002", "PRD-002", 1, 22000, 18000, "Buzilgan"),
        (date(2026, 8, 16), "R-02", "S-1007", "PRD-003", 2, 10000, 3500, ""),
    ]
    formula_cols = {5, 9, 10}
    for r, (sana, qn, chek, kod, qty, amt, cost, izoh) in enumerate(sample, 5):
        ws.cell(r, 1, sana).number_format = DATE_FMT
        ws.cell(r, 2, qn)
        ws.cell(r, 3, chek)
        ws.cell(r, 4, kod)
        ws.cell(r, 5, f'=IF(D{r}="","",IFERROR(XLOOKUP(D{r},tblProducts[Kod],tblProducts[Nomi]),"-"))')
        ws.cell(r, 6, qty).number_format = QTY_FMT
        ws.cell(r, 7, amt).number_format = MONEY_FMT
        ws.cell(r, 8, cost).number_format = MONEY_FMT
        ws.cell(r, 9, f"=F{r}*H{r}").number_format = MONEY_FMT
        ws.cell(r, 10, f"=-G{r}+I{r}").number_format = MONEY_FMT
        ws.cell(r, 11, izoh)
        for c in range(1, 12):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c in formula_cols else INPUT_FILL

    for r in range(7, 25):
        for c in range(1, 12):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c in formula_cols else INPUT_FILL
        ws.cell(r, 5, f'=IF(D{r}="","",IFERROR(XLOOKUP(D{r},tblProducts[Kod],tblProducts[Nomi]),"-"))')
        ws.cell(r, 9, f'=IF(F{r}="","",F{r}*H{r})')
        ws.cell(r, 10, f'=IF(F{r}="","",-G{r}+I{r})')
        ws.cell(r, 1).number_format = DATE_FMT
        ws.cell(r, 6).number_format = QTY_FMT
        for c in (7, 8, 9, 10):
            ws.cell(r, c).number_format = MONEY_FMT

    add_table(ws, "tblReturns", "A4:K24")
    autosize(ws)
    ws.freeze_panes = "A5"


def write_payments(wb: Workbook):
    ws = wb.create_sheet("06_Tolovlar")
    ws["A1"] = "To'lovlar / Kassa (Payment methods)"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = "Usul: cash, card, transfer, uzcard, humo, click, payme, credit. Komissiya = foiz×summa + fixed."
    ws["A2"].font = SUBTITLE_FONT

    headers = [
        "Sana",
        "Chek_N",
        "Usul",
        "Guruh",
        "Summa_UZS",
        "Komissiya_%",
        "Komissiya_fixed",
        "Komissiya",
        "Sof_kassa",
        "Mijoz",
        "Izoh",
    ]
    for i, h in enumerate(headers, 1):
        ws.cell(4, i, h)
    style_header(ws, 4, len(headers))

    sample = [
        (date(2026, 8, 1), "S-1001", "cash", 145000, 0, 0, "Mijoz 1"),
        (date(2026, 8, 1), "S-1001", "credit", 20000, 0, 0, "Nasiya"),
        (date(2026, 8, 2), "S-1002", "uzcard", 110000, 1.0, 0, ""),
        (date(2026, 8, 5), "S-1003", "cash", 78000, 0, 0, ""),
        (date(2026, 8, 7), "S-1004", "payme", 90000, 1.5, 0, "Web"),
        (date(2026, 8, 10), "S-1005", "humo", 160000, 1.0, 0, ""),
        (date(2026, 8, 12), "S-1006", "cash", 225000, 0, 0, "USD sotuv UZS"),
        (date(2026, 8, 15), "S-1007", "card", 80000, 1.2, 500, ""),
        (date(2026, 8, 15), "S-1007", "credit", 16000, 0, 0, "Qisman"),
        (date(2026, 8, 18), "S-1008", "click", 100000, 1.0, 0, ""),
        (date(2026, 8, 20), "S-1009", "transfer", 77000, 0, 0, ""),
        (date(2026, 8, 22), "CP-01", "cash", 50000, 0, 0, "Qarz undirish"),
    ]

    formula_cols = {4, 8, 9}
    # Group formula: cash vs bank vs credit
    group_formula = (
        '=IF(C{r}="","",IF(OR(C{r}="cash",C{r}="naqd"),"cash",'
        'IF(OR(C{r}="credit",C{r}="on_credit"),"credit","bank")))'
    )

    for r, (sana, chek, usul, summa, pct, fixed, mijoz) in enumerate(sample, 5):
        ws.cell(r, 1, sana).number_format = DATE_FMT
        ws.cell(r, 2, chek)
        ws.cell(r, 3, usul)
        ws.cell(r, 4, group_formula.format(r=r))
        ws.cell(r, 5, summa).number_format = MONEY_FMT
        ws.cell(r, 6, pct / 100 if pct else 0).number_format = PCT_FMT
        ws.cell(r, 7, fixed).number_format = MONEY_FMT
        # Commission skipped for credit (POS skipFeeForMethod)
        ws.cell(
            r,
            8,
            f'=IF(OR(C{r}="credit",C{r}="on_credit"),0,E{r}*F{r}+G{r})',
        ).number_format = MONEY_FMT
        ws.cell(r, 9, f"=E{r}-H{r}").number_format = MONEY_FMT
        ws.cell(r, 10, mijoz)
        ws.cell(r, 11, "")
        for c in range(1, 12):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c in formula_cols else INPUT_FILL

    for r in range(17, 50):
        for c in range(1, 12):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c in formula_cols else INPUT_FILL
        ws.cell(r, 4, group_formula.format(r=r))
        ws.cell(r, 8, f'=IF(C{r}="","",IF(OR(C{r}="credit",C{r}="on_credit"),0,E{r}*F{r}+G{r}))')
        ws.cell(r, 9, f'=IF(C{r}="","",E{r}-H{r})')
        ws.cell(r, 1).number_format = DATE_FMT
        ws.cell(r, 5).number_format = MONEY_FMT
        ws.cell(r, 6).number_format = PCT_FMT
        for c in (7, 8, 9):
            ws.cell(r, c).number_format = MONEY_FMT

    dv = DataValidation(
        type="list",
        formula1='"cash,card,transfer,uzcard,humo,click,payme,credit,naqd"',
        allow_blank=True,
    )
    ws.add_data_validation(dv)
    dv.add("C5:C49")

    add_table(ws, "tblPayments", "A4:K49")
    autosize(ws)
    ws.freeze_panes = "A5"


def write_ar(wb: Workbook):
    ws = wb.create_sheet("07_Mijoz_Qarz")
    ws["A1"] = "Mijoz qarzlari (Accounts Receivable)"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = "Aging: 0-7 / 8-30 / 31-60 / 61+ (POS agingCalc). Yosh = AsOfDate - Hujjat_sana."
    ws["A2"].font = SUBTITLE_FONT

    headers = [
        "Mijoz",
        "Hujjat_N",
        "Hujjat_sana",
        "Muddat",
        "Jami_qarz",
        "Tolangan",
        "Qoldiq",
        "Yosh_kun",
        "Bucket",
        "Telefon",
    ]
    for i, h in enumerate(headers, 1):
        ws.cell(4, i, h)
    style_header(ws, 4, len(headers))

    sample = [
        ("Aliyev A.", "S-1001", date(2026, 8, 1), date(2026, 8, 15), 20000, 0, "+99890..."),
        ("Karimova B.", "S-1007", date(2026, 8, 15), date(2026, 8, 30), 16000, 5000, ""),
        ("Do'stlar LLC", "S-0880", date(2026, 6, 20), date(2026, 7, 20), 500000, 100000, ""),
        ("Toshmatov", "S-0920", date(2026, 7, 10), date(2026, 8, 10), 120000, 0, ""),
        ("Nodira", "S-0950", date(2026, 8, 18), date(2026, 9, 1), 45000, 0, ""),
    ]
    formula_cols = {7, 8, 9}
    for r, (mijoz, hn, hs, mud, jami, tol, tel) in enumerate(sample, 5):
        ws.cell(r, 1, mijoz)
        ws.cell(r, 2, hn)
        ws.cell(r, 3, hs).number_format = DATE_FMT
        ws.cell(r, 4, mud).number_format = DATE_FMT
        ws.cell(r, 5, jami).number_format = MONEY_FMT
        ws.cell(r, 6, tol).number_format = MONEY_FMT
        ws.cell(r, 7, f"=E{r}-F{r}").number_format = MONEY_FMT
        ws.cell(r, 8, f'=IF(C{r}="","",AsOfDate-C{r})')
        ws.cell(
            r,
            9,
            f'=IF(G{r}<=0,"",IF(H{r}<=7,"0_7",IF(H{r}<=30,"8_30",IF(H{r}<=60,"31_60","60_plus"))))',
        )
        ws.cell(r, 10, tel)
        for c in range(1, 11):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c in formula_cols else INPUT_FILL

    for r in range(10, 35):
        for c in range(1, 11):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c in formula_cols else INPUT_FILL
        ws.cell(r, 7, f'=IF(E{r}="","",E{r}-F{r})')
        ws.cell(r, 8, f'=IF(C{r}="","",AsOfDate-C{r})')
        ws.cell(
            r,
            9,
            f'=IF(OR(E{r}="",G{r}<=0),"",IF(H{r}<=7,"0_7",IF(H{r}<=30,"8_30",IF(H{r}<=60,"31_60","60_plus"))))',
        )
        for c in (3, 4):
            ws.cell(r, c).number_format = DATE_FMT
        for c in (5, 6, 7):
            ws.cell(r, c).number_format = MONEY_FMT

    add_table(ws, "tblAR", "A4:J34")
    # conditional formatting overdue
    ws.conditional_formatting.add(
        "G5:G34",
        FormulaRule(formula=['AND(G5>0,H5>30)'], fill=WARN_FILL),
    )
    autosize(ws)
    ws.freeze_panes = "A5"


def write_ap(wb: Workbook):
    ws = wb.create_sheet("08_Yetkazuvchi")
    ws["A1"] = "Yetkazib beruvchi qarzlari (Accounts Payable)"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = "Xarid bo'yicha kreditorlik. Aging bucketlar AR bilan bir xil."
    ws["A2"].font = SUBTITLE_FONT

    headers = [
        "Yetkazuvchi",
        "Hujjat_N",
        "Hujjat_sana",
        "Muddat",
        "Jami",
        "Tolangan",
        "Qoldiq",
        "Yosh_kun",
        "Bucket",
    ]
    for i, h in enumerate(headers, 1):
        ws.cell(4, i, h)
    style_header(ws, 4, len(headers))

    sample = [
        ("Yetkazuvchi A", "PO-01", date(2026, 8, 1), date(2026, 8, 20), 400000, 400000),
        ("Yetkazuvchi B", "PO-02", date(2026, 8, 2), date(2026, 8, 25), 360000, 200000),
        ("Yetkazuvchi A", "PO-03", date(2026, 8, 3), date(2026, 8, 25), 270000, 0),
        ("Yetkazuvchi C", "PO-04", date(2026, 8, 10), date(2026, 9, 10), 136000, 136000),
        ("Yetkazuvchi B", "PO-05", date(2026, 8, 15), date(2026, 9, 15), 300000, 100000),
        ("Yetkazuvchi D", "PO-OLD", date(2026, 5, 1), date(2026, 6, 1), 800000, 200000),
    ]
    formula_cols = {7, 8, 9}
    for r, (yet, hn, hs, mud, jami, tol) in enumerate(sample, 5):
        ws.cell(r, 1, yet)
        ws.cell(r, 2, hn)
        ws.cell(r, 3, hs).number_format = DATE_FMT
        ws.cell(r, 4, mud).number_format = DATE_FMT
        ws.cell(r, 5, jami).number_format = MONEY_FMT
        ws.cell(r, 6, tol).number_format = MONEY_FMT
        ws.cell(r, 7, f"=E{r}-F{r}").number_format = MONEY_FMT
        ws.cell(r, 8, f'=IF(C{r}="","",AsOfDate-C{r})')
        ws.cell(
            r,
            9,
            f'=IF(G{r}<=0,"",IF(H{r}<=7,"0_7",IF(H{r}<=30,"8_30",IF(H{r}<=60,"31_60","60_plus"))))',
        )
        for c in range(1, 10):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c in formula_cols else INPUT_FILL

    for r in range(11, 30):
        for c in range(1, 10):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c in formula_cols else INPUT_FILL
        ws.cell(r, 7, f'=IF(E{r}="","",E{r}-F{r})')
        ws.cell(r, 8, f'=IF(C{r}="","",AsOfDate-C{r})')
        ws.cell(
            r,
            9,
            f'=IF(OR(E{r}="",G{r}<=0),"",IF(H{r}<=7,"0_7",IF(H{r}<=30,"8_30",IF(H{r}<=60,"31_60","60_plus"))))',
        )
        for c in (3, 4):
            ws.cell(r, c).number_format = DATE_FMT
        for c in (5, 6, 7):
            ws.cell(r, c).number_format = MONEY_FMT

    add_table(ws, "tblAP", "A4:I29")
    autosize(ws)
    ws.freeze_panes = "A5"


def write_expenses(wb: Workbook):
    ws = wb.create_sheet("09_Xarajatlar")
    ws["A1"] = "Xarajatlar (Expenses) - sof foydadan ayiriladi"
    ws["A1"].font = TITLE_FONT

    headers = ["Sana", "Kategoriya", "Tavsif", "Summa_UZS", "To'lov_usuli"]
    for i, h in enumerate(headers, 1):
        ws.cell(4, i, h)
    style_header(ws, 4, len(headers))

    sample = [
        (date(2026, 8, 1), "Ijara", "Avgust ijara", 2500000, "transfer"),
        (date(2026, 8, 5), "Kommunal", "Elektr", 350000, "cash"),
        (date(2026, 8, 10), "Oylik", "Sotuvchi avans", 1000000, "cash"),
        (date(2026, 8, 15), "Transport", "Yetkazib berish", 180000, "cash"),
        (date(2026, 8, 20), "Boshqa", "Kantselyariya", 45000, "card"),
    ]
    for r, row in enumerate(sample, 5):
        for c, v in enumerate(row, 1):
            cell = ws.cell(r, c, v)
            cell.border = THIN
            cell.fill = INPUT_FILL
            if c == 1:
                cell.number_format = DATE_FMT
            if c == 4:
                cell.number_format = MONEY_FMT

    for r in range(10, 35):
        for c in range(1, 6):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = INPUT_FILL
        ws.cell(r, 1).number_format = DATE_FMT
        ws.cell(r, 4).number_format = MONEY_FMT

    add_table(ws, "tblExpenses", "A4:E34")
    autosize(ws)
    ws.freeze_panes = "A5"


def write_inventory(wb: Workbook):
    ws = wb.create_sheet("Ombor_Qoldiq")
    ws["A1"] = "Ombor / Qoldiq (Inventory) - ochilish + kirim - chiqim = yopilish"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = (
        "Kirim = 04_Xaridlar. Chiqim = 03_Sotuvlar. Qaytarish = 05 (omborga qaytadi). "
        "02_Harakatlar alohida ledger - bu varaqqa qo'shilMAYDI (ikkilanishning oldini olish). "
        "O'rtacha tannarx = (Ochilish_qiymat + Xarid_summa) / (Ochilish_qty + Xarid_qty)."
    )
    ws["A2"].font = SUBTITLE_FONT

    headers = [
        "Kod",
        "Nomi",
        "Ochilish_qty",
        "Kirim_qty",
        "Chiqim_qty",
        "Qaytarish_qty",
        "Yopilish_qty",
        "O_rtacha_tannarx",
        "Yopilish_qiymat",
        "Sotuv_narxi",
        "Potensial_tushum",
        "Status",
    ]
    for i, h in enumerate(headers, 1):
        ws.cell(4, i, h)
    style_header(ws, 4, len(headers))

    # Build rows from product codes (sample 5 + formulas that pull from tables)
    for i, kod in enumerate(["PRD-001", "PRD-002", "PRD-003", "PRD-004", "PRD-005"], 5):
        r = i
        ws.cell(r, 1, kod)
        ws.cell(r, 2, f'=IFERROR(XLOOKUP(A{r},tblProducts[Kod],tblProducts[Nomi]),"-")')
        ws.cell(r, 3, f'=IFERROR(XLOOKUP(A{r},tblProducts[Kod],tblProducts[Boshlangich_qty]),0)')
        # In from purchases + movements
        ws.cell(
            r,
            4,
            f'=SUMIF(tblPurchases[Mahsulot_kod],A{r},tblPurchases[Miqdor])',
        )
        ws.cell(
            r,
            5,
            f'=SUMIF(tblSales[Mahsulot_kod],A{r},tblSales[Miqdor])',
        )
        ws.cell(r, 6, f'=SUMIF(tblReturns[Mahsulot_kod],A{r},tblReturns[Miqdor])')
        ws.cell(r, 7, f"=C{r}+D{r}-E{r}+F{r}")
        # Avg cost: opening value + purchase amount / opening+purchase qty
        ws.cell(
            r,
            8,
            (
                f'=IFERROR(('
                f'XLOOKUP(A{r},tblProducts[Kod],tblProducts[Boshlangich_qiymat])'
                f'+SUMIF(tblPurchases[Mahsulot_kod],A{r},tblPurchases[Summa_UZS])'
                f')/(C{r}+SUMIF(tblPurchases[Mahsulot_kod],A{r},tblPurchases[Miqdor])), '
                f'XLOOKUP(A{r},tblProducts[Kod],tblProducts[Boshlangich_tannarx]))'
            ),
        )
        ws.cell(r, 9, f"=G{r}*H{r}")
        ws.cell(r, 10, f'=IFERROR(XLOOKUP(A{r},tblProducts[Kod],tblProducts[Sotuv_narxi]),0)')
        ws.cell(r, 11, f"=G{r}*J{r}")
        ws.cell(
            r,
            12,
            f'=IF(G{r}<=IFERROR(XLOOKUP(A{r},tblProducts[Kod],tblProducts[Minimal_qoldiq]),0),"PAST MIN","OK")',
        )
        for c in range(1, 13):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c > 1 else INPUT_FILL
            if c in (3, 4, 5, 6, 7):
                cell.number_format = QTY_FMT
            if c in (8, 9, 10, 11):
                cell.number_format = MONEY_FMT

    # Extra blank product rows
    for r in range(10, 25):
        for c in range(1, 13):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c > 1 else INPUT_FILL
        ws.cell(r, 2, f'=IF(A{r}="","",IFERROR(XLOOKUP(A{r},tblProducts[Kod],tblProducts[Nomi]),"-"))')
        ws.cell(r, 3, f'=IF(A{r}="","",IFERROR(XLOOKUP(A{r},tblProducts[Kod],tblProducts[Boshlangich_qty]),0))')
        ws.cell(
            r,
            4,
            f'=IF(A{r}="","",SUMIF(tblPurchases[Mahsulot_kod],A{r},tblPurchases[Miqdor]))',
        )
        ws.cell(
            r,
            5,
            f'=IF(A{r}="","",SUMIF(tblSales[Mahsulot_kod],A{r},tblSales[Miqdor]))',
        )
        ws.cell(r, 6, f'=IF(A{r}="","",SUMIF(tblReturns[Mahsulot_kod],A{r},tblReturns[Miqdor]))')
        ws.cell(r, 7, f'=IF(A{r}="","",C{r}+D{r}-E{r}+F{r})')
        ws.cell(
            r,
            8,
            f'=IF(A{r}="","",IFERROR((XLOOKUP(A{r},tblProducts[Kod],tblProducts[Boshlangich_qiymat])+SUMIF(tblPurchases[Mahsulot_kod],A{r},tblPurchases[Summa_UZS]))/(C{r}+SUMIF(tblPurchases[Mahsulot_kod],A{r},tblPurchases[Miqdor])),XLOOKUP(A{r},tblProducts[Kod],tblProducts[Boshlangich_tannarx])))',
        )
        ws.cell(r, 9, f'=IF(A{r}="","",G{r}*H{r})')
        ws.cell(r, 10, f'=IF(A{r}="","",IFERROR(XLOOKUP(A{r},tblProducts[Kod],tblProducts[Sotuv_narxi]),0))')
        ws.cell(r, 11, f'=IF(A{r}="","",G{r}*J{r})')
        ws.cell(
            r,
            12,
            f'=IF(A{r}="","",IF(G{r}<=IFERROR(XLOOKUP(A{r},tblProducts[Kod],tblProducts[Minimal_qoldiq]),0),"PAST MIN","OK"))',
        )
        for c in (3, 4, 5, 6, 7):
            ws.cell(r, c).number_format = QTY_FMT
        for c in (8, 9, 10, 11):
            ws.cell(r, c).number_format = MONEY_FMT

    add_table(ws, "tblInventory", "A4:L24")
    ws.conditional_formatting.add(
        "L5:L24",
        FormulaRule(formula=['L5="PAST MIN"'], fill=WARN_FILL),
    )

    ws["A26"] = "Jami ombor qiymati:"
    ws["A26"].font = Font(bold=True)
    ws["B26"] = "=SUM(tblInventory[Yopilish_qiymat])"
    ws["B26"].number_format = MONEY_FMT
    ws["B26"].fill = FORMULA_FILL

    ws["A27"] = (
        "Eslatma: Ombor faqat 03_Sotuvlar + 04_Xaridlar + 05_Qaytarishlar dan olinadi. "
        "02_Harakatlar - tezkor kunlik oldi-berdi (mustaqil). Ikkalasini bir mahsulot uchun aralashtirmang."
    )
    ws["A27"].font = Font(italic=True, color="922B21")

    autosize(ws)
    ws.freeze_panes = "A5"


def write_sales_report(wb: Workbook):
    ws = wb.create_sheet("Sotuv_Hisobot")
    ws["A1"] = "Sotuv hisoboti (davr) - SUMIFS / P&L"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = '=CONCATENATE("Davr: ",TEXT(PeriodStart,"yyyy-mm-dd")," - ",TEXT(PeriodEnd,"yyyy-mm-dd"))'
    ws["A2"].font = SUBTITLE_FONT

    # Daily breakdown header
    headers = [
        "Sana",
        "Brutto",
        "Chegirma",
        "Net_tushum_UZS",
        "COGS",
        "Gross_foyda",
        "Margin_%",
        "Qaytarish_tushum",
        "Qaytarish_COGS",
        "Sof_foyda_kun",
    ]
    for i, h in enumerate(headers, 1):
        ws.cell(4, i, h)
    style_header(ws, 4, len(headers))

    # Generate dates Aug 1..23
    d0 = date(2026, 8, 1)
    for i in range(23):
        r = 5 + i
        d = d0 + timedelta(days=i)
        ws.cell(r, 1, d).number_format = DATE_FMT
        # Period filter: only show values if date in period (still list all days)
        ws.cell(
            r,
            2,
            f'=IF(OR(A{r}<PeriodStart,A{r}>PeriodEnd),0,SUMIF(tblSales[Sana],A{r},tblSales[Brutto]))',
        )
        ws.cell(
            r,
            3,
            f'=IF(OR(A{r}<PeriodStart,A{r}>PeriodEnd),0,SUMIF(tblSales[Sana],A{r},tblSales[Chegirma]))',
        )
        ws.cell(
            r,
            4,
            f'=IF(OR(A{r}<PeriodStart,A{r}>PeriodEnd),0,SUMIF(tblSales[Sana],A{r},tblSales[UZS_eq]))',
        )
        ws.cell(
            r,
            5,
            f'=IF(OR(A{r}<PeriodStart,A{r}>PeriodEnd),0,SUMIF(tblSales[Sana],A{r},tblSales[COGS]))',
        )
        ws.cell(r, 6, f"=D{r}-E{r}")
        ws.cell(r, 7, f'=IFERROR(F{r}/D{r},0)')
        ws.cell(
            r,
            8,
            f'=IF(OR(A{r}<PeriodStart,A{r}>PeriodEnd),0,SUMIF(tblReturns[Sana],A{r},tblReturns[Qaytarilgan_summa]))',
        )
        ws.cell(
            r,
            9,
            f'=IF(OR(A{r}<PeriodStart,A{r}>PeriodEnd),0,SUMIF(tblReturns[Sana],A{r},tblReturns[Returns_COGS]))',
        )
        # Day net profit approx without daily expenses allocation: GP - ret_rev + ret_cogs
        ws.cell(r, 10, f"=F{r}-H{r}+I{r}")
        for c in range(1, 11):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c > 1 else INPUT_FILL
            if c == 7:
                cell.number_format = PCT_FMT
            elif c > 1:
                cell.number_format = MONEY_FMT

    add_table(ws, "tblSalesDaily", "A4:J27")

    # Period P&L summary box
    ws["L4"] = "DAVRIY P&L (Parametrlar oralig'i)"
    ws["L4"].font = Font(bold=True, color="FFFFFF")
    ws["L4"].fill = HEADER_FILL
    ws.merge_cells("L4:N4")

    pnl = [
        (5, "Brutto sotuv", '=SUMIFS(tblSales[Brutto],tblSales[Sana],">="&PeriodStart,tblSales[Sana],"<="&PeriodEnd)'),
        (6, "Chegirmalar", '=SUMIFS(tblSales[Chegirma],tblSales[Sana],">="&PeriodStart,tblSales[Sana],"<="&PeriodEnd)'),
        (7, "Net sotuv (UZS)", '=SUMIFS(tblSales[UZS_eq],tblSales[Sana],">="&PeriodStart,tblSales[Sana],"<="&PeriodEnd)'),
        (8, "COGS", '=SUMIFS(tblSales[COGS],tblSales[Sana],">="&PeriodStart,tblSales[Sana],"<="&PeriodEnd)'),
        (9, "Yalpi foyda (Gross)", "=N7-N8"),
        (10, "Gross margin %", "=IFERROR(N9/N7,0)"),
        (11, "Qaytarish tushumi", '=SUMIFS(tblReturns[Qaytarilgan_summa],tblReturns[Sana],">="&PeriodStart,tblReturns[Sana],"<="&PeriodEnd)'),
        (12, "Qaytarish COGS", '=SUMIFS(tblReturns[Returns_COGS],tblReturns[Sana],">="&PeriodStart,tblReturns[Sana],"<="&PeriodEnd)'),
        (13, "Xarajatlar", '=SUMIFS(tblExpenses[Summa_UZS],tblExpenses[Sana],">="&PeriodStart,tblExpenses[Sana],"<="&PeriodEnd)'),
        (14, "Komissiya (to'lov)", '=SUMIFS(tblPayments[Komissiya],tblPayments[Sana],">="&PeriodStart,tblPayments[Sana],"<="&PeriodEnd)'),
        (15, "SOF FOYDA (Net)", "=N9-N11+N12-N13-N14"),
        (16, "Net margin %", "=IFERROR(N15/N7,0)"),
    ]
    for r, label, formula in pnl:
        ws.cell(r, 12, label).border = THIN
        ws.cell(r, 12).fill = SECTION_FILL
        cell = ws.cell(r, 14, formula)
        cell.border = THIN
        cell.fill = FORMULA_FILL
        if "margin" in label.lower() or "%" in label:
            cell.number_format = PCT_FMT
        else:
            cell.number_format = MONEY_FMT
        if r == 15:
            ws.cell(r, 12).font = Font(bold=True)
            cell.font = Font(bold=True)

    ws["L18"] = "Formula (POS): Net = Gross - Returns_Rev + Returns_COGS - Expenses - Commission"
    ws["L18"].font = SUBTITLE_FONT
    ws.merge_cells("L18:N18")

    autosize(ws)
    ws.column_dimensions["L"].width = 22
    ws.column_dimensions["N"].width = 16
    ws.freeze_panes = "A5"


def write_kassa(wb: Workbook):
    ws = wb.create_sheet("Kassa")
    ws["A1"] = "Kunlik / oylik kassa - to'lov usullari bo'yicha"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = '=CONCATENATE("Davr: ",TEXT(PeriodStart,"yyyy-mm-dd")," - ",TEXT(PeriodEnd,"yyyy-mm-dd"))'

    # Method summary
    ws["A4"] = "Usul bo'yicha jami"
    ws["A4"].font = Font(bold=True)
    headers = ["Usul", "Guruh", "Summa", "Komissiya", "Sof", "Ulush_%"]
    for i, h in enumerate(headers, 1):
        ws.cell(5, i, h)
    style_header(ws, 5, 6)

    methods = ["cash", "card", "transfer", "uzcard", "humo", "click", "payme", "credit"]
    for i, m in enumerate(methods):
        r = 6 + i
        ws.cell(r, 1, m)
        ws.cell(
            r,
            2,
            f'=IF(A{r}="cash","cash",IF(A{r}="credit","credit","bank"))',
        )
        ws.cell(
            r,
            3,
            f'=SUMIFS(tblPayments[Summa_UZS],tblPayments[Usul],A{r},tblPayments[Sana],">="&PeriodStart,tblPayments[Sana],"<="&PeriodEnd)',
        )
        ws.cell(
            r,
            4,
            f'=SUMIFS(tblPayments[Komissiya],tblPayments[Usul],A{r},tblPayments[Sana],">="&PeriodStart,tblPayments[Sana],"<="&PeriodEnd)',
        )
        ws.cell(r, 5, f"=C{r}-D{r}")
        ws.cell(r, 6, f'=IFERROR(C{r}/SUM($C$6:$C$13),0)')
        for c in range(1, 7):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c > 1 else INPUT_FILL
            if c == 6:
                cell.number_format = PCT_FMT
            elif c >= 3:
                cell.number_format = MONEY_FMT

    add_table(ws, "tblKassaMethods", "A5:F13")

    ws["A15"] = "Guruhlar"
    ws["A15"].font = Font(bold=True)
    ws["A16"] = "Naqd (cash)"
    ws["B16"] = '=SUMIF(tblKassaMethods[Guruh],"cash",tblKassaMethods[Summa])'
    ws["A17"] = "Bank/karta"
    ws["B17"] = '=SUMIF(tblKassaMethods[Guruh],"bank",tblKassaMethods[Summa])'
    ws["A18"] = "Kredit/nasiya"
    ws["B18"] = '=SUMIF(tblKassaMethods[Guruh],"credit",tblKassaMethods[Summa])'
    ws["A19"] = "JAMI"
    ws["B19"] = "=B16+B17+B18"
    for r in range(16, 20):
        ws.cell(r, 2).number_format = MONEY_FMT
        ws.cell(r, 2).fill = FORMULA_FILL
        ws.cell(r, 1).border = THIN
        ws.cell(r, 2).border = THIN
    ws["A19"].font = Font(bold=True)
    ws["B19"].font = Font(bold=True)

    # Daily cash strip
    ws["H4"] = "Kunlik naqd (cash)"
    ws["H4"].font = Font(bold=True)
    ws["H5"] = "Sana"
    ws["I5"] = "Naqd"
    ws["J5"] = "Bank"
    ws["K5"] = "Kredit"
    ws["L5"] = "Jami"
    style_header(ws, 5, 5)  # wrong - only styles A... fix manually
    for col, h in enumerate(["Sana", "Naqd", "Bank", "Kredit", "Jami"], 8):
        cell = ws.cell(5, col, h)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.border = THIN

    d0 = date(2026, 8, 1)
    for i in range(23):
        r = 6 + i
        d = d0 + timedelta(days=i)
        ws.cell(r, 8, d).number_format = DATE_FMT
        ws.cell(
            r,
            9,
            f'=SUMIFS(tblPayments[Summa_UZS],tblPayments[Sana],H{r},tblPayments[Guruh],"cash")',
        )
        ws.cell(
            r,
            10,
            f'=SUMIFS(tblPayments[Summa_UZS],tblPayments[Sana],H{r},tblPayments[Guruh],"bank")',
        )
        ws.cell(
            r,
            11,
            f'=SUMIFS(tblPayments[Summa_UZS],tblPayments[Sana],H{r},tblPayments[Guruh],"credit")',
        )
        ws.cell(r, 12, f"=I{r}+J{r}+K{r}")
        for c in range(8, 13):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c > 8 else INPUT_FILL
            if c > 8:
                cell.number_format = MONEY_FMT

    # Pie chart for methods
    pie = PieChart()
    pie.title = "To'lov usullari"
    labels = Reference(ws, min_col=1, min_row=6, max_row=13)
    data = Reference(ws, min_col=3, min_row=5, max_row=13)
    pie.add_data(data, titles_from_data=True)
    pie.set_categories(labels)
    pie.dataLabels = DataLabelList()
    pie.dataLabels.showPercent = True
    pie.width = 12
    pie.height = 8
    ws.add_chart(pie, "A21")

    autosize(ws)
    ws.freeze_panes = "A6"


def write_aging(wb: Workbook):
    ws = wb.create_sheet("Aging_AR_AP")
    ws["A1"] = "Qarzlar yoshi (AR / AP Aging) - 0-7, 8-30, 31-60, 61+"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = '=CONCATENATE("Hisob sanasi (AsOf): ",TEXT(AsOfDate,"yyyy-mm-dd"))'

    ws["A4"] = "DEBITORLAR (AR - mijoz)"
    ws["A4"].font = Font(bold=True, color="FFFFFF")
    ws["A4"].fill = HEADER_FILL
    ws.merge_cells("A4:C4")

    buckets = [("0_7", "0-7 kun"), ("8_30", "8-30 kun"), ("31_60", "31-60 kun"), ("60_plus", "61+ kun")]
    ws["A5"] = "Bucket"
    ws["B5"] = "Tavsif"
    ws["C5"] = "Summa_UZS"
    style_header(ws, 5, 3)

    for i, (key, label) in enumerate(buckets):
        r = 6 + i
        ws.cell(r, 1, key)
        ws.cell(r, 2, label)
        ws.cell(r, 3, f'=SUMIF(tblAR[Bucket],A{r},tblAR[Qoldiq])').number_format = MONEY_FMT
        for c in range(1, 4):
            ws.cell(r, c).border = THIN
            ws.cell(r, c).fill = FORMULA_FILL if c == 3 else INPUT_FILL

    ws["A10"] = "Jami AR"
    ws["C10"] = "=SUM(C6:C9)"
    ws["C10"].number_format = MONEY_FMT
    ws["C10"].font = Font(bold=True)
    ws["A10"].font = Font(bold=True)

    ws["A12"] = "KREDITORLAR (AP - yetkazuvchi)"
    ws["A12"].font = Font(bold=True, color="FFFFFF")
    ws["A12"].fill = HEADER_FILL
    ws.merge_cells("A12:C12")

    ws["A13"] = "Bucket"
    ws["B13"] = "Tavsif"
    ws["C13"] = "Summa_UZS"
    style_header(ws, 13, 3)

    for i, (key, label) in enumerate(buckets):
        r = 14 + i
        ws.cell(r, 1, key)
        ws.cell(r, 2, label)
        ws.cell(r, 3, f'=SUMIF(tblAP[Bucket],A{r},tblAP[Qoldiq])').number_format = MONEY_FMT
        for c in range(1, 4):
            ws.cell(r, c).border = THIN
            ws.cell(r, c).fill = FORMULA_FILL if c == 3 else INPUT_FILL

    ws["A18"] = "Jami AP"
    ws["C18"] = "=SUM(C14:C17)"
    ws["C18"].number_format = MONEY_FMT
    ws["C18"].font = Font(bold=True)

    ws["A20"] = "Net pozitsiya (AR - AP)"
    ws["C20"] = "=C10-C18"
    ws["C20"].number_format = MONEY_FMT
    ws["C20"].fill = FORMULA_FILL

    # Bar chart AR
    chart = BarChart()
    chart.type = "col"
    chart.title = "AR Aging"
    data = Reference(ws, min_col=3, min_row=5, max_row=9)
    cats = Reference(ws, min_col=2, min_row=6, max_row=9)
    chart.add_data(data, titles_from_data=True)
    chart.set_categories(cats)
    chart.shape = 4
    chart.width = 12
    chart.height = 8
    ws.add_chart(chart, "E4")

    autosize(ws)


def write_dashboard(wb: Workbook):
    ws = wb.create_sheet("Dashboard")
    ws["A1"] = '=CONCATENATE(StoreName," - Bosh panel")'
    ws["A1"].font = TITLE_FONT
    ws["A2"] = '=CONCATENATE("Davr: ",TEXT(PeriodStart,"yyyy-mm-dd")," - ",TEXT(PeriodEnd,"yyyy-mm-dd"),"  |  AsOf: ",TEXT(AsOfDate,"yyyy-mm-dd"))'
    ws["A2"].font = SUBTITLE_FONT

    # KPI cards layout
    kpis = [
        (4, "Net sotuv (UZS)", '=SUMIFS(tblSales[UZS_eq],tblSales[Sana],">="&PeriodStart,tblSales[Sana],"<="&PeriodEnd)'),
        (5, "COGS", '=SUMIFS(tblSales[COGS],tblSales[Sana],">="&PeriodStart,tblSales[Sana],"<="&PeriodEnd)'),
        (6, "Yalpi foyda", "=B4-B5"),
        (7, "Gross margin %", "=IFERROR(B6/B4,0)"),
        (8, "Qaytarishlar", '=SUMIFS(tblReturns[Qaytarilgan_summa],tblReturns[Sana],">="&PeriodStart,tblReturns[Sana],"<="&PeriodEnd)'),
        (9, "Xarajatlar", '=SUMIFS(tblExpenses[Summa_UZS],tblExpenses[Sana],">="&PeriodStart,tblExpenses[Sana],"<="&PeriodEnd)'),
        (10, "Komissiya", '=SUMIFS(tblPayments[Komissiya],tblPayments[Sana],">="&PeriodStart,tblPayments[Sana],"<="&PeriodEnd)'),
        (
            11,
            "SOF FOYDA",
            '=B6-B8+SUMIFS(tblReturns[Returns_COGS],tblReturns[Sana],">="&PeriodStart,tblReturns[Sana],"<="&PeriodEnd)-B9-B10',
        ),
        (12, "Net margin %", "=IFERROR(B11/B4,0)"),
    ]

    ws["A3"] = "KPI"
    ws["B3"] = "Qiymat"
    style_header(ws, 3, 2)
    for r, label, formula in kpis:
        ws.cell(r, 1, label).border = THIN
        ws.cell(r, 1).fill = SECTION_FILL
        cell = ws.cell(r, 2, formula)
        cell.border = THIN
        cell.fill = FORMULA_FILL
        if "%" in label:
            cell.number_format = PCT_FMT
        else:
            cell.number_format = MONEY_FMT
        if "SOF" in label:
            ws.cell(r, 1).font = Font(bold=True)
            cell.font = Font(bold=True, size=12)

    # Right side: cash & debt
    ws["D3"] = "Kassa / Qarz"
    ws["E3"] = "Qiymat"
    style_header(ws, 3, 2)
    # Fix header for D-E
    for col, h in [(4, "Kassa / Qarz"), (5, "Qiymat")]:
        cell = ws.cell(3, col, h)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.border = THIN

    side = [
        (4, "Naqd tushum", '=SUMIFS(tblPayments[Summa_UZS],tblPayments[Guruh],"cash",tblPayments[Sana],">="&PeriodStart,tblPayments[Sana],"<="&PeriodEnd)'),
        (5, "Bank/karta tushum", '=SUMIFS(tblPayments[Summa_UZS],tblPayments[Guruh],"bank",tblPayments[Sana],">="&PeriodStart,tblPayments[Sana],"<="&PeriodEnd)'),
        (6, "Kredit berilgan", '=SUMIFS(tblPayments[Summa_UZS],tblPayments[Guruh],"credit",tblPayments[Sana],">="&PeriodStart,tblPayments[Sana],"<="&PeriodEnd)'),
        (7, "Jami AR (ochiq)", "=SUMIF(tblAR[Qoldiq],\">0\",tblAR[Qoldiq])"),
        (8, "Jami AP (ochiq)", "=SUMIF(tblAP[Qoldiq],\">0\",tblAP[Qoldiq])"),
        (9, "Ombor qiymati", "=SUM(tblInventory[Yopilish_qiymat])"),
        (10, "Xarid (davr)", '=SUMIFS(tblPurchases[Summa_UZS],tblPurchases[Sana],">="&PeriodStart,tblPurchases[Sana],"<="&PeriodEnd)'),
        (11, "Past min SKU", '=COUNTIF(tblInventory[Status],"PAST MIN")'),
    ]
    for r, label, formula in side:
        ws.cell(r, 4, label).border = THIN
        ws.cell(r, 4).fill = SECTION_FILL
        cell = ws.cell(r, 5, formula)
        cell.border = THIN
        cell.fill = FORMULA_FILL
        if "SKU" in label:
            cell.number_format = "0"
        else:
            cell.number_format = MONEY_FMT

    # Top products by revenue
    ws["A14"] = "Mahsulot bo'yicha sotuv (davr) - UNIQUE/SUMIFS namuna"
    ws["A14"].font = Font(bold=True)
    ws["A15"] = "Kod"
    ws["B15"] = "Nomi"
    ws["C15"] = "Net_UZS"
    ws["D15"] = "COGS"
    ws["E15"] = "Foyda"
    style_header(ws, 15, 5)

    for i, kod in enumerate(["PRD-001", "PRD-002", "PRD-003", "PRD-004", "PRD-005"], 16):
        r = i
        ws.cell(r, 1, kod)
        ws.cell(r, 2, f'=IFERROR(XLOOKUP(A{r},tblProducts[Kod],tblProducts[Nomi]),"-")')
        ws.cell(
            r,
            3,
            f'=SUMIFS(tblSales[UZS_eq],tblSales[Mahsulot_kod],A{r},tblSales[Sana],">="&PeriodStart,tblSales[Sana],"<="&PeriodEnd)',
        )
        ws.cell(
            r,
            4,
            f'=SUMIFS(tblSales[COGS],tblSales[Mahsulot_kod],A{r},tblSales[Sana],">="&PeriodStart,tblSales[Sana],"<="&PeriodEnd)',
        )
        ws.cell(r, 5, f"=C{r}-D{r}")
        for c in range(1, 6):
            cell = ws.cell(r, c)
            cell.border = THIN
            cell.fill = FORMULA_FILL if c > 1 else INPUT_FILL
            if c >= 3:
                cell.number_format = MONEY_FMT

    # Bar chart revenue by product
    chart = BarChart()
    chart.type = "col"
    chart.title = "Mahsulot bo'yicha net sotuv"
    data = Reference(ws, min_col=3, min_row=15, max_row=20)
    cats = Reference(ws, min_col=1, min_row=16, max_row=20)
    chart.add_data(data, titles_from_data=True)
    chart.set_categories(cats)
    chart.width = 14
    chart.height = 8
    ws.add_chart(chart, "G3")

    ws["A23"] = "Tezkor yo'riqnoma"
    ws["A23"].font = Font(bold=True)
    ws["A24"] = "1) Parametrlar da davrni o'zgartiring → barcha KPI yangilanadi (SUMIFS)."
    ws["A25"] = "2) Faqat sariq kataklarga yozing; yashil formulalarni saqlang."
    ws["A26"] = "3) Ombor uchun yoki 02_Harakatlar YOKI 03+04 dan foydalaning (ikkisini birga emas)."
    ws["A27"] = "4) Excel 365/2021 tavsiya: XLOOKUP, SUMIFS. FILTER/UNIQUE ixtiyoriy kengaytirish uchun."

    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 16
    ws.column_dimensions["D"].width = 22
    ws.column_dimensions["E"].width = 16
    for col in ("C", "F", "G"):
        ws.column_dimensions[col].width = 14


def main():
    wb = Workbook()
    # remove default
    default = wb.active
    wb.remove(default)

    write_readme(wb)
    write_params(wb)
    write_products(wb)
    write_movements(wb)
    write_sales(wb)
    write_purchases(wb)
    write_returns(wb)
    write_payments(wb)
    write_ar(wb)
    write_ap(wb)
    write_expenses(wb)
    write_inventory(wb)
    write_sales_report(wb)
    write_kassa(wb)
    write_aging(wb)
    write_dashboard(wb)

    # Move Dashboard after README for UX? Keep order as created; set Dashboard as active
    wb.active = wb["Dashboard"]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    print(f"Wrote: {OUT}")


if __name__ == "__main__":
    main()
