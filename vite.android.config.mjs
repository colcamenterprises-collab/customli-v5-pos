import {defineConfig} from 'vite';
export default defineConfig({
 base:'./',
 build:{outDir:'android-dist',emptyOutDir:true,rollupOptions:{input:'universal.html'}},
});
