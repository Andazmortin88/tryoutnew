/** Production Tailwind config for UKOM Health Pro. */
module.exports = {
  content: ['./index.html'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter','sans-serif'] },
      boxShadow: { glow: '0 0 60px rgba(14,165,233,.22)' }
    }
  },
  plugins: []
};
