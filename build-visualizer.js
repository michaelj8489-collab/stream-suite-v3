const esbuild = require('esbuild');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');

const options = {
    entryPoints: ['src/visualizer/index.jsx'],
    bundle: true,
    outfile: 'src/visualizer.bundle.js',
    format: 'iife',
    globalName: 'ReactVisualizer',
    sourcemap: true,
    target: ['chrome114'], 
    loader: {
        '.js': 'jsx',
        '.jsx': 'jsx'
    },
    logLevel: 'info',
};

async function build() {
    if (isWatch) {
        const ctx = await esbuild.context(options);
        await ctx.watch();
        console.log('Watching for visualizer changes...');
    } else {
        await esbuild.build(options);
        console.log('Visualizer bundle built successfully.');
    }
}

build().catch(() => process.exit(1));
