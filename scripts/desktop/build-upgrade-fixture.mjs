import { build } from 'esbuild'
await build({ entryPoints: ['tests/helpers/native-upgrade-fixture.ts'], outfile: 'release/test-fixtures/native-upgrade.js', bundle: true, format: 'iife', platform: 'browser', target: 'es2022', define: { 'import.meta.env': JSON.stringify({ DEV: false, MODE: 'portable', BASE_URL: '/storyforge/' }) } })
