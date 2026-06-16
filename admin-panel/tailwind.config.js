/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#0f3d3e',
          teal: '#1d7874',
          cream: '#f6f4ef',
        },
      },
    },
  },
  plugins: [],
};
