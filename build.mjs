// Builds two outputs from the ES module sources:
//   dist/index.html     standalone page for any static host (with <html>/<head>)
//   dist/artifact.html  single-file body content for the claude.ai artifact preview
// Usage: node build.mjs <path-to-esbuild-binary>
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const esbuild = process.argv[2] || 'esbuild';
mkdirSync('dist', { recursive: true });
const js = execFileSync(esbuild, ['js/main.js', '--bundle', '--format=iife', '--minify', '--target=es2020'], { encoding: 'utf8', maxBuffer: 1 << 26 });
const css = readFileSync('css/app.css', 'utf8');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700;800&family=Big+Shoulders+Display:wght@800;900&display=swap">';
const safeJs = js.replace(/<\/script/gi, '<\\/script');
writeFileSync('dist/index.html', `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>Matchday Legends</title><meta name="theme-color" content="#0b1016">\n${fonts}\n<style>${css}</style></head><body><div id="app"></div><script>${safeJs}</script></body></html>\n`);
writeFileSync('dist/artifact.html', `<title>Matchday Legends</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${fonts}\n<style>${css}</style>\n<div id="app"></div>\n<script>${safeJs}</script>\n`);
console.log('built', (js.length / 1024).toFixed(0) + 'KB js');
