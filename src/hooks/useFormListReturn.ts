import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useConfirmDialog } from '@/contexts/ConfirmDialogContext';
import { navigateBackTo, resolveBackTarget } from '@/lib/pageState';

type Options = {
  /** Default list route when returnTo is missing or invalid. */
  fallbackListPath: string;
  unsavedTitle?: string;
  unsavedDescription?: string;
  confirmLeaveText?: string;
  stayOnFormText?: string;
};

/**
 * Back / cancel navigation from create-edit forms to their list page.
 * Honors `returnTo` query + location.state; optional unsaved-changes confirm.
 */
export function useFormListReturn(options: Options) {
  const {
    fallbackListPath,
    unsavedTitle = "Saqlanmagan o'zgarishlar mavjud.",
    unsavedDescription = "Davom etsangiz, o'zgarishlar yo'qoladi.",
    confirmLeaveText = 'Davom etib, bekor qilish',
    stayOnFormText = 'Formaga qaytish',
  } = options;

  const navigate = useNavigate();
  const location = useLocation();
  const confirmDialog = useConfirmDialog();
  const backTarget = resolveBackTarget(location, fallbackListPath);

  const goToList = useCallback(() => {
    navigateBackTo(navigate, location, fallbackListPath);
  }, [navigate, location, fallbackListPath]);

  const confirmLeaveIfDirty = useCallback(
    async (isDirty: boolean) => {
      if (!isDirty) return true;
      return confirmDialog({
        title: unsavedTitle,
        description: unsavedDescription,
        confirmText: confirmLeaveText,
        cancelText: stayOnFormText,
      });
    },
    [confirmDialog, unsavedTitle, unsavedDescription, confirmLeaveText, stayOnFormText],
  );

  const leaveToList = useCallback(
    async (isDirty: boolean) => {
      if (!(await confirmLeaveIfDirty(isDirty))) return;
      goToList();
    },
    [confirmLeaveIfDirty, goToList],
  );

  return { backTarget, goToList, leaveToList, confirmLeaveIfDirty };
}
