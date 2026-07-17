import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.toml' },
				miniflare: {
					bindings: {
						USERNAME: 'test-user',
						PASSWORD: 'test-password',
						JWT_SECRET: 'test-secret-with-enough-entropy',
						CORS_ORIGIN: 'https://app.example.com',
					},
				},
			},
		},
	},
});
