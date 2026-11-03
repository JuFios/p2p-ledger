/** @type {import('next').NextConfig} */
const nextConfig = {
  // Зображення не оптимізуємо на сервері; зовнішній image endpoint не потрібен.
  images: { unoptimized: true },
};
module.exports = nextConfig;
