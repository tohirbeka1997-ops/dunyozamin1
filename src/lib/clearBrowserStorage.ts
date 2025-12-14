import type { QueryClient } from '@tanstack/react-query';

/**
 * Clear all browser storage (localStorage, sessionStorage, IndexedDB, caches, React Query cache)
 * Useful for logout, reset, or switching from mock to real data
 */
export const clearAllBrowserStorage = async (queryClient?: QueryClient): Promise<void> => {
  // Clear localStorage
  try {
    localStorage.clear();
  } catch (error) {
    console.error('Error clearing localStorage:', error);
  }

  // Clear sessionStorage
  try {
    sessionStorage.clear();
  } catch (error) {
    console.error('Error clearing sessionStorage:', error);
  }

  // Clear IndexedDB
  if (window.indexedDB && indexedDB.databases) {
    try {
      const databases = await indexedDB.databases();
      await Promise.all(
        databases.map(db => {
          if (db.name) {
            return new Promise<void>((resolve, reject) => {
              const deleteReq = indexedDB.deleteDatabase(db.name!);
              deleteReq.onsuccess = () => resolve();
              deleteReq.onerror = () => reject(deleteReq.error);
              deleteReq.onblocked = () => {
                console.warn(`Database ${db.name} is blocked, will retry`);
                setTimeout(() => resolve(), 100);
              };
            });
          }
          return Promise.resolve();
        })
      );
    } catch (error) {
      console.error('Error clearing IndexedDB:', error);
    }
  }

  // Clear caches
  if ('caches' in window && caches.keys) {
    try {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map(key => caches.delete(key)));
    } catch (error) {
      console.error('Error clearing caches:', error);
    }
  }

  // Clear React Query cache
  if (queryClient) {
    try {
      queryClient.clear();
      queryClient.resetQueries();
      queryClient.removeQueries();
    } catch (error) {
      console.error('Error clearing React Query cache:', error);
    }
  }
};

/**
 * Clear all browser storage and reload the page
 */
export const clearAllBrowserStorageAndReload = async (queryClient?: QueryClient): Promise<void> => {
  await clearAllBrowserStorage(queryClient);
  location.reload();
};

