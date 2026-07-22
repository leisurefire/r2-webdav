import { defineConfig } from 'vite';
export default defineConfig({
	resolve: {
		alias: {
			dompurify: '/tmp-dompurify-shim.mjs',
		},
	},
});
