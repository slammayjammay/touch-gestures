import path from 'path';

export default {
	entry: './index.js',
	mode: process.env.NODE_ENV || 'production',
	output: {
		path: path.resolve('.'),
		filename: 'built.js',
		library: {
			name: 'TouchGestures',
			type: 'var',
			export: 'default'
		}
	}
};
