import * as assert from 'assert';
import { isEligibleSourcePath, scoreSourceCandidate } from '../sourceContextSelection';

suite('Profile suggestion source context', () => {
	test('prioritizes the active file and files matching the assessed route', () => {
		const active = scoreSourceCandidate('src/components/header.tsx', 'http://localhost:3000/dashboard', true);
		const routeMatch = scoreSourceCandidate('src/pages/dashboard.tsx', 'http://localhost:3000/dashboard', false);
		const unrelated = scoreSourceCandidate('src/pages/settings.tsx', 'http://localhost:3000/dashboard', false);

		assert.ok(active > routeMatch);
		assert.ok(routeMatch > unrelated);
	});

	test('accepts frontend source and rejects generated or dependency files', () => {
		assert.strictEqual(isEligibleSourcePath('src/pages/home.tsx'), true);
		assert.strictEqual(isEligibleSourcePath('styles/theme.scss'), true);
		assert.strictEqual(isEligibleSourcePath('dist/app.js'), false);
		assert.strictEqual(isEligibleSourcePath('node_modules/lib/index.ts'), false);
		assert.strictEqual(isEligibleSourcePath('src/vendor.min.js'), false);
		assert.strictEqual(isEligibleSourcePath('src/data.json'), false);
	});
});
