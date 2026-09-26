import {defineConfig} from 'vite';
export default defineConfig({
  root:'app-src',
  base:'/tryoutnew/',
  build:{outDir:'../dist',emptyOutDir:true,sourcemap:false,target:'es2020',assetsDir:'assets'}
});
