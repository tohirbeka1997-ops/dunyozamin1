import { createCustomer, findCustomerByPhone, findCustomerDuplicates } from '@/db/api';
import {
  assertInitialBonusPoints,
  assertOptionalEmail,
  assertOptionalUzPhone,
  DEFAULT_INITIAL_BONUS_LIMIT,
} from '@/lib/posHardening';
import type { Customer } from '@/types/database';

export type CustomerFormValues = {
  name: string;
  phone: string;
  email: string;
  address: string;
  type: 'individual' | 'company';
  pricing_tier: 'retail' | 'master';
  company_name: string;
  tax_number: string;
  status: 'active' | 'inactive';
  notes: string;
  bonus_points: number;
  credit_limit: number;
  telegram: string;
};

export type CustomerDupCandidate = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  match: string;
};

export type CustomerFormValidationOk = {
  ok: true;
  resolvedPhone: string | null;
  email: string | null;
};

export type CustomerFormValidationErr = {
  ok: false;
  title: string;
  description: string;
};

export type CustomerWritePayload = {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  type: 'individual' | 'company';
  pricing_tier: 'retail' | 'master';
  company_name: string | null;
  tax_number: string | null;
  status: 'active' | 'inactive';
  notes: string | null;
  telegram: string | null;
  bonus_points?: number;
  credit_limit?: number;
};

export type CreateCustomerFormResult =
  | { status: 'validation'; title: string; description: string }
  | {
      status: 'duplicate_phone';
      existingId: string;
      existing?: Customer;
      duplicates: CustomerDupCandidate[];
    }
  | { status: 'created'; customer: Customer; duplicates: CustomerDupCandidate[] }
  | { status: 'error'; error: unknown; duplicates: CustomerDupCandidate[] };

export function emptyCustomerFormValues(): CustomerFormValues {
  return {
    name: '',
    phone: '+998',
    email: '',
    address: '',
    type: 'individual',
    pricing_tier: 'retail',
    company_name: '',
    tax_number: '',
    status: 'active',
    notes: '',
    bonus_points: 0,
    credit_limit: 0,
    telegram: '',
  };
}

export function customerToFormValues(customer: Customer): CustomerFormValues {
  const tgUsername = customer.telegram_username;
  const tgId = customer.telegram_id;
  const telegramDisplay = tgUsername
    ? `@${String(tgUsername).replace(/^@+/, '')}`
    : tgId != null && String(tgId).trim() !== ''
      ? String(tgId)
      : '';

  return {
    name: customer.name,
    phone: customer.phone || '',
    email: customer.email || '',
    address: customer.address || '',
    type: customer.type === 'company' ? 'company' : 'individual',
    pricing_tier: customer.pricing_tier === 'master' ? 'master' : 'retail',
    company_name: customer.company_name || '',
    tax_number: customer.tax_number || '',
    status: customer.status === 'inactive' ? 'inactive' : 'active',
    notes: customer.notes || '',
    bonus_points: Number(customer.bonus_points) || 0,
    credit_limit: Math.max(0, Number(customer.credit_limit) || 0),
    telegram: telegramDisplay,
  };
}

function assertOptionalTelegram(raw: string): boolean {
  const telegramInput = raw?.trim() || '';
  if (!telegramInput) return true;
  const isNumeric = /^-?\d+$/.test(telegramInput);
  const username = telegramInput.replace(/^@+/, '');
  const isUsername = /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username);
  return isNumeric || isUsername;
}

