import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
	server: {
		watch: {
			// Explicitly block heavy directories from being scanned
			ignored: [
				'**/node_modules/**',
				'**/out/**',
				'**/.vite/**',
				'**/.wine/**',
				'**/.git/**',
			]
		}
	}
});
