import { sortByZ } from '@/lib/barcodes/labelModel';
import type {
  LabelElement,
  LabelPreviewData,
  LabelSheetLayout,
  LabelTemplate,
  LegacyProductLabelElement,
} from '@/lib/barcodes/labelModel';
import { normalizeElements } from '@/lib/barcodes/labelModel';
import {
  elementBarcodeType,
  isBarcodeKind,
  resolveBarcodeValue,
  resolveElementText,
} from '@/lib/barcodes/labelDataResolver';
import { PrintBarcodeMarkup } from './LabelElementVisual';

export type ProductLabelBarcodeType = 'EAN13' | 'CODE128' | 'QR';

/** @deprecated */
export type ProductLabelElement = LegacyProductLabelElement;
/** @deprecated */
export type ProductLabelElementId = 'header' | 'name' | 'sku' | 'price' | 'barcode';

function justifyFor(align?: 'left' | 'center' | 'right') {
  return align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
}

function renderSingleLabel(
  template: Pick<LabelTemplate, 'widthMm' | 'heightMm' | 'elements' | 'background'>,
  previewData: LabelPreviewData,
  key?: string | number
) {
  const safeW = Math.max(10, Number(template.widthMm) || 39);
  const safeH = Math.max(10, Number(template.heightMm) || 20);
  const elements = sortByZ(normalizeElements(template.elements));

  return (
    <div
      key={key}
      style={{
        width: `${safeW}mm`,
        height: `${safeH}mm`,
        position: 'relative',
        background: template.background || '#fff',
        overflow: 'hidden',
        pageBreakInside: 'avoid',
        breakInside: 'avoid',
      }}
    >
      {elements.map((el) => {
        if (el.visible === false) return null;
        const isOldPrice = el.data === 'old_price';
        const isDiscount = el.data === 'discount_pct';
        const textValue = resolveElementText(el, previewData);

        return (
          <div
            key={el.id}
            style={{
              position: 'absolute',
              left: `${el.x}mm`,
              top: `${el.y}mm`,
              width: `${el.w}mm`,
              height: `${el.h}mm`,
              overflow: 'hidden',
              zIndex: el.z ?? 1,
              transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
              transformOrigin: 'center',
            }}
          >
            {el.kind === 'line' ? (
              <div style={{ width: '100%', height: '100%', background: el.color || '#16201b' }} />
            ) : isBarcodeKind(el) ? (
              <PrintBarcodeMarkup
                type={elementBarcodeType(el)}
                value={resolveBarcodeValue(el, previewData)}
                showDigits={Boolean(el.showValue)}
                moduleWidth={el.moduleWidth}
                widthMm={el.w}
                heightMm={el.h}
                rotateDeg={el.rotation}
              />
            ) : el.kind === 'image' ? (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  background: '#f4f4f4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '8px',
                  color: '#888',
                }}
              >
                Logo
              </div>
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: justifyFor(el.align),
                  padding: '0.4mm',
                  boxSizing: 'border-box',
                  fontSize: `${el.fontSizePt ?? 10}pt`,
                  fontWeight: el.fontWeight ?? 600,
                  fontFamily: el.fontFamily || 'Inter, Arial, sans-serif',
                  letterSpacing: el.letterSpacingPt ? `${el.letterSpacingPt}pt` : undefined,
                  lineHeight: 1.05,
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                  color: el.color || '#16201b',
                  textAlign: el.align ?? 'left',
                  textDecoration: isOldPrice ? 'line-through' : undefined,
                  background: isDiscount ? '#d92d20' : undefined,
                  borderRadius: isDiscount ? '1mm' : undefined,
                }}
              >
                {el.uppercase ? textValue.toUpperCase() : textValue}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Legacy single-label print (backward compat) */
export default function ProductLabelLayoutPrint({
  widthMm,
  heightMm,
  copies = 1,
  barcodeType: _barcodeType,
  barcodeValue: _barcodeValue,
  showBarcodeDigits: _showBarcodeDigits,
  barcodeRotateDeg: _barcodeRotateDeg,
  barcodeQuietZoneMm: _barcodeQuietZoneMm,
  texts,
  showPrice,
  layout,
  background,
  previewData,
}: {
  widthMm: number;
  heightMm: number;
  copies?: number;
  barcodeType?: ProductLabelBarcodeType;
  barcodeValue?: string;
  showBarcodeDigits?: boolean;
  barcodeRotateDeg?: number;
  barcodeQuietZoneMm?: number;
  texts?: { header: string; name: string; sku: string; price: string };
  showPrice?: boolean;
  layout: LabelElement[] | LegacyProductLabelElement[];
  background?: string;
  previewData?: LabelPreviewData;
}) {
  const data: LabelPreviewData =
    previewData ??
    ({
      product_name: texts?.name || '',
      price: Number(String(texts?.price || '0').replace(/\D/g, '')) || 0,
      sku: texts?.sku || '',
      barcode_value: _barcodeValue || '',
      unit: 'dona',
      date: new Date().toLocaleDateString('uz-UZ'),
      store_name: texts?.header || 'DUNYOZAMIN',
    } as LabelPreviewData);

  if (showPrice === false) {
    // hide price elements
  }

  const safeCopies = Math.max(1, Math.min(500, Number(copies) || 1));
  const template = {
    widthMm,
    heightMm,
    elements: normalizeElements(layout as LabelElement[]),
    background,
  };

  return (
    <div>
      {Array.from({ length: safeCopies }, (_, idx) =>
        renderSingleLabel(template, data, idx)
      )}
    </div>
  );
}

export function LabelSheetPrint({
  template,
  previewDataList,
  sheet,
  copiesPerLabel = 1,
}: {
  template: LabelTemplate;
  previewDataList: LabelPreviewData[];
  sheet: LabelSheetLayout;
  copiesPerLabel?: number;
}) {
  const labelW = template.widthMm;
  const labelH = template.heightMm;
  const gap = sheet.gapMm;
  const margin = sheet.marginMm;
  const cols = Math.max(1, sheet.cols);
  const rows = Math.max(1, sheet.rows);
  const perSheet = cols * rows;

  const allLabels: LabelPreviewData[] = [];
  for (const data of previewDataList) {
    for (let c = 0; c < copiesPerLabel; c++) allLabels.push(data);
  }

  const sheets: LabelPreviewData[][] = [];
  for (let i = 0; i < allLabels.length; i += perSheet) {
    sheets.push(allLabels.slice(i, i + perSheet));
  }
  if (sheets.length === 0) sheets.push([]);

  const pageW = sheet.paper === 'A5' ? 210 : sheet.paper === 'Roll' ? labelW : 210;
  const pageH = sheet.paper === 'A5' ? 148 : sheet.paper === 'Roll' ? labelH * rows + gap * (rows - 1) : 297;

  return (
    <div>
      {sheets.map((pageLabels, sheetIdx) => (
        <div
          key={sheetIdx}
          style={{
            width: `${pageW}mm`,
            height: `${pageH}mm`,
            position: 'relative',
            pageBreakAfter: sheetIdx < sheets.length - 1 ? 'always' : 'auto',
            breakAfter: sheetIdx < sheets.length - 1 ? 'page' : 'auto',
            padding: `${margin}mm`,
            boxSizing: 'border-box',
            background: '#fff',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, ${labelW}mm)`,
              gridTemplateRows: `repeat(${rows}, ${labelH}mm)`,
              gap: `${gap}mm`,
              width: 'fit-content',
            }}
          >
            {Array.from({ length: perSheet }, (_, i) => {
              const data = pageLabels[i];
              if (!data) {
                return (
                  <div
                    key={i}
                    style={{ width: `${labelW}mm`, height: `${labelH}mm` }}
                  />
                );
              }
              return renderSingleLabel(template, data, i);
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export { renderSingleLabel };
