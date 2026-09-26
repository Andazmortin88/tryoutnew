/** @type {import('tailwindcss').Config} */
export default {
  content:['./app-src/index.html','./app-src/**/*.{js,jsx}'],
  theme:{extend:{fontFamily:{sans:['ui-sans-serif','system-ui','-apple-system','BlinkMacSystemFont','Segoe UI','sans-serif']},boxShadow:{glow:'0 0 60px rgba(56,189,248,.28)'}}},
  plugins:[]
};
