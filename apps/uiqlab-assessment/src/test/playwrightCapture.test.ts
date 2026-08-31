import * as assert from 'assert';
import { getPngDimensions } from '../playwrightCapture';

suite('Playwright capture', () => {
	test('reads actual dimensions from a PNG header', () => {
		const pngHeader = Buffer.alloc(24);
		Buffer.from('89504e470d0a1a0a', 'hex').copy(pngHeader);
		pngHeader.writeUInt32BE(1440, 16);
		pngHeader.writeUInt32BE(900, 20);
		assert.deepStrictEqual(getPngDimensions(pngHeader), { width: 1440, height: 900 });
	});
});
