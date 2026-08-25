import { getSetting, updateSetting } from '@/db/settings.api';
import { getActorUserIdForAudit } from '@/db/internal';
import type { LabelTemplate } from './labelModel';
import { normalizeElements, newElementId } from './labelModel';
import { BUILTIN_LABEL_TEMPLATES } from './builtinTemplates';

export const BARCODE_TEMPLATES_SETTING_KEY = 'barcode.templates';

export type SavedLabelTemplatesV2 = {
  v: 2;
  templates: LabelTemplate[];
  updatedAt: string;
};

const LS_FALLBACK_KEY = 'barcode.studio.templates.v2';

function normalizeTemplate(raw: unknown): LabelTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as LabelTemplate;
  if (!t.id || !t.name) return null;
  return {
    ...t,
    widthMm: Number(t.widthMm) || 40,
    heightMm: Number(t.heightMm) || 30,
    elements: normalizeElements(Array.isArray(t.elements) ? t.elements : []),
    builtin: Boolean(t.builtin),
  };
}

export function allBuiltinTemplates(): LabelTemplate[] {
  return BUILTIN_LABEL_TEMPLATES;
}

export async function loadUserLabelTemplates(): Promise<LabelTemplate[]> {
  let payload: SavedLabelTemplatesV2 | null = null;

  try {
    const fromDb = await getSetting('barcode', 'templates');
    if (fromDb && typeof fromDb === 'object' && (fromDb as SavedLabelTemplatesV2).v === 2) {
      payload = fromDb as SavedLabelTemplatesV2;
    }
  } catch {
    // fall through to localStorage
  }

  if (!payload && typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(LS_FALLBACK_KEY);
      if (raw) payload = JSON.parse(raw) as SavedLabelTemplatesV2;
    } catch {
      // ignore
    }
  }

  if (!payload?.templates?.length) return [];
  return payload.templates.map(normalizeTemplate).filter(Boolean) as LabelTemplate[];
}

export async function saveUserLabelTemplates(templates: LabelTemplate[]): Promise<void> {
  const userTemplates = templates.filter((t) => !t.builtin);
  const payload: SavedLabelTemplatesV2 = {
    v: 2,
    templates: userTemplates.map((t) => ({
      ...t,
      elements: normalizeElements(t.elements),
      updatedAt: new Date().toISOString(),
    })),
    updatedAt: new Date().toISOString(),
  };

  const actor = getActorUserIdForAudit();

  try {
    await updateSetting('barcode', 'templates', payload, actor || 'system');
  } catch {
    // web / mock fallback
  }

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(payload));
  }
}

export async function upsertUserTemplate(template: LabelTemplate): Promise<LabelTemplate> {
  const existing = await loadUserLabelTemplates();
  const normalized: LabelTemplate = {
    ...template,
    id: template.id || newElementId(),
    builtin: false,
    updatedAt: new Date().toISOString(),
    elements: normalizeElements(template.elements),
  };
  const next = existing.filter((t) => t.id !== normalized.id).concat(normalized);
  await saveUserLabelTemplates(next);
  return normalized;
}

export async function deleteUserTemplate(id: string): Promise<void> {
  const existing = await loadUserLabelTemplates();
  await saveUserLabelTemplates(existing.filter((t) => t.id !== id));
}

export async function loadAllTemplates(): Promise<LabelTemplate[]> {
  const user = await loadUserLabelTemplates();
  return [...BUILTIN_LABEL_TEMPLATES, ...user];
}
