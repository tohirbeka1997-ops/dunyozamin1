import { cn } from '@/lib/utils';
import type { LabelTemplate } from '@/lib/barcodes/labelModel';
import { BUILTIN_LABEL_TEMPLATES } from '@/lib/barcodes/builtinTemplates';
import ProductLabelLayoutEditor from '@/components/barcodes/ProductLabelLayoutEditor';
import { DEMO_PREVIEW_DATA } from '@/lib/barcodes/labelModel';
import { Button } from '@/components/ui/button';
import { LABEL_SIZE_PRESETS } from '@/lib/barcodes/labelModel';

export default function BarcodeStudioGallery({
  onSelect,
  className,
}: {
  onSelect: (template: LabelTemplate) => void;
  className?: string;
}) {
  const groups = LABEL_SIZE_PRESETS.map((preset) => ({
    ...preset,
    templates: BUILTIN_LABEL_TEMPLATES.filter((t) => t.widthMm === preset.w && t.heightMm === preset.h),
  }));

  return (
    <div className={cn('space-y-6', className)}>
      {groups.map((group) => (
        <section
          key={group.key}
          className="rounded-2xl border bg-card p-5 shadow-sm"
        >
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-bold text-primary">
              {group.label}
            </span>
            <span className="text-xs text-muted-foreground">{group.templates.length} ta shablon</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {group.templates.map((tpl) => (
              <div
                key={tpl.id}
                className="group flex flex-col items-center gap-3 rounded-xl border bg-gradient-to-b from-card to-muted/20 p-3 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
              >
                <div className="flex min-h-[100px] w-full items-center justify-center rounded-md bg-muted/30 p-2">
                  <div
                    className="origin-center scale-[0.45] sm:scale-[0.5]"
                    style={{ width: tpl.widthMm * 6, height: tpl.heightMm * 6 }}
                  >
                    <ProductLabelLayoutEditor
                      widthMm={tpl.widthMm}
                      heightMm={tpl.heightMm}
                      previewData={DEMO_PREVIEW_DATA}
                      background={tpl.background}
                      value={tpl.elements}
                      onChange={() => {}}
                      selectedId={null}
                      onSelect={() => {}}
                      pxPerMm={6}
                      className="pointer-events-none"
                    />
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-sm font-bold">{tpl.name}</div>
                  <div className="text-[10px] text-muted-foreground">{tpl.widthMm}×{tpl.heightMm} mm</div>
                </div>
                <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => onSelect(tpl)}>
                  Tanlash
                </Button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
