import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.toml' },
			miniflare: {
				bindings: {
					USERNAME: 'test-user',
					PASSWORD: 'test-password',
					JWT_SECRET: 'test-secret-with-enough-entropy',
					CORS_ORIGIN: 'https://app.example.com',
				},
			},
		}),
	],
});