export function validateCustomerForm(
  formData: CustomerFormValues,
  opts: { isAdmin: boolean },
): CustomerFormValidationOk | CustomerFormValidationErr {
  if (!formData.name.trim()) {
    return {
      ok: false,
      title: 'Validatsiya xatosi',
      description: 'Mijoz ismi kiritilishi shart',
    };
  }

  if (formData.type === 'company' && !formData.company_name.trim()) {
    return {
      ok: false,
      title: 'Validatsiya xatosi',
      description: 'Yuridik shaxs turi uchun kompaniya nomi kiritilishi shart',
    };
  }

  const phoneGate = assertOptionalUzPhone(formData.phone);
  if (phoneGate.ok === false) {
    return {
      ok: false,
      title: 'Validatsiya xatosi',
      description: "Telefon raqami noto'g'ri formatda. Masalan: +998 90 123 45 67",
    };
  }

  const emailGate = assertOptionalEmail(formData.email);
  if (emailGate.ok === false) {
    return {
      ok: false,
      title: 'Validatsiya xatosi',
      description: 'Email formati noto‘g‘ri',
    };
  }

  if (opts.isAdmin) {
    const bonusGate = assertInitialBonusPoints(formData.bonus_points, {
      maxInitial: DEFAULT_INITIAL_BONUS_LIMIT,
    });
    if (bonusGate.ok === false) {
      return {
        ok: false,
        title: 'Validatsiya xatosi',
        description: bonusGate.error,
      };
    }
  }

  if (!assertOptionalTelegram(formData.telegram)) {
    return {
      ok: false,
      title: 'Validatsiya xatosi',
      description: 'Telegram: @username (masalan @ali) yoki raqamli chat id kiriting',
    };
  }

  return {
    ok: true,
    resolvedPhone: phoneGate.phone,
    email: emailGate.email,
  };
}

export function buildCustomerWritePayload(
  formData: CustomerFormValues,
  validated: Pick<CustomerFormValidationOk, 'resolvedPhone' | 'email'>,
  opts: { isAdmin: boolean },
): CustomerWritePayload {
  return {
    name: formData.name,
    phone: validated.resolvedPhone,
    email: validated.email,
    address: formData.address || null,
    type: formData.type,
    pricing_tier: formData.pricing_tier,
    company_name: formData.company_name || null,
    tax_number: formData.tax_number || null,
    status: formData.status,
    notes: formData.notes || null,
    telegram: formData.telegram.trim() || null,
    ...(opts.isAdmin
      ? {
          bonus_points: Math.max(0, Math.floor(Number(formData.bonus_points) || 0)),
          credit_limit: Math.max(0, Number(formData.credit_limit) || 0),
        }
      : {}),
  };
}

function duplicatePhoneFromError(error: unknown): string | undefined {
  const errObj =
    error && typeof error === 'object'
      ? (error as { code?: string; details?: { existing_id?: string } })
      : null;
  if (errObj?.code === 'DUPLICATE_PHONE' && errObj.details?.existing_id) {
    return errObj.details.existing_id;
  }
  return undefined;
}

export async function createCustomerFromForm(
  formData: CustomerFormValues,
  opts: { isAdmin: boolean },
): Promise<CreateCustomerFormResult> {
  const validated = validateCustomerForm(formData, opts);
  if (validated.ok === false) {
    return { status: 'validation', title: validated.title, description: validated.description };
  }

  const phoneGate = assertOptionalUzPhone(formData.phone);
  let duplicates: CustomerDupCandidate[] = [];

  try {
    duplicates = await findCustomerDuplicates({
      phone: validated.resolvedPhone,
      email: validated.email,
      name: formData.name.trim(),
    });
    const byPhone = duplicates.find((d) => d.match === 'phone');
    if (byPhone) {
      return {
        status: 'duplicate_phone',
        existingId: byPhone.id,
        duplicates,
      };
    }

    if (phoneGate.ok && phoneGate.normalized && validated.resolvedPhone) {
      const existingByPhone = await findCustomerByPhone(validated.resolvedPhone);
      if (existingByPhone) {
        return {
          status: 'duplicate_phone',
          existingId: existingByPhone.id,
          existing: existingByPhone,
          duplicates,
        };
      }
    }

    const customer = await createCustomer(buildCustomerWritePayload(formData, validated, opts));
    return { status: 'created', customer, duplicates };
  } catch (error) {
    const existingId = duplicatePhoneFromError(error);
    if (existingId) {
      return { status: 'duplicate_phone', existingId, duplicates };
    }
    return { status: 'error', error, duplicates };
  }
}
