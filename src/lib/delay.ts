/**
 * Delay utility function
 * Returns a promise that resolves after the specified number of milliseconds
 * 
 * @param ms - Number of milliseconds to delay
 * @returns Promise that resolves after the delay
 */
export const delay = (ms: number): Promise<void> => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

























































