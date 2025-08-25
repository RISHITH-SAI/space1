/** @type {import('tailwindcss').Config} */
module.exports = {
  // Specify files where Tailwind should look for utility classes
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html", // Also scan the HTML file
  ],
  theme: {
    extend: {
      // Custom font family to use 'Inter' from Google Fonts
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      // Custom colors to enhance the space theme
      colors: {
        'space-dark': '#0D1117',
        'space-medium': '#161B22',
        'space-light': '#21262D',
        'solar-red': '#E53E3E',
        'solar-orange': '#DD6B20',
        'solar-yellow': '#ECC94B',
        'celestial-blue': '#667EEA',
        'celestial-purple': '#9F7AEA',
      }
    },
  },
  plugins: [],
}
