const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    js.configs.recommended,
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser
            }
        },
        rules: {
            'no-unused-vars': 2,
            'no-undef': 2,
            'indent': [1, 4],
            'strict': [2, 'function'],
            'camelcase': 2,
            'no-var': 0,
            'quotes': [2, 'single'],
            'curly': 2,
            'eqeqeq': 2,
            'no-irregular-whitespace': 2
        }
    }
];
