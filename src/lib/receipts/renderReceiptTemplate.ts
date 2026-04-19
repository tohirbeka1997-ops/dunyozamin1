import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CompanySettings, OrderWithDetails, ReceiptTemplate } from '@/types/database';
import ReceiptTemplateView from '@/components/print/ReceiptTemplateView';

export type ReceiptTemplateRenderExtras = {
  /** Sozlamalar: mahsulotlar blokidan keyin, jami oldidan */
  middleText?: string;
};

export function renderReceiptTemplate(
  template: ReceiptTemplate,
  order: OrderWithDetails,
  company?: CompanySettings | null,
  note?: string,
  extras?: ReceiptTemplateRenderExtras
): string {
  return renderToStaticMarkup(
    createElement(ReceiptTemplateView, {
      template,
      order,
      company: company ?? undefined,
      note,
      mode: 'print',
      settingsMiddleText: extras?.middleText,
    })
  );
}
