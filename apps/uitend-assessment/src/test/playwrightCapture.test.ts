import * as assert from 'assert';
import { createServer } from 'http';
import { capturePage, getPngDimensions } from '../playwrightCapture';

suite('Playwright capture', () => {
	test('reads actual dimensions from a PNG header', () => {
		const pngHeader = Buffer.alloc(24);
		Buffer.from('89504e470d0a1a0a', 'hex').copy(pngHeader);
		pngHeader.writeUInt32BE(1440, 16);
		pngHeader.writeUInt32BE(900, 20);
		assert.deepStrictEqual(getPngDimensions(pngHeader), { width: 1440, height: 900 });
	});

	test('rejects pages that return an HTTP error status', async () => {
		const server = createServer((_request, response) => {
			response.statusCode = 404;
			response.end('Not found');
		});

		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', () => {
				server.off('error', reject);
				resolve();
			});
		});

		const address = server.address();
		assert.ok(address && typeof address !== 'string');

		try {
			await assert.rejects(capturePage(`http://127.0.0.1:${address.port}`), /404/);
		} finally {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => error ? reject(error) : resolve());
			});
		}
	});
});
