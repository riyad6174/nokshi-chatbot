// Loaded before every test file, before any application module reads process.env.
// DATABASE_URL is set by global-setup.ts (an in-memory MongoDB replica set).
process.env.AUTH_SECRET = "test-secret-0123456789abcdef";
process.env.APP_BASE_URL = "http://localhost:3000";
process.env.WIDGET_PUBLIC_KEY = "test-widget-key";
process.env.AI_API_KEY = "";
process.env.COMMERCE_PROVIDER = "internal";
process.env.COMMERCE_TRUSTED_HOSTS = "";
