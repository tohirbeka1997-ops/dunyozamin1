'use strict';

function shouldReleaseBodyPointerEvents(hasOpenModal, pointerEvents) {
  return !hasOpenModal && pointerEvents === 'none';
}

function planTypingRestoreAfterDialog(input) {
  const hasOpenModal = Boolean(input.hasOpenModal);
  return {
    clearBodyPointerEvents: shouldReleaseBodyPointerEvents(hasOpenModal, input.bodyPointerEvents),
    clearHtmlPointerEvents: shouldReleaseBodyPointerEvents(
      hasOpenModal,
      input.htmlPointerEvents || '',
    ),
    clearAriaInertAndFocusGuards: !hasOpenModal,
    shouldRefocus: !hasOpenModal,
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(shouldReleaseBodyPointerEvents(false, 'none'), 'stuck lock should release');
assert(!shouldReleaseBodyPointerEvents(true, 'none'), 'open dialog keeps the lock');
assert(!shouldReleaseBodyPointerEvents(false, ''), 'already released');
assert(!shouldReleaseBodyPointerEvents(false, 'auto'), 'other values stay');

const afterNativeConfirm = planTypingRestoreAfterDialog({
  hasOpenModal: false,
  bodyPointerEvents: 'none',
  htmlPointerEvents: 'none',
});
assert(afterNativeConfirm.clearBodyPointerEvents, 'native confirm leftover body lock');
assert(afterNativeConfirm.clearHtmlPointerEvents, 'native confirm leftover html lock');
assert(afterNativeConfirm.clearAriaInertAndFocusGuards, 'clear inert/focus guards after confirm');
assert(afterNativeConfirm.shouldRefocus, 'refocus search/qty after confirm');

const whileAlertOpen = planTypingRestoreAfterDialog({
  hasOpenModal: true,
  bodyPointerEvents: 'none',
  htmlPointerEvents: 'none',
});
assert(!whileAlertOpen.clearBodyPointerEvents, 'open AlertDialog keeps body lock');
assert(!whileAlertOpen.clearHtmlPointerEvents, 'open AlertDialog keeps html lock');
assert(!whileAlertOpen.clearAriaInertAndFocusGuards, 'keep inert while modal open');
assert(!whileAlertOpen.shouldRefocus, 'do not steal focus while modal open');

console.log('releaseStuckPointerEvents.node.test: OK');
